// GET /api/find?q=smith  ->  [{id, name, message, guests:[{id, name, type, rsvp}]}]
import { isAuthed, unauthorised } from '../lib/auth.js';
import { rpc } from '../lib/supabase.js';

export async function GET(request) {
  if (!(await isAuthed(request))) return unauthorised();

  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 80);
  if (q.length < 3) return Response.json([]);

  try {
    const households = await rpc('find_household', { search: q });
    return Response.json(households, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('find_household failed', e);
    return Response.json({ error: 'Search is unavailable right now. Please try again.' }, { status: 500 });
  }
}
