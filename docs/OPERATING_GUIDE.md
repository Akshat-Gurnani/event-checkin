# Operating guide — a runbook for event day

Print this. It is the checklist the original team wished it had.

## Roles

| Role | Who | Uses |
|---|---|---|
| **Organiser** | the person who set it up | `admin.html`, dashboard, the PIN |
| **Front desk** | 1–2 people at the entrance | `desk.html` (PIN or observer link) on a laptop/tablet |
| **Team members** | everyone who talks to guests | their personal `rep.html` link on their phone |
| **Observers** | owners / senior staff | an observer link → dashboard, exports, front desk |
| **Wall screen** (optional) | a monitor in the back office | dashboard in full-screen (**Fullscreen** button) |

## One week before

- [ ] Clean the guest list: one row per person, **a 10-digit mobile number for every invitee** (people without a number almost never show up — see [ANALYTICS.md](ANALYTICS.md)), and the *invited by* column filled in with consistent spelling of team names.
- [ ] Upload it (Admin → section 1). Read the preview: it tells you how many rows were skipped and which numbers repeat.
- [ ] Set event name, welcome line, team, tables, and **no more than three** preference questions (section 2).
- [ ] If the list covers several days, tag each invitee with their day (`admin_set_invite_days`, optional).
- [ ] Decide walk-in shares if you want a weighted rotation ([CUSTOMIZATION.md](CUSTOMIZATION.md#1-configure-in-the-admin-page-no-code)).

## The day before

- [ ] Send every team member their link (privately). Ask them to open it **on the phone they will carry at the venue**, tap **Enable alerts**, and press **Send me a test**.
  * iPhone: Safari → Share → **Add to Home Screen** → open from the Home Screen → *Enable alerts* (iOS 16.4+).
  * Android: Chrome works directly.
- [ ] Watch the **readiness board** on the dashboard. Chase anyone who still shows "Hasn't opened the link yet" or "alerts not turned on".
- [ ] Dry run with a fake guest (see [DEPLOYMENT.md](DEPLOYMENT.md#6-test-before-the-day)), then **Admin → Clear all check-ins**.
- [ ] Print the QR (section 3) — poster size at the door, A5 on each table/desk. Put the kiosk URL on a tablet if you have one.
- [ ] Tell the team the rules below.

## What to tell the team

1. **Keep your page open or the home-screen app installed.** Alerts arrive even when the phone is locked.
2. When a guest of yours arrives you get an alert. Tap **🙋 I've got this guest** so the dashboard shows the guest is taken care of. Anyone still "waiting" after a few minutes appears in the banner on the wall screen.
3. Use the guest card for the things you learn: **party size**, **tables they visited**, **stage** (Hot/Warm/Followup/…) and a **note**. Notes are what you will call about tomorrow.
4. When you are finished with a guest, tap **✅ Done with this guest** — they leave your live list (they stay in the *Done* tab and in the export).
5. If you step away, tap **Go away** so walk-ins skip you; **I'm back** when you return.
6. A walk-in asked for you but you are busy? Ask the organiser to **Reassign** — or pass them yourself in conversation and the organiser does it from the dashboard.

## During the event (organiser)

* Keep the **dashboard** open (full-screen on the wall screen if you have one). Things to watch:
  * **Waiting banner** — guests nobody has picked up. Walk over or reassign.
  * **Invited vs actual** by team member — chase members whose guests are not turning up.
  * **Possible duplicates** (⚠ on a row): *Same person · link* ties a walk-in to the invitee who used a different number; *Merge* collapses two check-ins of the same person. Do these in the quiet moments.
* **Front desk**: for guests who can't scan, search by name or number → **Check in** (set party size), or add a manual walk-in.
* **Wrong team member?** Dashboard row → **Reassign**.
* **Mistaken party size or tables?** Anyone with access can edit them from the guest card.
* **Someone checked in twice?** The system prevents it for the same number on the same day. A different number = Link/Merge as above.
* **Network trouble at the venue:** the form retries and shows a clear message; if Wi-Fi is bad, tell guests to use mobile data.

## End of each day

- [ ] Dashboard → **Export check-ins** (the current day) and **Export not-arrived**; or **Export everything**. Save these — they're your backup.
- [ ] Ask each team member to spend 5 minutes setting a **stage and note** for every guest they met. Stages left at *New* are the biggest data-quality gap ([ANALYTICS.md](ANALYTICS.md)).
- [ ] Day 2: team pages show **date tabs** — "Sat" lists yesterday's guests (including the ones who didn't come) so people can call them back this morning. Everything stays editable across days.

## After the event

1. Export everything and run `tools/export_report.py` for the pivots.
2. Build the follow-up pipeline: every *Hot/Warm/Followup* guest with owner, tables, note and phone, sorted by stage; track *next follow-up date* and *outcome* in the sheet.
3. Work the **no-show list** (invited, didn't come) while the event is still fresh in their minds.
4. Retire access: rotate/remove team and observer links; consider deleting personal data on your retention schedule ([SECURITY.md](SECURITY.md#data-retention)).
5. Write down what you'd change. Seriously — the best improvements to this project came from an organiser's list made the evening after.

## Quick answers

| Question | Answer |
|---|---|
| Someone says their alert never came | Check the readiness board; ask them to press **Send me a test**. On iPhone the page must be a Home Screen app. |
| A guest typed the wrong number | Front desk: search by name → check in manually (matches the RSVP row). Or Link/Merge afterwards. |
| A guest isn't on the list | They are a **walk-in**; they pick a team member, or the rotation picks one. |
| Two people share one phone number | Only the first can check in per day (numbers identify people). Check the second in via the front desk with another number or note. |
| We need to start fresh | Admin → **Clear all check-ins** (keeps the guest list) or **Clear everything**. |
| Someone left the team link in a group chat | Admin → team links → **rotate** that person's link. |
