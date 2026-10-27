// POST /api/admin-login  (form field: password)
// - Needs the guest cookie first (middleware), then the admin password.
// - Right: admin cookie, 303 to /admin. Wrong: short delay, 303 to /admin?wrong=1.
import { adminEnabled, adminPasswordMatches, adminCookie } from '../lib/auth.js';

export async function POST(request) {
  if (!adminEnabled()) return new Response(null, { status: 303, headers: { Location: '/admin?off=1' } });
  const form = await request.formData().catch(() => null);
  if (!(await adminPasswordMatches(form?.get('password')))) {
    await new Promise((r) => setTimeout(r, 900));
    return new Response(null, { status: 303, headers: { Location: '/admin?wrong=1' } });
  }
  return new Response(null, { status: 303, headers: { Location: '/admin', 'Set-Cookie': await adminCookie() } });
}
