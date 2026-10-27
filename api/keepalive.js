// GET /api/keepalive, called once a day by Vercel Cron (see vercel.json).
// - Free Supabase projects pause after ~7 days without activity; this keeps it awake.
// - Vercel sends "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is set.
import { rpc } from '../lib/supabase.js';

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 403 });
  }
  try {
    await rpc('find_household', { search: 'keepalive' });
    return Response.json({ ok: true });
  } catch (e) {
    console.error('keepalive failed', e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
