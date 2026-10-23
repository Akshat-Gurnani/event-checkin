# Deployment guide

Time needed: about 30 minutes the first time. Cost: free tiers of Supabase and Vercel are enough for a typical event (hundreds of guests, a few dozen open dashboards).

You need accounts on **Supabase** and a static host (**Vercel** is documented; Netlify, Cloudflare Pages or GitHub Pages also work — you will just set the security headers yourself, see step 4).

## 1. Create the Supabase project

1. supabase.com → **New project**. Pick the region closest to your venue and a strong database password (you will not need it for this app).
2. Wait for it to finish provisioning.
3. Open **Project Settings → API** and note two values:
   * **Project URL** — `https://<ref>.supabase.co`  (the `<ref>` is your *project ref*)
   * **Publishable key** (`sb_publishable_…`) or the legacy **anon** key. Both are fine; this key is designed to be public.

## 2. Create the database

1. Decide your **time zone**. The SQL decides what "today" is using `Asia/Kolkata`. If your venue is elsewhere, open `supabase/schema.sql` in an editor and find-and-replace `Asia/Kolkata` with your IANA zone (e.g. `Europe/London`, `America/New_York`) **before** running it. (10 occurrences.)
2. **SQL editor → New query** → paste all of `supabase/schema.sql` → **Run**.
   * If it complains about `pg_net`, go to **Database → Extensions**, enable **pg_net**, and run again.
3. Open `supabase/seed.sql`, change the three `CHANGE ME` values:
   * the **admin PIN** (6+ characters; you type it to open Admin and the dashboard),
   * your **project ref** in `push_functions_url`,
   * the **contact e-mail** in `push_subject` (push services want a contact address).

   Replace the sample team, tables and questions or leave them and edit later in Admin. Run it.
4. Verify: **Table editor** should show `rsvp`, `checkins`, `leads`, `phone_aliases`, `checkin_events` (empty). Run `select name from private.rep_tokens;` — you should see your team.

## 3. Deploy the push-notification function (optional but recommended)

Without it everything works except background alerts: team members will still see new guests when they open their page.

**With the Supabase CLI**

```bash
npm i -g supabase            # or brew install supabase/tap/supabase
supabase login
supabase link --project-ref <ref>
supabase functions deploy push-notify --no-verify-jwt
```

**Without the CLI**: Dashboard → **Edge Functions → Deploy a new function**, name it exactly `push-notify`, paste `supabase/functions/push-notify/index.ts`, and turn **Verify JWT off** in the function's settings.

No secrets to set: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. The function creates its own VAPID signing keys the first time a notification is sent.

## 4. Deploy the website

1. Edit **`web/config.js`**: paste your project URL and publishable key, and set `TIME_ZONE` to the same zone you used in step 2.
2. Deploy the `web/` folder.

   **Vercel (UI):** New Project → import your fork of this repo → **Root Directory: `web`** → Framework preset **Other** → no build command, no output directory → Deploy.
   **Vercel (CLI):** `cd web && vercel --prod`.

   The included `web/vercel.json` sets the security headers (CSP, frame denial, `no-store` on private pages, `noindex`). On another host, set equivalent headers; at minimum make `dashboard`, `admin` and `rep` pages **non-cacheable**.
3. Open your site's URL. You should see the guest check-in form with your event name.

> **Use one canonical URL** (your production domain, not a preview URL). Team links are built from the address you open Admin on — if you open Admin on a protected preview domain, the links you hand out will ask your guests to log in to Vercel.

## 5. First-time setup in Admin

Open `https://<your-site>/admin.html` and enter the PIN.

1. **Upload the guest list.** Drop a CSV/XLSX or paste from a spreadsheet. The columns are found by header text: a name column, a phone/mobile/number column, and optionally *invited by* (also matches *referred, team, owner, agent, rm, sales*). Duplicates by phone are dropped; invalid rows are reported.
   **Replace entire list** swaps the whole list (existing check-ins are re-matched); **Add / update guests** adds to it. Team members named in *invited by* automatically get personal links.
2. **Event & form settings.** Event name, welcome line, *extra team members* (people who can be named on the form even though they invited nobody — names in the RSVP *invited by* column are added automatically), the table/project list, and your preference questions. Save.
3. **QR code.** Print it large (the page offers it at poster size) and put it at the entrance. There is also a **kiosk URL** (`?kiosk=1`) that resets the form for the next person after a few seconds — good for a tablet at the door.
4. **Team links.** Section 4 lists every person's personal link. Send each one privately (WhatsApp is fine). Ask everyone to open theirs and tap **Enable alerts**. The dashboard's *readiness board* shows who has done it.
5. **Observers** (optional). Add senior staff by name; each gets a link that opens the dashboard and front desk without the PIN.

## 6. Test before the day

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_KEY=<publishable key> ADMIN_PIN=<pin> scripts/smoke_test.sh
```

It checks the config endpoint, the PIN gate, the dashboard, and — importantly — that anonymous visitors **cannot** read `checkins`, `rsvp`, `leads` or `phone_aliases`.

Then do a dry run with a fake guest (use an obviously fake name):

1. Scan the QR on your phone, check in naming a team member who has alerts on. Their phone should buzz within a few seconds.
2. Check the dashboard updated; try **Done**, **Reassign**, **Party**.
3. Delete the test row from the dashboard (× button) so it does not pollute your numbers, or use **Admin → *Clear all check-ins*** before the event starts.

## 7. Changing the PIN

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/admin_set_pin" \
  -H "apikey: $SUPABASE_KEY" -H "Content-Type: application/json" \
  -d '{"p_pin":"old-pin","p_new_pin":"a-much-better-pin"}'
```

## 8. After the event

* Export everything: dashboard → **Export everything**, or `python tools/export_report.py` ([ANALYTICS.md](ANALYTICS.md)).
* Rotate or retire links: Admin → team links → rotate; remove observers.
* Delete personal data when you no longer need it: Admin → *Clear everything* (see [SECURITY.md](SECURITY.md#data-retention)).
* Pause or delete the Supabase project if the event is over.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Form says "We couldn't load the check-in form" | `config.js` URL/key wrong; or the schema wasn't run. Open the browser console: the app logs *Missing Supabase settings*. |
| Dashboard keeps asking for the PIN | PIN wrong, or you changed it with `admin_set_pin` and a saved PIN is stale: log out (Admin → log out). |
| "Connection lost — retrying…" | Network blip (it retries), or a database function raised an error — check **Logs → Postgres** in Supabase. |
| Team link says "This link isn't valid" | Token rotated, or `private.rep_tokens` missing that person (run `select private.ensure_reps();`). |
| No push alerts | Edge function not deployed / JWT verification left on; `push_functions_url` wrong; the person hasn't tapped *Enable alerts*; on iPhone the page must be added to the Home Screen (iOS ≥ 16.4). Use **Send me a test** on the team page. |
| Alerts fire for the wrong person | The guest named a different team member than the one who invited them — both are notified. |
| Everyone's "day" is off by one near midnight | Time zone mismatch between `schema.sql`, `config.js` and the venue. |
| Team links ask guests to log in to Vercel | You generated them on a protected preview URL. Regenerate on the production domain. |
| `permission denied` in the SQL editor when running seed | Run it as the default `postgres` role in the SQL editor. |
