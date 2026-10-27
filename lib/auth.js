// Shared password gate.
// - One password for all guests (SITE_PASSWORD), printed on the invite.
// - On success we set an HttpOnly cookie holding HMAC(SESSION_SECRET, password).
// - Changing either env var logs everyone out.

const COOKIE = 'fe_pass';
const MAX_AGE = 60 * 60 * 24 * 180; // 180 days
const enc = new TextEncoder();

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// guests type this off a paper invite: ignore case and stray spaces
const normalise = (s) => String(s ?? '').trim().toLowerCase();

async function hmac(message) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(env('SESSION_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const tokenFor = (password) => hmac('v1:' + normalise(password));

export async function passwordMatches(input) {
  return safeEqual(await tokenFor(input), await tokenFor(env('SITE_PASSWORD')));
}

export async function sessionCookie() {
  const token = await tokenFor(env('SITE_PASSWORD'));
  return `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export async function isAuthed(request) {
  const header = request.headers.get('cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  if (!match) return false;
  return safeEqual(match[1], await tokenFor(env('SITE_PASSWORD')));
}

export const unauthorised = () =>
  Response.json({ error: 'Please enter the password from your invitation.' }, { status: 401 });

// ---------- admin dashboard ----------
// - Separate password (ADMIN_PASSWORD), only for Fin, Ellie and whoever runs the site.
// - Exact match (trimmed), not case-folded like the guest password.
// - Its own cookie, 30 days. Unset ADMIN_PASSWORD = dashboard switched off.
const ADMIN_COOKIE = 'fe_admin';
const ADMIN_MAX_AGE = 60 * 60 * 24 * 30;
const adminToken = () => hmac('admin-v1:' + String(process.env.ADMIN_PASSWORD).trim());

export const adminEnabled = () => Boolean(process.env.ADMIN_PASSWORD);

export async function adminPasswordMatches(input) {
  if (!adminEnabled()) return false;
  return safeEqual(await hmac('admin-v1:' + String(input ?? '').trim()), await adminToken());
}

export async function adminCookie() {
  return `${ADMIN_COOKIE}=${await adminToken()}; Path=/; Max-Age=${ADMIN_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
}

export async function isAdmin(request) {
  if (!adminEnabled()) return false;
  const header = request.headers.get('cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=([a-f0-9]{64})`));
  return Boolean(match) && safeEqual(match[1], await adminToken());
}
