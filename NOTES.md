# Fin & Ellie wedding site — working notes

## Files

- `public/index.html` — the single-page site. Opened from disk it uses a fake guest list; on Vercel it uses the real API.
- `public/login.html` — the lift-pass password page.
- `public/img/` — artwork cut from the invite, plus the story photos.
  - `pug.webp`, `board-front.webp`, `board-back.webp`: the invite drawings, recoloured to the page ink with the printed text removed. The page lays live text over the blank areas.
  - `photo-1.svg` … `photo-5.svg`: placeholders for the cable-car polaroids.
  - `pug.webp` is the only file here that loads before login. Everything else stays behind the password.
- `middleware.js` — blocks every page and API call until the guest has the password cookie.
- `api/` — `login`, `find` (name search), `rsvp` (save), `keepalive` (daily cron).
- `lib/` — shared password-cookie and Supabase helpers.
- `supabase/schema.sql` — tables, the two database functions, and the admin views.
- `scripts/import-guests.mjs` — loads the guest list from a CSV.
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
