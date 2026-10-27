// GET /api/admin  ->  { guests:[...], sitePassword, site }
// - Guest cookie checked by middleware; admin cookie checked here.
// - sitePassword is returned so the dashboard can fill in the reminder message.
import { adminEnabled, isAdmin } from '../lib/auth.js';
import { rpc } from '../lib/supabase.js';

export async function GET(request) {
  if (!adminEnabled()) return Response.json({ error: 'The dashboard is switched off.', need: 'config' }, { status: 503 });
  if (!(await isAdmin(request))) return Response.json({ error: 'Admin password needed.', need: 'admin' }, { status: 401 });
  try {
    const guests = await rpc('admin_rsvps', {});
    return Response.json(
      { guests, sitePassword: process.env.SITE_PASSWORD, site: process.env.PUBLIC_SITE || 'www.ellandfin.co.uk' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    console.error('admin_rsvps failed', e);
    return Response.json({ error: 'Could not load the replies. Has supabase/schema.sql been re-run?' }, { status: 500 });
  }
}
