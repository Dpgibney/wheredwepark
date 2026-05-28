import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return new Response('server misconfigured', { status: 500 });
  }

  // Resolve the caller's identity from their JWT. The anon-key client honors
  // the Authorization header but won't perform privileged operations on its own.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return new Response('unauthorized', { status: 401 });
  }

  // Admin delete cascades: profiles -> cars -> car_shares + parking_locations.
  // The delete-car-assets webhook fires per cascaded car DELETE and removes
  // any associated parking images from storage.
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
  if (deleteErr) {
    return new Response(deleteErr.message, { status: 500 });
  }

  return new Response('ok', { status: 200 });
});
