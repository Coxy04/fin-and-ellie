// Minimal Supabase RPC client (no SDK needed).
// - Uses the secret key, so it must only ever run server-side.
// - New sb_secret_ keys go in the apikey header only; legacy service_role JWTs also need Bearer.

export async function rpc(fn, args) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SECRET_KEY is not set');

  const headers = { 'Content-Type': 'application/json', apikey: key };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.message || `Supabase returned ${res.status}`);
    err.code = body?.code;
    err.status = res.status;
    throw err;
  }
  return body;
}
