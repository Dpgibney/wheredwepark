import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Sends push notifications through Expo for the webhooks created in
// supabase/notifications.sql:
//   car_shares INSERT                 -> "<owner> shared <car> with you"
//   parking_locations INSERT / UPDATE -> "<car> was parked" (opt-in, per car)
// Who gets what, and throttling, are decided in claim_notifications(), so this
// function needs no table access of its own. Never includes coordinates.

const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET');
// Only needed if "enhanced push security" is turned on for the Expo project.
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN');
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100; // Expo's per-request limit
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Claim = { token: string; car_id: string; car_name: string; actor_name: string };
type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: { path: string };
  sound: 'default';
  channelId: 'default';
};
type PushTicket = { status: 'ok' | 'error'; details?: { error?: string } };

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function toMessage(kind: 'invite' | 'parked', claim: Claim): PushMessage {
  return kind === 'invite'
    ? {
        to: claim.token,
        title: 'New shared vehicle',
        body: `${claim.actor_name} shared ${claim.car_name} with you.`,
        data: { path: '/' },
        sound: 'default',
        channelId: 'default',
      }
    : {
        to: claim.token,
        title: `${claim.car_name} was parked`,
        body: `${claim.actor_name} saved a new parking spot.`,
        data: { path: `/car/${claim.car_id}` },
        sound: 'default',
        channelId: 'default',
      };
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET) {
    return new Response('server misconfigured', { status: 500 });
  }

  const provided = req.headers.get('x-webhook-secret') ?? '';
  if (!timingSafeEqual(provided, WEBHOOK_SECRET)) {
    return new Response('unauthorized', { status: 401 });
  }

  const payload = await req.json();
  const record = payload?.record ?? {};

  let kind: 'invite' | 'parked';
  let ref: unknown;
  if (payload?.table === 'car_shares' && payload.type === 'INSERT') {
    kind = 'invite';
    ref = record.id;
  } else if (
    payload?.table === 'parking_locations' &&
    (payload.type === 'INSERT' || payload.type === 'UPDATE')
  ) {
    kind = 'parked';
    ref = record.car_id;
  } else {
    return new Response('ignored', { status: 200 });
  }
  if (typeof ref !== 'string' || !UUID_RE.test(ref)) {
    return new Response('bad payload', { status: 400 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data, error } = await admin.rpc('claim_notifications', { p_kind: kind, p_ref: ref });
  if (error) {
    console.error('claim_notifications failed:', error.message);
    return new Response('claim failed', { status: 500 });
  }
  const messages = ((data ?? []) as Claim[]).map((claim) => toMessage(kind, claim));
  if (messages.length === 0) {
    return new Response('nothing to send', { status: 200 });
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${EXPO_ACCESS_TOKEN}`;

  // Tokens Expo says are no longer registered (app deleted, notifications
  // turned off) are removed so we stop sending to them.
  const deadTokens: string[] = [];
  for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
    const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(batch) });
      if (!res.ok) {
        console.error('expo push failed:', res.status, await res.text().catch(() => ''));
        continue;
      }
      const { data: tickets } = (await res.json()) as { data?: PushTicket[] };
      (tickets ?? []).forEach((ticket, j) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          deadTokens.push(batch[j].to);
        }
      });
    } catch (err) {
      console.error('expo push failed:', err);
    }
  }

  if (deadTokens.length > 0) {
    const { error: forgetErr } = await admin.rpc('forget_push_tokens', { p_tokens: deadTokens });
    if (forgetErr) console.error('forget_push_tokens failed:', forgetErr.message);
  }

  return new Response('ok', { status: 200 });
});
