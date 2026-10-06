import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUBJECT_MAX = 200;
const MESSAGE_MAX = 5000;
const CONTACT_EMAIL_MAX = 320; // matches the support_requests.contact_email check
// Shape check only. Rejecting spaces, angle brackets and list separators keeps
// reply_to a single bare address (no display name or extra recipients).
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response('unauthorized', { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  // Both default to the support mailbox. RESEND_FROM must be on a domain you've
  // verified in Resend, otherwise the send is rejected.
  const supportEmail = Deno.env.get('SUPPORT_EMAIL') ?? 'support@wheredwepark.com';
  const fromEmail = Deno.env.get('RESEND_FROM') ?? "Where'd We Park <support@wheredwepark.com>";

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !resendApiKey) {
    return new Response('server misconfigured', { status: 500 });
  }

  // Resolve the caller's identity from their JWT. Requiring a valid session is
  // our spam guard — only signed-in users can reach this function.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return new Response('unauthorized', { status: 401 });
  }

  let payload: { subject?: unknown; message?: unknown; contactEmail?: unknown; platform?: unknown };
  try {
    payload = await req.json();
  } catch {
    return new Response('invalid body', { status: 400 });
  }

  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  const contactEmail =
    typeof payload.contactEmail === 'string' && payload.contactEmail.trim().length > 0
      ? payload.contactEmail.trim()
      : (user.email ?? '');
  const platform = typeof payload.platform === 'string' ? payload.platform.slice(0, 100) : 'unknown';

  if (subject.length === 0 || message.length === 0) {
    return new Response('subject and message are required', { status: 400 });
  }
  if (subject.length > SUBJECT_MAX || message.length > MESSAGE_MAX) {
    return new Response('subject or message too long', { status: 400 });
  }
  if (contactEmail.length > CONTACT_EMAIL_MAX || (contactEmail && !EMAIL_RE.test(contactEmail))) {
    return new Response('invalid contact email', { status: 400 });
  }

  // The service-role client bypasses RLS so it can read/write support_requests,
  // which is otherwise locked to all clients.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Reserve the submission before sending. The enforce_support_rate_limit
  // trigger (3 per user per rolling hour) counts and inserts under a per-user
  // advisory lock, so a burst of parallel requests can't all pass the check.
  // The row is also the durable copy for triage. Any insert failure stops the
  // send, so nothing goes out uncounted.
  const { data: reserved, error: insertErr } = await admin
    .from('support_requests')
    .insert({
      user_id: user.id,
      subject,
      message,
      contact_email: contactEmail || null,
      platform,
    })
    .select('id')
    .single();
  if (insertErr) {
    // PT429 is the SQLSTATE the trigger raises when the user is over the limit.
    if (insertErr.code === 'PT429') {
      return new Response('rate limit exceeded', { status: 429 });
    }
    console.error('support_requests insert failed:', insertErr.message);
    return new Response('could not record request', { status: 500 });
  }

  // Metadata is appended server-side so support has trustworthy triage info that
  // the client can't forge (the user id/email come from the verified JWT).
  const body =
    `${message}\n\n` +
    `— — —\n` +
    `From: ${contactEmail}\n` +
    `User ID: ${user.id}\n` +
    `Account email: ${user.email ?? 'n/a'}\n` +
    `Platform: ${platform}\n`;

  let sent = false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [supportEmail],
        reply_to: contactEmail || undefined,
        subject: `[Support] ${subject}`,
        text: body,
      }),
    });
    sent = res.ok;
    if (!res.ok) {
      // Log the provider's reason server-side only; it can reveal account config.
      console.error('email send failed:', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.error('email send failed:', err);
  }

  if (!sent) {
    // Release the reservation so a failed send doesn't burn the user's quota.
    const { error: releaseErr } = await admin
      .from('support_requests')
      .delete()
      .eq('id', reserved.id);
    if (releaseErr) {
      console.error('support_requests release failed:', releaseErr.message);
    }
    return new Response('email send failed', { status: 502 });
  }

  return new Response('ok', { status: 200 });
});
