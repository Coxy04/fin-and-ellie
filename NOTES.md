# Fin & Ellie wedding site — working notes

## Files

- `public/index.html` — the single-page site. Opened from disk it uses a fake guest list; on Vercel it uses the real API.
- `public/login.html` — the lift-pass password page.
- `public/img/` — artwork cut from the invite, plus the story photos.
  - `pug.webp`, `board-front.webp`: the invite drawings, recoloured to the page ink with the printed text removed. The page lays live text over the blank area.
  - The Travel skis are drawn in the page itself, not images.
  - `photo-1.jpg` … `photo-5.jpg`: the cable-car polaroids, 900 px square. Full-size originals are in `photo-originals/` (not committed, not deployed).
  - `pug.webp` is the only file here that loads before login. Everything else stays behind the password.
- `middleware.js` — blocks every page and API call until the guest has the password cookie.
- `public/admin.html` — the RSVP dashboard. Tap the F & E logo five times, then the admin password.
- `api/` — `login`, `find` (name search), `rsvp` (save), `keepalive` (daily cron), `admin` + `admin-login` (dashboard).
- `lib/` — shared password-cookie and Supabase helpers.
- `supabase/schema.sql` — tables, the two database functions, and the admin views.
- `scripts/import-guests.mjs` — loads the guest list from Excel (.xlsx) or CSV, grouping families and partners.
- `supabase/guests-template.xlsx` — the guest list template (Full name, Family / partner, Invite, Child).
- `DEPLOY.md` — step-by-step setup for Supabase and Vercel.
- `wedding-site.html` — the original multi-tab mockup, kept for reference. Safe to delete.

## Content still to confirm (search for these in `index.html`)

- Venue postcode and full address. The invite says "The Ashes Barns"; the old mockup said
  Nottinghamshire. I've assumed The Ashes Barns in Endon, Staffordshire. Check with Ellie.
- Taxi firm names and numbers (two placeholders).
- Hotel / B&B names and distances (three placeholders).
- Run-of-the-day times. Only 12:15 arrival and 13:00 ceremony are from the invite; the rest are
  guesses.
- RSVP deadline (currently 1 March 2027, carried over from the old mockup).
- Gift wording and the "Contribute" link (honeymoon fund, bank details, or remove the section).
- FAQ answers, especially "Will the pug be there?" and the phone-free ceremony line.
- The site password to print on the invites. Short, memorable, not case-sensitive.
- The story text behind each polaroid: the `data-story` attribute on each `figure` in `index.html`.
- Five photos for "The ride up" and their captions.
  - Save square-ish photos as `public/img/photo-1.jpg` … `photo-5.jpg`, then change the matching `src` in `index.html` (search for `photo-`).
  - Captions are the `figcaption` text next to each one. Keep them short, they're handwritten-style.
  - Keep each photo under about 300 KB. 1000 px square is plenty.

## How it works

- Guests never talk to Supabase directly. The Vercel API routes call two database functions with the secret key.
- Supabase tables have row-level security on and no public grants. The publishable key can read or write nothing.
- The shared password is checked server-side. A signed HttpOnly cookie lasts 180 days.
- Guests find themselves by typing 3+ letters of any name in their household. They see and can edit that household only.
- Free Supabase projects pause after a week idle. A daily Vercel cron calls `/api/keepalive` to prevent that.

See DEPLOY.md for setup.

## Hidden extras

- Tap the hero pug three times: he skis across the screen.
- Tap the F & E logo five times: the RSVP dashboard (needs `ADMIN_PASSWORD`).
