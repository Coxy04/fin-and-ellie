-- ============================================================
-- Fin & Ellie wedding site: Supabase schema
-- Paste the whole file into Supabase > SQL Editor > New query > Run.
-- Safe to re-run: drops and recreates functions/views, keeps data.
--
-- Security model
-- - Guests never talk to Supabase directly. The Vercel API functions
--   call the two RPCs below with the secret key (service_role).
-- - RLS is on with no policies, and anon/authenticated have no grants,
--   so the publishable/anon key can read or write nothing.
-- ============================================================

-- ---------- tables ----------
create table if not exists public.households (
  id                  bigint generated always as identity primary key,
  name                text not null,                -- "The Smith family"
  message             text,                         -- note to the couple from the RSVP
  message_updated_at  timestamptz,
  created_at          timestamptz not null default now()
);

create table if not exists public.guests (
  id            bigint generated always as identity primary key,
  household_id  bigint not null references public.households(id) on delete cascade,
  full_name     text not null,
  invite_type   text not null default 'day' check (invite_type in ('day','evening')),
  is_child      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists guests_household_idx on public.guests(household_id);

create table if not exists public.rsvps (
  guest_id     bigint primary key references public.guests(id) on delete cascade,
  attending    boolean not null,
  diet         text,
  diet_notes   text,
  song_title   text,
  song_artist  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- lock everything down ----------
alter table public.households enable row level security;
alter table public.guests     enable row level security;
alter table public.rsvps      enable row level security;
revoke all on public.households, public.guests, public.rsvps from anon, authenticated;

-- ---------- find_household ----------
-- - Case-insensitive substring match on any guest's full name.
-- - Needs 3+ characters, returns at most 5 households.
-- - Includes any saved answers so guests can edit their RSVP.
create or replace function public.find_household(search text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with q as (select lower(btrim(coalesce(search, ''))) as s),
  hits as (
    select distinct g.household_id
    from guests g, q
    where length(q.s) >= 3
      and position(q.s in lower(g.full_name)) > 0
    limit 5
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', h.id,
      'name', h.name,
      'message', h.message,
      'guests', (
        select jsonb_agg(jsonb_build_object(
          'id', g.id,
          'name', g.full_name,
          'type', g.invite_type,
          'rsvp', (select to_jsonb(r) - 'guest_id' - 'created_at' from rsvps r where r.guest_id = g.id)
        ) order by g.id)
        from guests g where g.household_id = h.id
      )
    ) order by h.name), '[]'::jsonb)
  from households h
  join hits on hits.household_id = h.id;
$$;

-- ---------- save_rsvp ----------
-- - p_guests: [{id, attending, diet, diet_notes, song_title, song_artist}, ...]
-- - Every guest must belong to p_household_id, or nothing is saved.
-- - Text is trimmed and length-capped; blanks become null.
create or replace function public.save_rsvp(p_household_id bigint, p_guests jsonb, p_message text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  g   jsonb;
  gid bigint;
  n   int := 0;
begin
  if not exists (select 1 from households where id = p_household_id) then
    raise exception 'Unknown household' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_guests) <> 'array' or jsonb_array_length(p_guests) = 0 then
    raise exception 'No guests supplied' using errcode = 'P0001';
  end if;

  for g in select * from jsonb_array_elements(p_guests) loop
    gid := (g->>'id')::bigint;
    if not exists (select 1 from guests where id = gid and household_id = p_household_id) then
      raise exception 'Guest % is not in this household', gid using errcode = 'P0001';
    end if;
    if jsonb_typeof(g->'attending') is distinct from 'boolean' then
      raise exception 'Missing answer for guest %', gid using errcode = 'P0001';
    end if;

    insert into rsvps (guest_id, attending, diet, diet_notes, song_title, song_artist)
    values (
      gid,
      (g->>'attending')::boolean,
      left(nullif(btrim(g->>'diet'), ''), 60),
      left(nullif(btrim(g->>'diet_notes'), ''), 500),
      left(nullif(btrim(g->>'song_title'), ''), 200),
      left(nullif(btrim(g->>'song_artist'), ''), 200)
    )
    on conflict (guest_id) do update set
      attending   = excluded.attending,
      diet        = excluded.diet,
      diet_notes  = excluded.diet_notes,
      song_title  = excluded.song_title,
      song_artist = excluded.song_artist,
      updated_at  = now();
    n := n + 1;
  end loop;

  update households
     set message = left(nullif(btrim(p_message), ''), 2000),
         message_updated_at = now()
   where id = p_household_id;

  return jsonb_build_object('saved', n);
end;
$$;

-- functions are executable by PUBLIC by default: only the server may call these
revoke execute on function public.find_household(text)              from public, anon, authenticated;
revoke execute on function public.save_rsvp(bigint, jsonb, text)    from public, anon, authenticated;
grant  execute on function public.find_household(text)              to service_role;
grant  execute on function public.save_rsvp(bigint, jsonb, text)    to service_role;

-- ============================================================
-- Views for Fin & Ellie (read them in Table Editor or export CSV)
-- - security_invoker so they obey RLS; anon gets nothing.
-- ============================================================
drop view if exists public.rsvp_overview, public.headcount, public.catering, public.dj_songs, public.messages;

-- everyone, one row per guest
create view public.rsvp_overview with (security_invoker = true) as
select h.name        as household,
       g.full_name   as guest,
       g.invite_type,
       g.is_child,
       case when r.guest_id is null then 'no reply'
            when r.attending      then 'attending'
            else 'declined' end as status,
       r.diet, r.diet_notes, r.song_title, r.song_artist,
       r.updated_at
from guests g
join households h on h.id = g.household_id
left join rsvps r on r.guest_id = g.id
order by h.name, g.id;

-- counts by invite type and status
create view public.headcount with (security_invoker = true) as
select invite_type, status, count(*) as guests,
       count(*) filter (where is_child) as children
from public.rsvp_overview
group by invite_type, status
order by invite_type, status;

-- for the caterer: attending guests with any dietary need
create view public.catering with (security_invoker = true) as
select guest, household, invite_type, is_child, diet, diet_notes
from public.rsvp_overview
where status = 'attending'
  and (coalesce(diet, 'No requirements') <> 'No requirements' or diet_notes is not null)
order by diet, guest;

-- for the DJ: one row per song, with who asked
create view public.dj_songs with (security_invoker = true) as
select initcap(song_title) as song,
       initcap(coalesce(song_artist, '')) as artist,
       count(*) as requests,
       string_agg(guest, ', ' order by guest) as requested_by
from public.rsvp_overview
where status = 'attending' and song_title is not null
group by initcap(song_title), initcap(coalesce(song_artist, ''))
order by requests desc, song;

-- notes left for the couple
create view public.messages with (security_invoker = true) as
select name as household, message, message_updated_at
from public.households
where message is not null
order by message_updated_at desc;

revoke all on public.rsvp_overview, public.headcount, public.catering, public.dj_songs, public.messages
  from anon, authenticated;
