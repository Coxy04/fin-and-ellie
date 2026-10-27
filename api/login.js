// POST /api/login  (form field: password)
// - Right password: set cookie, 303 to the site.
// - Wrong password: short delay to slow guessing, 303 back to the login page.
import { passwordMatches, sessionCookie } from '../lib/auth.js';

export async function POST(request) {
  const form = await request.formData().catch(() => null);
  const password = form?.get('password') ?? '';

  if (!(await passwordMatches(password))) {
    await new Promise((r) => setTimeout(r, 600));
    return new Response(null, { status: 303, headers: { Location: '/login?wrong=1' } });
  }
  return new Response(null, {
    status: 303,
    headers: { Location: '/', 'Set-Cookie': await sessionCookie() },
  });
}
