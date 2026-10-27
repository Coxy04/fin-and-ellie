// Vercel Routing Middleware: nothing is served until the guest has the password cookie.
// - /login, /api/login, the favicon and the cron ping stay public (keepalive checks its own secret).
// - Unconfigured env vars fail closed (500), never open.
import { next } from '@vercel/functions';
import { isAuthed } from './lib/auth.js';

export const config = {
  matcher: ['/((?!login(?:\\.html)?$|api/login$|api/keepalive$|favicon\\.svg$).*)'],
};

export default async function middleware(request) {
  let ok;
  try {
    ok = await isAuthed(request);
  } catch (e) {
    console.error(e);
    return new Response('Site is not configured yet: ' + e.message, { status: 500 });
  }
  if (ok) return next();

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    return Response.json({ error: 'Please enter the password from your invitation.' }, { status: 401 });
  }
  return Response.redirect(new URL('/login', url), 302);
}
