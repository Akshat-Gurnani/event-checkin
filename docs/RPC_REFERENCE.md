# RPC reference

Every browser action is a call to `POST {SUPABASE_URL}/rest/v1/rpc/<function>` with headers `apikey: <publishable key>` and `Content-Type: application/json`, and a JSON body of named arguments. Functions return JSON; failures return `{"error": "…"}` (most commonly `"unauthorized"`).

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/admin_dashboard" \
  -H "apikey: $SUPABASE_KEY" -H "Content-Type: application/json" \
  -d '{"p_pin":"YOUR-PIN","p_day":null}'
```

Credentials: **PIN** = admin PIN; **observer** = observer token (`obs_…`) passed in the same `p_pin` argument; **rep token** = the personal token from a team link, passed as `p_token`.

## Guests (no credential)

| Function | Arguments | Returns | Credential | What it does |
|---|---|---|---|---|
| `get_event_config` | `—` | jsonb | public | Event name, subtitle, team, table list, preference questions, config version. Drives the guest form. |
| `check_in` | `p_name text, p_phone text, p_prefs jsonb DEFAULT '{}'::jsonb, p_referred_by text DEFAULT NULL::text, p_consent boolean DEFAULT false, p_additional integer DEFAULT 0, p_builder text DEFAULT NULL::text` | jsonb | public | The guest check-in. Matches the number to the RSVP list, prevents same-day duplicates, assigns an owner (named rep → inviter → weighted rotation), fires the push trigger. Returns `{ok,name,status}` with status `invited`, `walkin` or `duplicate`. |
| `get_push_key` | `—` | text | public | The VAPID public key the browser needs to subscribe to push. |

## Login checks

| Function | Arguments | Returns | Credential | What it does |
|---|---|---|---|---|
| `admin_login` | `p_pin text` | boolean | admin PIN | `true`/`false`: is this the admin PIN? |
| `viewer_login` | `p_pin text` | jsonb | PIN or observer | `true`/`false`: may this credential open the dashboard / front desk? |

## Dashboard and front desk (admin PIN or observer link)

| Function | Arguments | Returns | Credential | What it does |
|---|---|---|---|---|
| `admin_dashboard` | `p_pin text, p_day date DEFAULT NULL::date` | jsonb | PIN or observer | Everything the live dashboard shows (KPIs, check-ins, not-arrived, team scoreboard, timeline, preference tallies, stage counts, readiness board, builder counts) for one day or all (`p_day` null). |
| `admin_rsvp_search` | `p_pin text, p_q text` | jsonb | PIN or observer | Front-desk search over the guest list by name or number. |
| `admin_manual_checkin` | `p_pin text, p_rsvp_id bigint, p_additional integer DEFAULT 0` | jsonb | PIN or observer | Check in an invitee by RSVP id (front desk). |
| `admin_manual_walkin` | `p_pin text, p_name text, p_phone text, p_referred_by text DEFAULT NULL::text, p_additional integer DEFAULT 0` | jsonb | PIN or observer | Add a walk-in by hand (front desk). |
| `admin_link_checkin` | `p_pin text, p_checkin_id bigint, p_rsvp_id bigint` | jsonb | PIN or observer | Declare a walk-in check-in to be the invitee `p_rsvp_id` (used a different number); remembers the number as an alias. |
| `admin_reassign` | `p_pin text, p_checkin_id bigint, p_to text DEFAULT NULL::text` | jsonb | PIN or observer | Hand a check-in to another team member and notify them; records a `checkin_events` row. |
| `admin_set_done` | `p_pin text, p_checkin_id bigint, p_done boolean` | jsonb | PIN or observer | Mark a guest Done / reopen. |
| `admin_set_additional` | `p_pin text, p_checkin_id bigint, p_additional integer` | jsonb | PIN or observer | Set party size (people with the guest, 0–20). |
| `admin_set_builder` | `p_pin text, p_checkin_id bigint, p_builder text` | jsonb | PIN or observer | Set the table tags (single name or comma-separated list; validated against the config). |

## Organiser only (admin PIN)

| Function | Arguments | Returns | Credential | What it does |
|---|---|---|---|---|
| `admin_import_rsvp` | `p_pin text, p_rows jsonb, p_replace boolean DEFAULT false` | jsonb | admin PIN | Import guest rows `[{name, phone, invited_by}]`. `p_replace=true` replaces the list and re-matches existing check-ins. |
| `admin_set_invite_days` | `p_pin text, p_rows jsonb` | jsonb | admin PIN | Tag invitees with the day they were invited for (optional multi-day support). |
| `admin_save_config` | `p_pin text, p_config jsonb` | jsonb | admin PIN | Save event settings (optimistic concurrency via `base_version`); creates links for new team members. |
| `admin_merge_checkin` | `p_pin text, p_keep_id bigint, p_drop_id bigint` | jsonb | admin PIN | Merge two check-ins of the same person into one. |
| `admin_delete_checkin` | `p_pin text, p_id bigint` | jsonb | admin PIN | Delete a check-in (mistakes/tests). |
| `admin_rep_links` | `p_pin text` | jsonb | admin PIN | List every team member with their personal token. |
| `admin_rotate_rep_token` | `p_pin text, p_name text` | jsonb | admin PIN | Issue a new token for a team member (invalidates the old link). |
| `admin_set_rep_flags` | `p_pin text, p_name text, p_in_rotation boolean DEFAULT NULL::boolean, p_available boolean DEFAULT NULL::boolean` | jsonb | admin PIN | Set a team member's `in_rotation` / `available` flags. |
| `admin_observers` | `p_pin text` | jsonb | admin PIN | List observers and their tokens. |
| `admin_observer_add` | `p_pin text, p_name text` | jsonb | admin PIN | Create an observer link. |
| `admin_observer_remove` | `p_pin text, p_name text` | jsonb | admin PIN | Delete an observer. |
| `admin_observer_rotate` | `p_pin text, p_name text` | jsonb | admin PIN | New token for an observer. |
| `admin_set_pin` | `p_pin text, p_new_pin text` | jsonb | admin PIN | Change the admin PIN (6+ chars). |
| `admin_reset` | `p_pin text, p_what text` | jsonb | admin PIN | `p_what` = `checkins` or `all`: delete check-ins (and the RSVP list). |

## Team member (personal token)

| Function | Arguments | Returns | Credential | What it does |
|---|---|---|---|---|
| `rep_dashboard` | `p_token text` | jsonb | rep token | Today's view for a team member: their invited guests, arrivals, named/assigned walk-ins, availability. Also stamps `last_seen`. |
| `rep_dashboard_day` | `p_token text, p_day date DEFAULT NULL::date` | jsonb | rep token | The same view for any `p_day` (null = today) plus the list of event days. Powers the date tabs. |
| `rep_ack` | `p_token text, p_checkin_id bigint` | jsonb | rep token | "I've got this guest." |
| `rep_set_done` | `p_token text, p_checkin_id bigint, p_done boolean` | jsonb | rep token | Mark a guest of theirs Done / reopen (blocked once the guest was passed to someone else). |
| `rep_set_additional` | `p_token text, p_checkin_id bigint, p_additional integer` | jsonb | rep token | Set party size for one of their guests. |
| `rep_set_builder` | `p_token text, p_checkin_id bigint, p_builder text` | jsonb | rep token | Set table tags for one of their guests (single or comma-separated). |
| `rep_set_lead` | `p_token text, p_kind text, p_id bigint, p_stage text, p_note text` | jsonb | rep token | Set stage and note for an invitee (`p_kind='rsvp'`) or a check-in (`'checkin'`). |
| `rep_set_available` | `p_token text, p_available boolean` | jsonb | rep token | Go away / I'm back for the walk-in rotation. |
| `rep_push_subscribe` | `p_token text, p_endpoint text, p_p256dh text, p_auth text, p_ua text DEFAULT NULL::text` | jsonb | rep token | Register this device for push. |
| `rep_push_unsubscribe` | `p_token text, p_endpoint text` | jsonb | rep token | Remove this device. |
| `rep_push_test` | `p_token text` | jsonb | rep token | Send a test notification to this person's devices. |

## Edge function only (service role + shared secret)

| Function | Arguments | Returns | Credential | What it does |
|---|---|---|---|---|
| `push_prepare` | `p_secret text, p_kind text, p_id bigint DEFAULT NULL::bigint, p_rep_key text DEFAULT NULL::text` | jsonb | service_role + secret | Called by the edge function: builds the messages for a notification. |
| `push_store_keys` | `p_secret text, p_pub text, p_priv text` | jsonb | service_role + secret | Called once by the edge function to store generated VAPID keys. |
| `push_remove` | `p_secret text, p_endpoint text` | jsonb | service_role + secret | Called by the edge function to drop a dead subscription. |

## Private helpers (not callable from the browser)

`private.do_check_in`, `private.is_admin`, `private.is_viewer`, `private.rep_from_token`, `private.canon_builder`, `private.norm_phone`, `private.names_alike`, `private.flag_similar` (trigger), `private.notify_checkin` (trigger), `private.pick_walkin_owner`, `private.pick_random_walkin_owner`, `private.ensure_reps`, `private.current_reps`, `private.client_ip`, `private.push_url`. Read their source in `supabase/schema.sql`.

## Writing a safe new function

See [CUSTOMIZATION.md](CUSTOMIZATION.md#7-adding-a-new-capability-the-pattern).
