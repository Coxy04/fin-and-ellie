// Import the guest list into Supabase from Excel (.xlsx) or CSV.
//   npm run import-guests -- guests.xlsx            (writes)
//   npm run import-guests -- guests.xlsx --dry-run  (just shows what it would do)
//   node scripts/import-guests.mjs guests.xlsx --sql > guests.import.local.sql
//      (no keys needed: writes SQL to paste into Supabase > SQL Editor instead)
//
// Columns (first row = headings, any order, not case-sensitive):
//   Full name          required
//   Family / partner   who they reply with. Either:
//                        - the same word on everyone in a group ("Smiths"), or
//                        - the name of their partner / family member(s) ("Jo Smith",
//                          or several: "Jo Smith, Max Smith").
//                      Leave blank for someone who replies on their own.
//   Invite             day or evening (blank = day)
//   Child              yes / no (blank = no)
// Older CSVs with a "household" column still work.
//
// - People linked by Family / partner become one household: whoever finds their
//   name on the site can reply for all of them.
// - Safe to re-run. New people are added; people already in the database are
//   matched by name and moved into their group if it changed (their RSVP goes
//   with them). Households left empty by a move are removed.
// - Never deletes guests. Remove people in Supabase > Table Editor.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const [file, flag] = process.argv.slice(2);
const dryRun = flag === '--dry-run';
const sqlMode = flag === '--sql';
if (!file) {
  console.error('Usage: npm run import-guests -- guests.xlsx [--dry-run]');
  process.exit(1);
}

const URL_ = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!sqlMode && (!URL_ || !KEY)) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.');
  process.exit(1);
}
const headers = { 'Content-Type': 'application/json', apikey: KEY, Prefer: 'return=representation' };
if (KEY && !KEY.startsWith('sb_')) headers.Authorization = `Bearer ${KEY}`;

