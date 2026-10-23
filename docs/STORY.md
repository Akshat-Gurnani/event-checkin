# Why this exists, and how it was built

## The problem

A real-estate firm in Lucknow, India (Relive Solutions) ran a two-day property expo — *Lucknow Property Mahotsava 2.0*, 10–11 October 2026, in a hotel — with a dozen-plus builders' tables and a sales team of about 16 relationship managers.

Weeks before the event each relationship manager had invited their own clients by phone and WhatsApp. The master list was a spreadsheet: name, mobile number, *invited by*. On the day, nobody could answer the questions that mattered:

* **Who has actually arrived?** Reception had a paper list and a crowd.
* **Whose guest is this?** A client arrives; the manager who invited them is on the other side of the hall talking to a builder. Meanwhile a *walk-in* who "knows someone on your team" has no record anywhere.
* **How is each manager doing against their invite list?** Invited vs actual, per person, live — while there is still time to call the ones who haven't come.
* **What happens after?** A hall full of conversations that evaporate unless every guest turns into a lead with an owner, a stage and a note.

The owner called it **INVITED vs ACTUAL**. That phrase is the whole product.

## Constraints that shaped every decision

| Constraint | Consequence |
|---|---|
| **Days, not months.** The first line of code was written on 6 October; guests walked in on 10 October. | No framework, no build pipeline, no custom backend. Reach for things that already work. |
| **Guests' phones, staff phones, a hotel with patchy Wi-Fi.** | A web page behind a QR code. No app installs. Aggressive timeouts and retries so a slow network never hangs the form. |
| **Non-technical staff in a loud room.** | Big buttons, one screen per job, alerts that work with the phone locked (Web Push), a "waiting for pickup" banner on the big screen. |
| **Real personal data (names, mobile numbers).** | Locked-down database from day one; PIN and token gates; no secrets in the browser. |
| **The event is live and cannot be paused.** | Every change after launch had to be additive: migrate the database without touching existing check-ins, redeploy the site without breaking open pages, test with a fake team member and clean up after. |
| **One person to run it.** | Everything had to be operable from a phone: the admin console, the QR printout, the team links. |

## The architecture, and why

```
Static website (Vercel)  →  Supabase (Postgres + PostgREST + one Edge Function)
```

* **A QR code and a web page, not an app.** Nobody installs anything for a two-day event. The same page works for the guest and (with a token in the URL) for staff.
* **Postgres does the work.** The business rules — matching numbers to invitees, preventing duplicates, choosing the owner for a walk-in, who may see what — live in SQL functions. That means the front end is "dumb" (easy to change at 11 pm), the rules are enforced in one place, and there is no server process to crash.
* **Everything is an RPC, tables are locked.** The browser holds a *publishable* key that can do nothing except call a short list of functions. Each function checks a PIN or a token. So even though the key is public, the data is not.
* **Web Push, not SMS or WhatsApp APIs.** SMS/WhatsApp need approvals and cost money per message. Web Push is free, instant, standard and works on a locked phone. A database trigger calls an edge function through `pg_net`; the function signs and sends the notification. The signing keys are generated server-side on first use and never leave the database.
* **Vercel for static hosting.** Deploys in seconds, serves headers (CSP, no-store on private pages) from a JSON file.

[docs/ARCHITECTURE.md](ARCHITECTURE.md) has the details.

## How it was built

It was built by one person working with an AI coding assistant (Claude Code), in a tight loop: describe the next problem in plain language → generate and apply the database migration + the page change → test against the real database with a fake team member → deploy → repeat. Several of the later features were built *while the event was running*, in response to what the team asked for at the venue.

### Timeline

