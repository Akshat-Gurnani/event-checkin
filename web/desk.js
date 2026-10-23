const $ = (id) => document.getElementById(id);
let PIN, timer, walkinRows = [], deskReps = [];
const note = (id, msg, kind = '') => { $(id).innerHTML = msg ? `<div class="note ${kind}">${msg}</div>` : ''; };

/* ---------- check in an invited guest ---------- */
async function search() {
  const q = $('q').value;
  const rows = await rpc('admin_rsvp_search', { p_pin: PIN, p_q: q }).catch(() => null);
  if (!Array.isArray(rows)) { $('results').innerHTML = ''; return; }
  $('results').innerHTML = rows.length
    ? rows.map((r) => `<div class="pick"><div><b>${esc(r.name)}</b><div class="sub">${esc(r.phone)} · invited by ${esc(r.invited_by || '—')}</div></div>
        ${r.arrived_today ? '<span class="muted" style="font-size:13px">✓ checked in today</span>' : `<div class="row"><select class="stage" data-add title="Others coming with them" aria-label="Others coming with them">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}">${n ? '+' + n + ' with them' : 'alone'}</option>`).join('')}</select><button class="btn small primary" type="button" data-checkin="${r.id}">Check in</button></div>`}</div>`).join('')
    : `<div class="muted" style="font-size:14px">${q.trim() ? 'No matching guests — add them as a walk-in below.' : 'The guest list is empty.'}</div>`;
}
$('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
$('results').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-checkin]'); if (!b) return;
  b.disabled = true;
  const r = await rpc('admin_manual_checkin', { p_pin: PIN, p_rsvp_id: Number(b.dataset.checkin), p_additional: Number(b.closest('.pick').querySelector('[data-add]')?.value) || 0 }).catch((x) => ({ error: x.message }));
  if (r.error) note('result-note', esc(r.error), 'bad');
  else note('result-note', r.status === 'duplicate' ? `${esc(r.name)} was already checked in today.` : `✓ ${esc(r.name)} checked in${r.owner ? ` — ${esc(r.owner)} has been alerted` : ''}.`, r.status === 'duplicate' ? '' : 'ok');
  search(); loadWalkins();
});

/* ---------- add a walk-in ---------- */
$('walkin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
  const r = await rpc('admin_manual_walkin', { p_pin: PIN, p_name: $('w-name').value, p_phone: $('w-phone').value, p_referred_by: $('w-rep').value || null, p_additional: Number($('w-add').value) || 0 }).catch((x) => ({ error: x.message }));
  btn.disabled = false;
  if (r.error || r.ok === false) return note('walkin-note', esc(r.error || 'Could not add the walk-in.'), 'bad');
  if (r.status === 'duplicate') note('walkin-note', `${esc(r.name)} was already checked in today.`);
  else if (r.status === 'invited') note('walkin-note', `✓ That number is on the guest list — checked in as <b>${esc(r.name)}</b>${r.owner ? `, invited by <b>${esc(r.owner)}</b> (alerted)` : ''}.`, 'ok');
  else note('walkin-note', r.owner ? `✓ Walk-in added — <b>${esc(r.owner)}</b> has been alerted.` : '✓ Walk-in added, but <span class="wait">no team member is free</span> right now — pick one from the dashboard.', r.owner ? 'ok' : '');
  e.target.reset(); loadWalkins();
});

