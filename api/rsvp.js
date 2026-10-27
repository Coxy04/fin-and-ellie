// POST /api/rsvp
// body: {household_id, message, guests:[{id, attending, diet, diet_notes, song_title, song_artist}]}
// - Validation that guests belong to the household happens in the save_rsvp SQL function.
import { isAuthed, unauthorised } from '../lib/auth.js';
import { rpc } from '../lib/supabase.js';

const str = (v) => (typeof v === 'string' ? v : '');

export async function POST(request) {
  if (!(await isAuthed(request))) return unauthorised();

  const body = await request.json().catch(() => null);
  const householdId = Number(body?.household_id);
  if (!Number.isInteger(householdId) || !Array.isArray(body?.guests) || body.guests.length === 0 || body.guests.length > 20) {
    return Response.json({ error: 'That RSVP looks incomplete. Please try again.' }, { status: 400 });
  }

  const guests = body.guests.map((g) => ({
    id: Number(g?.id),
    attending: g?.attending,
    diet: str(g?.diet),
    diet_notes: str(g?.diet_notes),
    song_title: str(g?.song_title),
    song_artist: str(g?.song_artist),
  }));

  try {
    const result = await rpc('save_rsvp', {
      p_household_id: householdId,
      p_guests: guests,
      p_message: str(body.message),
    });
    return Response.json(result);
  } catch (e) {
    // P0001/P0002 are our own validation errors from save_rsvp
    if (e.code === 'P0001' || e.code === 'P0002') {
      return Response.json({ error: e.message }, { status: 400 });
    }
    console.error('save_rsvp failed', e);
    return Response.json({ error: 'We couldn’t save your RSVP. Please try again in a minute.' }, { status: 500 });
  }
}