| When | What shipped |
|---|---|
| **Day 1 (6 Oct)** | MVP: guest form, invited-vs-walk-in matching, live dashboard, admin console with RSVP upload, QR code. Locked-down schema and RPC pattern. Security pass: per-IP PIN throttle, per-IP check-in rate limit, CSP, SRI on third-party scripts, CSV-injection guard. |
| **Day 2** | Per-team-member personal links; team page with arrived / yet-to-arrive lists; lead stages and notes; rebrand to the company theme. |
| **Day 3** | **Web Push alerts** (service worker, VAPID keys, edge function, database trigger); readiness board ("who has turned alerts on?"); the *walk-in rotation* with an Away toggle. |
| **Day 4 (event eve)** | Observer links for senior staff (view + CSV export + front desk), passing a guest to another team member, duplicate prevention (same number, similar names, second numbers), party size ("who came with you?"), test lists per team member, loading the real master RSVP (700+ rows, cleaned and de-duplicated), day-aware dashboard, name-only invitee cards. |
| **Event days (10–11 Oct)** | Builder-table tagging on the form, the dashboard and each team page; the **Done** button to clear a finished guest from the live feed; **weighted round-robin** for walk-ins who name nobody; CSV "export everything"; **date tabs** so yesterday's guests can be called back today; everything re-editable across days; **multi-select** tables per guest. |
| **After** | Excel follow-up pipeline (master + per-day sheets), per-team-member reports, and an analytics pass with pivots and significance tests ([ANALYTICS.md](ANALYTICS.md)). |

### Decisions worth copying

1. **Make the right thing the only thing.** The check-in function, not the web page, enforces "one check-in per person per day". If a front-end bug slips through, the data is still right.
2. **Additive migrations while live.** New columns are nullable, old RPCs keep working, new behaviour goes in new functions (`rep_dashboard_day` was added next to `rep_dashboard`, not instead of it). Old browser tabs kept working during every deploy.
3. **Deploy the whole site every time.** Early on, a partial deployment dropped some files and broke pages for minutes. After that, every deploy listed *all* files and was verified by comparing hashes of the live files with local copies.
4. **Test with a fake teammate.** Every feature was exercised with a clearly named test user and the test rows were deleted afterwards. Real guests' rows were never edited in tests.
5. **Fail soft in the room.** Network calls time out and retry; the form shows a clear "try again"; the dashboard says "Connection lost — retrying…" instead of freezing.
6. **Write down the unglamorous cases.** Name-only invitees (no phone number), people who check in with a second number, two people with the same name, guests who arrive on the "wrong" day, a team member who passes a guest on. Real events are mostly edge cases.

### Things that went wrong (and what we learned)

* **A SQL alias named like a variable** (`v`) made the dashboard function fail with "column reference is ambiguous" — the dashboard showed "Connection lost" for a few minutes. Lesson: smoke-test the *dashboard* after every change to its function, not just the feature you touched.
* **A partial deploy** left pages referencing files that were not there. Lesson above.
* **A byte-order-mark character** hidden in one JavaScript file made an integrity check fail when a file was re-uploaded. Lesson: deploy by content hash and compare hashes, don't retype files.
* **Links copied from the wrong domain.** The admin page builds team links from the address it is opened on. Opening it on a protected preview domain produced links that asked guests to log in to Vercel. Lesson: document the canonical URL; (a later improvement would be to read it from config).
* **A shared "stage" vocabulary is not a shared standard.** After the event, lead-stage mix differed hugely between team members — largely because some updated every lead and some updated none. Reports that rank people by stage mix would reward diligence, not results. See [ANALYTICS.md](ANALYTICS.md).
* **The preference questionnaire was nearly always skipped** (only a handful of answers out of ~215 check-ins). The real qualification data ended up in the *table tags* and *notes*. Lesson: keep the guest form to what the guest can answer in ten seconds, and capture qualification on the staff side where someone is already talking to the guest.
* **Name-only invitations convert badly.** A batch of ~240 invitees existed only as names on cards, with no phone number. About 1.6% of them showed up versus about 8% for everyone else. If you can't call or message the invitee, they probably won't come.

## What I would do differently

* Store the public site URL in config and generate links from it, so links are always right.
* Add per-person admin accounts (or at least named PINs) for an audit trail.
* Put the "event day" time zone in the database settings instead of in the SQL text.
* Offer a one-click "mark stage" for the whole team at the end of each day, to fix the stage-discipline problem at the source.
* Let the dashboard show *which invitees were contacted* (not just who arrived) so that turnout can be analysed against outreach.

## Credits

Designed and run by the event team at Relive Solutions; built with Claude Code (Anthropic). Front end: vanilla JS. Back end: Supabase (Postgres, PostgREST, Edge Functions), `pg_net`, `pgcrypto`, `pg_trgm`. Hosting: Vercel. Web Push: `web-push`.
