# Deploying the wedding site

About 20 minutes end to end. You need free accounts on Supabase, GitHub and Vercel. Run every command from this folder, in PowerShell or Git Bash.

## 1. Supabase: create the database

1. Go to supabase.com and create a new project.
   - **Region:** West EU (London).
   - Save the database password somewhere. You won't need it day to day.
2. Open **SQL Editor**, then **New query**. Paste all of `supabase/schema.sql` and click **Run**.
   - It should say "Success. No rows returned".
   - It's safe to run again later if the schema changes.
3. Collect two values:
   - **Project URL**: Project Settings › Data API. It looks like `https://abcd1234.supabase.co`.
   - **Secret key**: Project Settings › API Keys › Secret keys. Create one if needed. It starts `sb_secret_`.
   - Do **not** use the publishable key. Nothing in this site uses it.

## 2. Local config

1. Copy `.env.example` to `.env.local`.
2. Fill in all five values. Generate the two random secrets with this command:
   ```
   node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
   ```
3. `.env.local` is git-ignored and Vercel-ignored. Keep it off any shared drive if you can.
   - OneDrive syncs it. That's acceptable for a wedding site, but don't share the folder.

## 3. Load the guest list

1. Copy `supabase/guests.example.csv` to `guests.csv` in this folder. It is git-ignored.
2. Fill it in from the wedding spreadsheet. One row per person.
   - **household**: groups people who RSVP together, e.g. "The Smith family". Use the exact same text for everyone in it.
   - **full_name**: what guests will type to find themselves. Use the name they'd recognise.
   - **invite_type**: `day` or `evening`.
   - **is_child**: `yes` or `no`.
3. Check it, then import it:
   ```
   npm run import-guests -- guests.csv --dry-run
   npm run import-guests -- guests.csv
   ```
4. Re-running is safe. People already in the database are skipped, so add late guests to the CSV and run it again.
   - Renames and deletions are done in Supabase › Table Editor › `guests`.

## 4. GitHub: put the code online

1. On github.com, click **New repository**.
   - **Name:** `fin-and-ellie`.
   - **Private.** The site isn't secret, but there's no reason for it to be public.
   - Don't add a README, .gitignore or licence. This folder already has what it needs.
2. Push this folder to it. Swap in your GitHub username:
   ```
   git remote add origin https://github.com/YOUR-USERNAME/fin-and-ellie.git
   git push -u origin main
   ```
   - The first push opens a browser window to sign in to GitHub.
3. Never committed, by design: `.env.local`, any `.csv` except the template, and the reference photos.

## 5. Vercel: deploy from GitHub

1. On vercel.com, click **Add New › Project**, then **Import** next to `fin-and-ellie`.
   - If it isn't listed, connect GitHub and give Vercel access to that one repository.
2. **Framework Preset:** Other. Leave the build and output settings alone, `vercel.json` sets them.
3. Open **Environment Variables** and add all five from `.env.local`.
   - `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SITE_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`.
   - Apply them to **Production** and **Preview**.
4. Click **Deploy**. You get a URL like `fin-and-ellie.vercel.app`.
5. From now on:
   - Every push to `main` goes live automatically.
   - A push to any other branch gets its own preview URL, so you can check a change before merging.
   - Environment variable changes need a redeploy: Deployments › latest › **Redeploy**.

## 6. Smoke test

1. Open the URL in a private window. You should land on the lift-pass login.
2. Enter a wrong password, then the right one.
3. RSVP as a real guest. Put "TEST" in the message.
4. In Supabase › Table Editor, open the `rsvp_overview` view. Your test row should be there.
5. Delete the test row from the `rsvps` table. Clear the message in `households`.

## 7. Custom domain (optional)

1. Buy the domain anywhere, e.g. `finandellie.co.uk`.
2. In Vercel › Project › Settings › Domains, add it and follow the DNS instructions.
3. Print that domain and the password on the invites.

## Reading the RSVPs

Fin and Ellie can be invited to the Supabase project as members, or you can export for them. In **Table Editor** these views are ready-made, and each one exports to CSV:

| View | For |
| --- | --- |
| `rsvp_overview` | Everyone, one row per guest, with status |
| `headcount` | Attending, declined and no-reply counts, day vs evening |
| `catering` | Attending guests with dietary needs |
| `dj_songs` | Song requests, merged and counted |
| `messages` | Notes left for the couple |

## Changing things later

- **Page content:** edit `public/index.html`, then commit and push:
  ```
  git add -A
  git commit -m "Update hotels"
  git push
  ```
  - To preview locally, open `public/index.html` straight from disk. It uses a fake guest list and saves to the browser only.
- **Password:** change `SITE_PASSWORD` in Vercel › Settings › Environment Variables, then redeploy. Everyone has to log in again.
- **Database schema:** re-run `supabase/schema.sql` in the SQL Editor. Pushing to GitHub doesn't touch Supabase.
- **Lock RSVPs after the deadline:** easiest is to replace the RSVP button text with "RSVPs are closed" and push.
