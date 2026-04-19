import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET');

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
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

  if (payload.type !== 'DELETE' || payload.table !== 'cars') {
    return new Response('ignored', { status: 200 });
  }

  const carId = payload.old_record.id as string;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: files } = await supabase.storage
    .from('parking-images')
    .list(carId);

  if (files && files.length > 0) {
    await supabase.storage
      .from('parking-images')
      .remove(files.map((f) => `${carId}/${f.name}`));
  }

  return new Response('ok', { status: 200 });
});