async function api(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status} ${path}: ${body?.message || JSON.stringify(body)}`);
  return body;
}

// ---------------------------------------------------------------- reading files
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
  return rows;
}

// minimal .xlsx reader: unzip, then read the first sheet's cells (text and numbers)
function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not an .xlsx file (could not read it as a zip)');
  const files = {};
  let p = buf.readUInt32LE(e + 16);
  for (let n = buf.readUInt16LE(e + 10); n--; ) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const local = buf.readUInt32LE(p + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files[name] = () => (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    p += 46 + nameLen + extra + comment;
  }
  return files;
}
const xmlText = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function parseXLSX(buf) {
  const z = unzip(buf);
  const shared = z['xl/sharedStrings.xml'] ? [...z['xl/sharedStrings.xml']().matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, ''))) : [];
  // first sheet in workbook order
  const rels = z['xl/_rels/workbook.xml.rels']?.() || '';
  const firstId = (z['xl/workbook.xml']?.() || '').match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const target = rels.match(new RegExp(`Id="${firstId}"[^>]*Target="([^"]+)"`))?.[1] || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${firstId}"`))?.[1];
  const sheetPath = target ? 'xl/' + target.replace(/^\/?xl\//, '') : 'xl/worksheets/sheet1.xml';
  const sheet = (z[sheetPath] || z['xl/worksheets/sheet1.xml'])();
  const rows = [];
  for (const [, rowXml] of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const [, attrs, inner] of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1] || '';
      const col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const type = attrs.match(/t="(\w+)"/)?.[1];
      const v = inner?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = '';
      if (type === 's') val = shared[+v] ?? '';
      else if (type === 'inlineStr') val = xmlText(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] || '');
      else if (v != null) val = xmlText(v);
      row[col >= 0 ? col : row.length] = val;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

const raw = readFileSync(file);
const rows = (/\.xlsx$/i.test(file) ? parseXLSX(raw) : parseCSV(raw.toString('utf8').replace(/^﻿/, '')))
  .filter((r) => r.some((f) => String(f).trim()));

// ---------------------------------------------------------------- columns
const norm = (h) => String(h).toLowerCase().replace(/[^a-z]/g, '');
const head = rows.shift().map(norm);
const find = (...names) => head.findIndex((h) => names.includes(h));
const iN = find('fullname', 'name', 'guest', 'guestname');
const iG = find('familypartner', 'familyorpartner', 'partnerfamily', 'family', 'partner', 'household', 'group');
const iT = find('invite', 'invitetype', 'invitedayorevening', 'type');
const iC = find('child', 'ischild', 'childyesno');
if (iN < 0) { console.error('The sheet needs a "Full name" column.'); process.exit(1); }

// ---------------------------------------------------------------- rows -> people
const people = [];
const problems = [];
const byName = new Map();
rows.forEach((r, n) => {
  const line = n + 2;
  const full_name = String(r[iN] ?? '').trim().replace(/\s+/g, ' ');
  if (!full_name) return problems.push(`row ${line}: Full name is empty`);
  let type = String(iT >= 0 ? r[iT] ?? '' : '').trim().toLowerCase();
  type = !type || /day|all/.test(type) ? 'day' : /even/.test(type) ? 'evening' : type;
  if (!['day', 'evening'].includes(type)) return problems.push(`row ${line}: Invite must be day or evening, got "${r[iT]}"`);
  if (byName.has(full_name.toLowerCase())) return problems.push(`row ${line}: "${full_name}" is on the list twice`);
  const p = {
    full_name, invite_type: type,
    is_child: /^(y|yes|true|1)$/i.test(String(iC >= 0 ? r[iC] ?? '' : '').trim()),
    link: String(iG >= 0 ? r[iG] ?? '' : '').trim(),
    line,
  };
  byName.set(full_name.toLowerCase(), p);
  people.push(p);
});
if (problems.length) {
  console.error('Fix these rows and run again:\n  ' + problems.join('\n  '));
  process.exit(1);
}

// group people: union anyone who names each other, or shares the same group word
const parent = new Map(people.map((p) => [p, p]));
const root = (p) => (parent.get(p) === p ? p : (parent.set(p, root(parent.get(p))), parent.get(p)));
const join = (a, b) => parent.set(root(a), root(b));
const labels = new Map();
for (const p of people) {
  if (!p.link) continue;
  const asName = byName.get(p.link.toLowerCase());
  const parts = asName ? [p.link] : p.link.split(/\s*(?:,|;|\/|&|\+|\band\b)\s*/i).filter(Boolean);
  const allNames = parts.every((t) => byName.has(t.toLowerCase()));
  if (allNames) parts.forEach((t) => join(p, byName.get(t.toLowerCase())));
  else {
    const key = p.link.toLowerCase();
    if (labels.has(key)) join(p, labels.get(key)); else labels.set(key, p);
  }
}
const groups = new Map();
for (const p of people) {
  const r = root(p);
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(p);
}

// a friendly household name, shown nowhere public but used in the dashboard
function householdName(members) {
  const names = members.map((m) => m.full_name);
  if (names.length === 1) return names[0];
  const surnames = new Set(names.map((n) => n.split(' ').slice(-1)[0].toLowerCase()));
  const firsts = names.map((n) => n.split(' ')[0]);
  if (surnames.size === 1) {
    const sur = names[0].split(' ').slice(-1)[0];
    return names.length === 2 ? `${firsts[0]} & ${firsts[1]} ${sur}` : `The ${sur} family`;
  }
  return names.length === 2 ? `${names[0]} & ${names[1]}` : `${firsts.slice(0, -1).join(', ')} & ${firsts.at(-1)}`;
}

// ---------------------------------------------------------------- --sql: same result, as one SQL script
if (sqlMode) {
  const data = [...groups.values()].map((m) => ({
    household: householdName(m),
    people: m.map(({ full_name, invite_type, is_child }) => ({ full_name, invite_type, is_child })),
  }));
  const json = JSON.stringify(data, null, 1);
  if (json.includes('$guests$')) throw new Error('A name contains "$guests$"');
  console.log(`-- Guest list import, generated from ${file.split(/[\/]/).pop()} on ${new Date().toISOString().slice(0, 10)}
-- Paste into Supabase > SQL Editor > Run. Safe to run more than once.
-- - Adds new people, moves existing people (matched by name) into their family group,
--   updates invite/child, and removes households left empty. RSVPs stay with each person.
-- - Never deletes guests. People in the database but not in the sheet are left alone.
do $$
declare grp jsonb; p jsonb; hid bigint; gid bigint;
begin
  for grp in select * from jsonb_array_elements($guests$${json}$guests$::jsonb) loop
    -- reuse the household most of this group is already in
    select g.household_id into hid from public.guests g
     where lower(g.full_name) in (select lower(x->>'full_name') from jsonb_array_elements(grp->'people') x)
     group by g.household_id order by count(*) desc, g.household_id limit 1;
    if hid is null then
      insert into public.households(name) values (grp->>'household') returning id into hid;
    else
      update public.households set name = grp->>'household' where id = hid;
    end if;
    for p in select * from jsonb_array_elements(grp->'people') loop
      select id into gid from public.guests where lower(full_name) = lower(p->>'full_name') limit 1;
      if gid is null then
        insert into public.guests(household_id, full_name, invite_type, is_child)
        values (hid, p->>'full_name', p->>'invite_type', (p->>'is_child')::boolean);
      else
        update public.guests set household_id = hid, invite_type = p->>'invite_type', is_child = (p->>'is_child')::boolean where id = gid;
      end if;
    end loop;
  end loop;
  delete from public.households h where not exists (select 1 from public.guests g where g.household_id = h.id);
