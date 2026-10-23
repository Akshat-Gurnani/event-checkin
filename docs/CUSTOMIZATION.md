# Customising for your event

Most of what you will want to change is **configuration**, not code. Anything that needs code is a small, local edit.

## 1. Configure in the Admin page (no code)

| Setting | Where | Notes |
|---|---|---|
| Event name and welcome line | Admin → Event & form settings | Shown on the form, page titles, dashboard. |
| Team members | Admin → Event & form settings → *Extra team members* | Everyone named in the RSVP *invited by* column is a team member automatically; add anyone else here. This is the list guests choose from ("Which team member are you in touch with?"). Each gets a personal link. |
| Tables / projects | Admin → Event & form settings → "Builder tables" (one per line) | Guests tick the ones they visit; staff can edit them later; multiple per guest. |
| Preference questions | Admin → Event & form settings → *+ Add question* | Each has a label, `single` or `multi` type, and options (one per line); the key is generated from the label. Keep it short (3 or fewer): in the real event most guests skipped them. |
| Walk-in shares | `private.settings.walkin_weights` | `update private.settings set value = '{"asha":30,"bilal":70}' where key='walkin_weights';` Keys are lower-case team names. Delete the row to use "least busy first". |
| Who takes walk-ins | Dashboard → readiness board checkboxes ("Takes walk-ins", "Available") | Team members can also mark themselves Away on their own page. |

## 2. Rebrand

| What | Edit |
|---|---|
| Colours | CSS variables at the top of `web/style.css` (`--accent`, `--navy`, backgrounds, text). Dark theme by default. |
| Logo | Replace `web/logo.svg` (any aspect ratio; shown at ~44 px tall). |
| App icon (for "Add to Home Screen") | Replace `web/icon-192.png` (192×192). Also adjust `web/manifest.webmanifest` name/colours. |
| Fonts | `<link>` tags in each HTML head (Google Fonts) and the `--font` variables. If you change hosts, update `font-src`/`style-src` in `web/vercel.json`. |
| Footer text | `web/index.html` footer. |

## 3. Relabel the vocabulary

The code was written for a property expo, so a few words are real-estate-flavoured. They are plain strings; search and replace in `web/`:

| Currently | Meaning | For a… | Change to |
|---|---|---|---|
| "Builder table(s)" | An exhibitor/stall/table/session a guest visits | trade show / conference / wedding | "Stall", "Session", "Table", "Counter" |
| "Team member" | Host / relationship manager / usher | wedding | "Family side", "Host" |
| "Invited by" | Who brought the guest | wedding | "Invited by (bride/groom side)" |
| Lead stages: New, Yet To Talk, Followup, Warm, Hot, Converted, Cold, Lost | Sales pipeline | any non-sales event | change to e.g. *Seated, Served, VIP* |

Lead stages live in **three** places that must agree: the `leads_stage_check` constraint in `schema.sql`, the `STAGES` array in `web/common.js`, and the colour rules in `style.css` (`[data-stage="…"]`). To rename a stage: `alter table public.leads drop constraint leads_stage_check;` → update existing rows → add the new constraint → update `STAGES` and CSS.

## 4. Time zone and event days

* Replace `Asia/Kolkata` everywhere in `supabase/schema.sql` (the *day* of a check-in) and set `TIME_ZONE` in `web/config.js` (used by the front desk). They must match.
* Events can span any number of days: a guest gets one check-in per person per day, and the dashboard and team pages grow a date tab for each day that has check-ins or invited guests.
* To say "this guest was invited for Day 2" call `admin_set_invite_days` (see [RPC_REFERENCE.md](RPC_REFERENCE.md)); it is optional.

## 5. Adapting to other kinds of event

| Event | Guest list | "Team" | "Tables" | Notes |
|---|---|---|---|---|
| **Property / trade expo** (original) | Invitee spreadsheet | Sales team | Builders / exhibitors | As built. |
| **Wedding / family function** | Guest list with *side* or *host* in the invited-by column | Hosts, ushers | Not needed (leave the list empty and the field hides itself) | Use party size for "+N". Alerts tell a host their elder/VIP has arrived. |
| **Conference** | Registration export | Staff by track | Sessions or booths | Use the kiosk URL on tablets at the door; stages could be *Attended / VIP / Follow up*. |
| **College fest / open house** | Pre-registrations | Student volunteers | Stalls | Skip consent; keep the form to name + number. |
| **Product launch / press event** | Press list, *invited by* = PR owner | PR team | Demo stations | Alerts when a VIP journalist arrives. |
| **Clinic camp / health drive** | Appointments | Nurses | Counters | Be careful with data sensitivity; see [SECURITY.md](SECURITY.md). |

If you have **no pre-registration list at all**, skip the upload: every guest is a walk-in, routed by name or rotation.

## 6. Changing what the form collects

* Guest-facing fields are in `web/index.html` + `web/checkin.js`; the payload is the `check_in` function's arguments (`p_name`, `p_phone`, `p_prefs`, `p_referred_by`, `p_consent`, `p_additional`, `p_builder`). The free-form `p_prefs` JSON is stored as-is in `checkins.prefs`, so **adding another question needs no database change** — add it in Admin → Event settings and it appears on the form, dashboard and CSV export automatically.
* To collect a field that is not a "question" (e.g. an e-mail address), add a column to `checkins`, add a parameter to `check_in`/`private.do_check_in`, add an input to the form and add it to `checkinCols()` in `dashboard.js` for exports. Add the parameter with a `DEFAULT` so old pages that don't send it keep working.

## 7. Adding a new capability (the pattern)

1. Write a `SECURITY DEFINER` function with `set search_path to ''`, schema-qualify everything, and start it with the credential check:
   ```sql
   create function public.admin_do_thing(p_pin text, p_id bigint) returns jsonb
   language plpgsql security definer set search_path to '' as $$
   begin
     if not private.is_viewer(p_pin) then return jsonb_build_object('error','unauthorized'); end if;
     -- ... do the work ...
     return jsonb_build_object('ok', true);
   end $$;
   grant execute on function public.admin_do_thing(text, bigint) to anon, authenticated, service_role;
   ```
   Use `private.is_admin` for destructive/organiser-only actions and `private.is_viewer` for things observers and the front desk may do. For team-member actions copy the pattern in `rep_set_builder` (token → `private.rep_from_token`, then verify the guest belongs to that person).
2. Call it from the page with `await rpc('admin_do_thing', { p_pin: PIN, p_id: id })`.
3. If you change a function that feeds a page that polls (`admin_dashboard`, `rep_dashboard*`), **open that page immediately afterwards** — an error there takes the whole screen to "Connection lost".
4. Keep changes additive while the event is live: new nullable columns, new functions, defaults on new parameters.

## 8. Running without push alerts

Skip step 3 of the deployment guide. Pages poll every ~4 s and also play a chime when a guest arrives while the page is open (tap *Enable sound alerts* once). This is the fallback on browsers without Web Push.

## 9. Other hosting

The `web/` folder is plain static files, so GitHub Pages, Netlify, Cloudflare Pages or any web server will do. Requirements: HTTPS (service workers and Web Push require it), correct MIME types, and — recommended — the security headers from `web/vercel.json`. Add your site's origin to nothing in Supabase: the anon key works from any origin because the data is protected by the RPC checks, not by CORS.
