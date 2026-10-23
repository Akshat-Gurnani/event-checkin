# Security and privacy

## What is public, what is not

| Item | Public? | Why it is OK |
|---|---|---|
| Supabase project URL and **publishable (anon) key** in `web/config.js` | **Yes** — every visitor sees them | They only allow calling the whitelisted RPC functions. Tables are unreachable. |
| The website source | Yes | Contains no secrets. |
| **Admin PIN** | **No** | Stored as a bcrypt hash; compared server-side. |
| **Team and observer tokens** | **No** (they are capabilities) | Random 144-bit tokens; each unlocks only its own scope. |
| `service_role` key | **Never share, never commit** | Bypasses everything. The edge function receives it from Supabase's own environment; you never paste it anywhere. |
| VAPID private key, `push_secret` | No | Live only in `private.settings`, a schema not exposed through the API. |

## Defences in place

* **Row-level security on, no policies, grants revoked** → direct table reads/writes by the browser fail. `scripts/smoke_test.sh` verifies this on your deployment.
* **Definer functions with a pinned `search_path`** and fully schema-qualified references.
* **Credential check first** in every function (`is_admin`, `is_viewer`, `rep_from_token`, or the push secret). Private helpers are not executable by `anon`.
* **Throttling**: admin PIN failures are recorded per IP (20 / 15 min) and globally (300 / 15 min); check-ins are rate-limited per IP so a bot cannot flood the list.
* **Input hygiene**: names/phones are trimmed and clamped, party size bounded 0–20, table names must match the configured list, lead stages are constrained by a `CHECK`, and every value is HTML-escaped before rendering. CSV exports neutralise spreadsheet formulas (`=`, `+`, `-`, `@` prefixes).
* **Browser hardening** (`web/vercel.json`): Content-Security-Policy (`script-src 'self'` + two third-party scripts pinned with SRI hashes), `frame-ancestors 'none'`, no referrer, `no-store` on private pages, `noindex`.
* **Push**: the signing key never leaves the database; the edge function authenticates to the database with a random shared secret and to browsers with VAPID.

## Known limitations

Be honest with yourself about these before using the system for anything more sensitive than an expo guest list.

* **One shared admin PIN.** Anyone who knows it can do everything; there is no per-person audit trail. (Hand-overs, links and merges *are* recorded in `checkin_events`.)
* **Tokens live in URLs.** A screenshot of a team link is a credential. Rotate links after the event (`admin_rotate_rep_token`, `admin_observer_rotate`).
* **Observers can edit**, not just view: the dashboard functions they may call include marking Done, changing party size and tables, reassigning, linking, manual check-ins. They cannot delete, merge, import, change settings, or edit lead stages/notes (those need the admin PIN or the owner's team link).
* **A team member can read every field of their own guests**, including phone numbers. That is the point of the system; choose your team accordingly.
* **The guest form is unauthenticated** by nature. Rate limiting and duplicate rules reduce abuse, but anyone with the QR can submit a check-in. Staff can delete bogus rows from the dashboard.
* **No encryption of values at rest beyond what the database provides** (names and numbers are plain text columns).
* **English-only UI**, no accessibility audit.
* The default **PIN in `seed.sql` is a placeholder**. Change it before running the file.

## Personal data

You are collecting names and mobile numbers, plus optional preferences and a *consent to be contacted* tick. Practical guidance (not legal advice):

* Tell guests why you collect it and who will contact them. The form has a consent checkbox; the CSV exports include it — **filter on it before sending marketing messages**.
* Collect the minimum. Every extra question is data you must protect and often will not use (the real event's preference form was skipped by almost everyone).
* Limit who gets links; remove people who no longer need access.
* Know your law: India's DPDP Act 2023, the EU/UK GDPR, CCPA etc. may apply depending on where your guests are.

### Data retention

| Action | How |
|---|---|
| Clear all check-ins, keep the guest list | Admin → *Clear all check-ins* (`admin_reset` with `p_what='checkins'`) |
| Clear everything (list + check-ins) | Admin → *Clear everything* (`p_what='all'`) |
| Remove lead notes/stages too | `truncate public.leads;` in the SQL editor |
| Remove push devices | `truncate private.push_subs;` |
| Remove the whole project | Supabase dashboard → Settings → Delete project |

Back up (export) *before* deleting. Also delete exported spreadsheets from shared drives when you're done.

## Reporting a vulnerability

Open a private security advisory on the repository (Security tab) rather than a public issue, and give a clear reproduction. Please do not test against someone else's live event.