end $$;

-- what it looks like now
select h.name as household, string_agg(g.full_name, ', ' order by g.id) as people, count(*) as guests
from public.guests g join public.households h on h.id = g.household_id
group by h.id, h.name order by h.name;`);
  process.exit(0);
}

// ---------------------------------------------------------------- sync
const existingH = await api('households?select=id,name');
const existingG = await api('guests?select=id,household_id,full_name,invite_type,is_child');
const gByName = new Map(existingG.map((g) => [g.full_name.toLowerCase(), g]));
const hById = new Map(existingH.map((h) => [h.id, h]));
const count = { hNew: 0, hRenamed: 0, gNew: 0, gMoved: 0, gUpdated: 0, same: 0, hRemoved: 0 };
const touchedOld = new Set();
const movedIds = new Set();
const say = (s) => console.log((dryRun ? '[dry run] ' : '') + s);

for (const members of groups.values()) {
  const name = householdName(members);
  const found = members.map((m) => gByName.get(m.full_name.toLowerCase())).filter(Boolean);
  // reuse the household most of them are already in
  const tally = new Map();
  found.forEach((g) => tally.set(g.household_id, (tally.get(g.household_id) || 0) + 1));
  let hid = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!hid) {
    count.hNew++; say(`+ household   ${name}`);
    if (dryRun) hid = `new:${name}`;
    else [{ id: hid }] = await api('households', { method: 'POST', body: JSON.stringify({ name }) });
  } else if (hById.get(hid)?.name !== name) {
    count.hRenamed++; say(`~ household   "${hById.get(hid).name}" -> "${name}"`);
    if (!dryRun) await api(`households?id=eq.${hid}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  }
  const toAdd = [];
  for (const m of members) {
    const g = gByName.get(m.full_name.toLowerCase());
    const row = { full_name: m.full_name, invite_type: m.invite_type, is_child: m.is_child };
    if (!g) { toAdd.push(row); continue; }
    const patch = {};
    if (g.household_id !== hid) { patch.household_id = hid; touchedOld.add(g.household_id); movedIds.add(g.id); count.gMoved++; say(`> move        ${m.full_name} -> ${name}`); }
    if (g.invite_type !== m.invite_type || g.is_child !== m.is_child) {
      Object.assign(patch, { invite_type: m.invite_type, is_child: m.is_child });
      if (!patch.household_id) { count.gUpdated++; say(`~ update      ${m.full_name} (${m.invite_type}${m.is_child ? ', child' : ''})`); }
    }
    if (!Object.keys(patch).length) { count.same++; continue; }
    if (!dryRun) await api(`guests?id=eq.${g.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }
  if (toAdd.length) {
    count.gNew += toAdd.length;
    toAdd.forEach((g) => say(`+ guest       ${g.full_name}  (${g.invite_type}${g.is_child ? ', child' : ''})  -> ${name}`));
    if (!dryRun) await api('guests', { method: 'POST', body: JSON.stringify(toAdd.map((g) => ({ ...g, household_id: hid }))) });
  }
}

// tidy households emptied by moves
for (const hid of touchedOld) {
  const stillUsed = dryRun
    ? existingG.some((g) => g.household_id === hid && !movedIds.has(g.id))
    : (await api(`guests?select=id&household_id=eq.${hid}`)).length > 0;
  if (stillUsed) continue;
  count.hRemoved++; say(`- household   ${hById.get(hid)?.name} (now empty)`);
  if (!dryRun) await api(`households?id=eq.${hid}`, { method: 'DELETE' });
}

const notInFile = existingG.filter((g) => !byName.has(g.full_name.toLowerCase()));
console.log(`\n${dryRun ? 'Would add' : 'Added'} ${count.gNew} guests and ${count.hNew} households, moved ${count.gMoved}, updated ${count.gUpdated}, ` +
  `renamed ${count.hRenamed} households, removed ${count.hRemoved} empty ones. ${count.same} already up to date.`);
if (notInFile.length) console.log(`In the database but not in this file (left alone): ${notInFile.map((g) => g.full_name).join(', ')}`);
