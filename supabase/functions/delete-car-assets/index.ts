import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
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