/* ---------- walk-ins today (for linking) ---------- */
async function loadWalkins() {
  const d = await rpc('admin_dashboard', { p_pin: PIN, p_day: new Date().toLocaleDateString('en-CA', { timeZone: (window.APP_CONFIG || {}).TIME_ZONE || 'Asia/Kolkata' }) }).catch(() => null);
  if (!d || d.error) return;
  walkinRows = d.checkins.filter((c) => c.status === 'walkin');
  deskReps = d.reps || [];
  $('walkins').innerHTML = walkinRows.length
    ? `<div class="results">${walkinRows.map((c) => `<div class="pick"><div><b>${esc(c.name)}</b>
        ${c.dup_rsvp ? `<div class="sub" style="color:var(--warn-ink)">⚠ Maybe the invited guest <b>${esc(c.dup_rsvp.name)}</b> (${esc(c.dup_rsvp.phone)}, invited by ${esc(c.dup_rsvp.invited_by || '—')}) <button class="btn small" type="button" data-quicklink="${c.id}:${c.dup_rsvp.id}">Same person · link</button></div>` : ''}${c.dup_checkin ? `<div class="sub" style="color:var(--warn-ink)">⚠ Possible duplicate of <b>${esc(c.dup_checkin.name)}</b> (${esc(c.dup_checkin.phone)}) — ask the admin to merge</div>` : ''}
        <div class="sub">${esc(c.phone)} · ${esc(fmtTime(c.at))} · ${c.passed_from && c.assigned_to ? 'with ' + esc(c.assigned_to) + ' (passed from ' + esc(c.passed_from) + ')' : c.referred_by ? 'with ' + esc(c.referred_by) : c.assigned_to ? 'assigned to ' + esc(c.assigned_to) : 'not assigned'}</div></div>
        <div class="row"><button class="btn small" type="button" data-party="${c.id}:${c.additional || 0}" title="Change how many people came with this guest">👥 ${c.additional ? '+' + c.additional : 'Party'}</button><button class="btn small" type="button" data-reassign="${c.id}">Reassign</button><button class="btn small" type="button" data-link="${c.id}">Link to guest</button></div></div>`).join('')}</div>`
    : '<div class="muted" style="font-size:14px">No walk-ins yet today.</div>';
}
$('walkins').addEventListener('click', async (e) => {
  const pt = e.target.closest('[data-party]');
  if (pt) {
    const [cid, cur] = pt.dataset.party.split(':').map(Number);
    const v = prompt('How many people came with this guest (besides them)?', String(cur));
    if (v === null) return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 20) { note('walkin-note', 'Enter a whole number from 0 to 20.', 'bad'); return; }
    const r = await rpc('admin_set_additional', { p_pin: PIN, p_checkin_id: cid, p_additional: n }).catch((x) => ({ error: x.message }));
    note('walkin-note', r.error ? esc(r.error) : `✓ Saved: ${n ? '+' + n + ' with them' : 'came alone'}.`, r.error ? 'bad' : 'ok');
    loadWalkins();
    return;
  }
  const ql = e.target.closest('[data-quicklink]');
  if (ql) {
    const [cid, rid] = ql.dataset.quicklink.split(':').map(Number);
    const row = walkinRows.find((c) => c.id === cid);
    if (!row || !confirm(`Count ${row.name} as the invited guest ${row.dup_rsvp?.name}? The inviter gets the credit and an alert.`)) return;
    ql.disabled = true;
    const r = await rpc('admin_link_checkin', { p_pin: PIN, p_checkin_id: cid, p_rsvp_id: rid }).catch((x) => ({ error: x.message }));
    if (r.error) note('walkin-note', esc(r.error), 'bad'); else note('walkin-note', `✓ Linked to <b>${esc(r.guest)}</b>${r.invited_by ? ` — ${esc(r.invited_by)} has been alerted` : ''}.`, 'ok');
    loadWalkins();
    return;
  }
  const re = e.target.closest('[data-reassign]');
  if (re) {
    const row = walkinRows.find((c) => String(c.id) === re.dataset.reassign);
    if (row) reassignModal({ pin: PIN, checkin: row, reps: deskReps, onDone: (r) => { note('walkin-note', `✓ Passed to <b>${esc(r.to)}</b> — they have been alerted.`, 'ok'); loadWalkins(); } });
    return;
  }
  const b = e.target.closest('[data-link]'); if (!b) return;
  const row = walkinRows.find((c) => String(c.id) === b.dataset.link);
  if (row) linkModal({ pin: PIN, checkin: row, onDone: (r) => { note('walkin-note', `✓ Linked to <b>${esc(r.guest)}</b>${r.invited_by ? ` — ${esc(r.invited_by)} has been alerted` : ''}.`, 'ok'); loadWalkins(); } });
});

(async () => {
  PIN = await requirePin('viewer');
  const cfg = await rpc('get_event_config').catch(() => null);
  if (cfg) $('w-rep').innerHTML += (cfg.team || []).map((t) => `<option>${esc(t)}</option>`).join('');
  $('app').classList.remove('hidden');
  search(); loadWalkins();
  setInterval(() => { if (!document.hidden) loadWalkins(); }, 6000);
})();
