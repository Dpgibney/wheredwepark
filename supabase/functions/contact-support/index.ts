import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUBJECT_MAX = 200;
const MESSAGE_MAX = 5000;
const RATE_LIMIT = 3; // max submissions per user per hour
const RATE_WINDOW_MS = 60 * 60 * 1000;

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

  // The service-role client bypasses RLS so it can read/write support_requests,
  // which is otherwise locked to all clients.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Rate limit: at most RATE_LIMIT submissions per user per rolling hour. We
  // count first and only record a row after a successful send (below), so
  // failed sends don't burn a user's quota. A concurrent burst could slip a few
  // extra through, which is acceptable for a feedback form.
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count, error: countErr } = await admin
    .from('support_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', since);
  if (countErr) {
    return new Response('rate-limit check failed', { status: 500 });
  }
  if ((count ?? 0) >= RATE_LIMIT) {
    return new Response('rate limit exceeded', { status: 429 });
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

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return new Response(`email send failed: ${detail}`, { status: 502 });
  }

  // Record the submission: durable copy for triage and the row the rate limiter
  // counts. The email already went out, so a failed insert just loses the record
  // — don't fail the request and risk the user re-sending a duplicate.
  const { error: insertErr } = await admin.from('support_requests').insert({
    user_id: user.id,
    subject,
    message,
    contact_email: contactEmail || null,
    platform,
  });
  if (insertErr) {
    console.error('support_requests insert failed:', insertErr.message);
  }

  return new Response('ok', { status: 200 });
});
