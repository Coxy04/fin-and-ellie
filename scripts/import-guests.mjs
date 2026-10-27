// Import the guest list from a CSV into Supabase.
//   npm run import-guests -- guests.csv            (writes)
//   npm run import-guests -- guests.csv --dry-run  (just shows what it would do)
//
// CSV columns (header row required):
//   household,full_name,invite_type,is_child
//   The Smith family,Pat Smith,day,no
//
// - Rows with the same household text are grouped into one household.
// - Safe to re-run: existing households (by name) and guests (by name within
//   the household) are skipped, so you can add people to the CSV and import again.
// - Never deletes anything. Remove people in the Supabase Table Editor.
import { readFileSync } from 'node:fs';

const [file, flag] = process.argv.slice(2);
const dryRun = flag === '--dry-run';
if (!file) {
  console.error('Usage: npm run import-guests -- guests.csv [--dry-run]');
  process.exit(1);
}

const URL_ = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.');
  process.exit(1);
}
const headers = { 'Content-Type': 'application/json', apikey: KEY, Prefer: 'return=representation' };
if (!KEY.startsWith('sb_')) headers.Authorization = `Bearer ${KEY}`;

async function api(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status} ${path}: ${body?.message || JSON.stringify(body)}`);
  return body;
}

// small CSV parser: handles quoted fields, commas and "" inside quotes
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

const rows = parseCSV(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const head = rows.shift().map((h) => h.trim().toLowerCase());
const col = (name) => {
  const i = head.indexOf(name);
  if (i < 0 && name !== 'is_child' && name !== 'invite_type') throw new Error(`CSV is missing a "${name}" column`);
  return i;
};
const [iH, iN, iT, iC] = ['household', 'full_name', 'invite_type', 'is_child'].map(col);

const wanted = new Map(); // household name -> guests[]
const problems = [];
rows.forEach((r, n) => {
  const household = r[iH]?.trim();
  const full_name = r[iN]?.trim();
  const type = (iT >= 0 ? r[iT] : '')?.trim().toLowerCase() || 'day';
  const child = /^(y|yes|true|1)$/i.test((iC >= 0 ? r[iC] : '')?.trim() || '');
  if (!household || !full_name) return problems.push(`row ${n + 2}: household and full_name are required`);
  if (!['day', 'evening'].includes(type)) return problems.push(`row ${n + 2}: invite_type must be day or evening, got "${type}"`);
  if (!wanted.has(household)) wanted.set(household, []);
  wanted.get(household).push({ full_name, invite_type: type, is_child: child });
});
if (problems.length) {
  console.error('Fix these rows and run again:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const existingH = await api('households?select=id,name');
const existingG = await api('guests?select=household_id,full_name');
const hByName = new Map(existingH.map((h) => [h.name.toLowerCase(), h.id]));
const gKey = (hid, name) => `${hid}|${name.toLowerCase()}`;
const gSeen = new Set(existingG.map((g) => gKey(g.household_id, g.full_name)));

let newH = 0, newG = 0, skipped = 0;
for (const [name, guests] of wanted) {
  let hid = hByName.get(name.toLowerCase());
  if (!hid) {
    newH++;
    if (dryRun) { console.log(`+ household  ${name}`); hid = `new:${name}`; }
    else {
      [{ id: hid }] = await api('households', { method: 'POST', body: JSON.stringify({ name }) });
      hByName.set(name.toLowerCase(), hid);
    }
  }
  const toAdd = guests.filter((g) => !gSeen.has(gKey(hid, g.full_name)));
  skipped += guests.length - toAdd.length;
  if (!toAdd.length) continue;
  newG += toAdd.length;
  if (dryRun) toAdd.forEach((g) => console.log(`+ guest      ${g.full_name}  (${g.invite_type}${g.is_child ? ', child' : ''})  -> ${name}`));
  else await api('guests', { method: 'POST', body: JSON.stringify(toAdd.map((g) => ({ ...g, household_id: hid }))) });
  toAdd.forEach((g) => gSeen.add(gKey(hid, g.full_name)));
}

console.log(`${dryRun ? '[dry run] would add' : 'Added'} ${newH} households and ${newG} guests. ${skipped} already there.`);
