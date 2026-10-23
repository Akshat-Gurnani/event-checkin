const $ = (id) => document.getElementById(id);
let PIN, data, config, tab = 'feed', day, seen = null, failures = 0;

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function prefSummary(prefs) {
  const order = (config?.questions || []).map((q) => q.key);
  const keys = Object.keys(prefs || {}).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  return keys.map((k) => [].concat(prefs[k]).join(', ')).filter(Boolean).join(' · ');
}
const splitB = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const openB = new Set();
document.head.insertAdjacentHTML('beforeend', '<style>.bld > summary{cursor:pointer;list-style:none;font-size:13px;color:var(--text-2)}.bld > summary::-webkit-details-marker{display:none}.bld > summary::after{content:\' ▾\';color:var(--muted)}.bld-opts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;max-width:440px}.bld-opt{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--border);border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}.bld-opt input{width:15px;height:15px;margin:0;accent-color:var(--accent)}.bld-opt:has(input:checked){background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}</style>');
document.addEventListener('toggle', (e) => { const d = e.target; if (d && d.matches && d.matches('details[data-bld]')) { if (d.open) openB.add(d.dataset.bld); else openB.delete(d.dataset.bld); } }, true);
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function renderDaySelect(d) {
  const days = [...new Set([d.today, ...d.days.map(String)])].sort().reverse();
  const cur = day ?? '';
  $('day').innerHTML = `<option value="">All days</option>` + days.map((x) => `<option value="${esc(x)}">${esc(fmtDay(x))}${x === d.today ? ' (today)' : ''}</option>`).join('');
  $('day').value = cur;
  const strip = $('daytabs');
  if (strip) {
    const chron = [...days].reverse();
    strip.innerHTML = [['', 'All days', '']].concat(chron.map((x) => [x, fmtDay(x), x === d.today ? 'Today' : x < d.today ? 'Earlier' : 'Upcoming']))
      .map(([v, l, sub]) => `<button class="tab daytab" type="button" role="tab" data-day="${esc(v)}" aria-selected="${v === cur}">${esc(l)}${sub ? `<small style="display:block;font-size:11px;font-weight:700;opacity:.75">${sub}</small>` : ''}</button>`).join('');
  }
}

function renderKpis(d) {
  const rate = pct(d.arrived_invited, d.invited);
  $('k-invited').textContent = d.invited;
  $('k-arrived').textContent = d.arrived_invited;
  $('k-pending').textContent = `${Math.max(0, d.invited - d.arrived_invited)} still expected`;
  $('k-rate').textContent = d.invited ? `${rate}%` : '–';
  $('k-walkins').textContent = d.walkins;
  $('k-total').textContent = d.headcount;
  $('k-total').nextElementSibling.textContent = d.additional ? `${d.headcount - d.additional} guests + ${d.additional} with them` : 'people';
  $('p-bar').style.width = `${rate}%`;
  $('p-label').textContent = `${d.arrived_invited} of ${d.invited} invited guests have arrived${day ? ` · ${fmtDay(day)}` : ' · all days'}`;
  const w = d.waiting;
  $('waiting-banner').hidden = !w;
  $('waiting-text').textContent = `⏳ ${w} guest${w === 1 ? ' is' : 's are'} waiting for a team member to pick them up`;
}

function renderReady(reps) {
  const ready = reps.filter((r) => r.devices > 0).length;
  $('ready-summary').textContent = reps.length ? `${ready} of ${reps.length} ready for alerts` : '';
  $('ready').innerHTML = reps.length ? reps.map((r) => {
    const cls = r.devices > 0 ? 'ready' : r.last_seen ? 'partial' : 'none';
    const state = r.devices > 0 ? `Alerts on · ${r.devices} device${r.devices === 1 ? '' : 's'}` : r.last_seen ? 'Opened the link — alerts not turned on' : 'Hasn’t opened the link yet';
    return `<div class="rep ${cls}"><div class="name"><span class="dot"></span>${esc(r.name)}${r.in_rotation && !r.available ? ' <span class="stage-chip">Away</span>' : ''}</div>
      <div class="state">${esc(state)}${r.last_seen ? ` · seen ${esc(timeAgo(r.last_seen))}` : ''}${r.open_walkins ? ` · <span class="wait">⏳ ${r.open_walkins} waiting</span>` : ''}</div>
      <div class="flags">
        <label><input type="checkbox" data-rep="${esc(r.name)}" data-flag="in_rotation" ${r.in_rotation ? 'checked' : ''} ${isObserver() ? 'disabled' : ''}> Takes walk-ins</label>
        <label><input type="checkbox" data-rep="${esc(r.name)}" data-flag="available" ${r.available ? 'checked' : ''} ${r.in_rotation && !isObserver() ? '' : 'disabled'}> Available</label>
      </div></div>`;
  }).join('') : '<div class="empty">Team members appear here once they are added in Admin.</div>';
}

function renderTeam(rows) {
  if (!rows.length) { $('team').innerHTML = `<tr><td class="empty">Upload the RSVP list in Admin to see the scoreboard.</td></tr>`; return; }
  $('team').innerHTML = `<thead><tr><th>Team member</th><th class="num">Invited</th><th class="num">Arrived</th><th>Turnout</th><th class="num">Walk-ins</th><th class="num">With them</th></tr></thead><tbody>`
    + rows.map((r) => {
      const p = pct(r.arrived, r.invited);
      return `<tr><td><b>${esc(r.name)}</b></td><td class="num">${r.invited}</td><td class="num">${r.arrived}</td>
        <td>${r.invited ? `<div class="rate"><div class="track"><span style="width:${Math.min(100, p)}%"></span></div><b>${p}%</b></div>` : '<span class="muted">—</span>'}</td>
        <td class="num">${r.walkins || '<span class="muted">0</span>'}</td><td class="num">${r.additional || '<span class="muted">0</span>'}</td></tr>`;
    }).join('') + '</tbody>';
}

function renderTimeline(points) {
  const el = $('timeline');
  if (!points.length) { el.innerHTML = `<div class="empty">No check-ins yet.</div>`; return; }
  const step = 15 * 60e3;
  const start = new Date(points[0].t).getTime(), end = new Date(points[points.length - 1].t).getTime();
  const byT = new Map(points.map((p) => [new Date(p.t).getTime(), p]));
  const buckets = [];
  // a long gap (e.g. overnight between two event days) would make a huge chart, so cap the span
  if (end - start > 16 * 3600e3) points.forEach((p) => buckets.push({ t: new Date(p.t).getTime(), invited: p.invited, walkin: p.walkin }));
  else for (let t = start; t <= end; t += step) buckets.push({ t, invited: byT.get(t)?.invited || 0, walkin: byT.get(t)?.walkin || 0 });

  const W = Math.max(el.clientWidth, 280), H = 240, padL = 30, padB = 24, padT = 8;
  const max = Math.max(...buckets.map((b) => b.invited + b.walkin), 1);
  const nice = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const plotW = W - padL, plotH = H - padB - padT;
  const slot = plotW / buckets.length, bw = Math.max(Math.min(slot * 0.7, 36), 3);
  const y = (v) => padT + plotH - (v / nice) * plotH;
  const ticks = [0, nice / 2, nice].filter((v, i, a) => a.indexOf(v) === i && Number.isInteger(v));
  const labelEvery = Math.ceil(buckets.length / Math.max(1, Math.floor(plotW / 56)));

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Arrivals per 15 minutes"><g class="grid">`;
  for (const t of ticks) svg += `<line x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  svg += `</g>`;
  buckets.forEach((b, i) => {
    const x = padL + i * slot + (slot - bw) / 2;
    const hI = (b.invited / nice) * plotH, hW = (b.walkin / nice) * plotH;
    const base = padT + plotH;
    const r = Math.min(4, bw / 2);
    if (b.invited) svg += `<rect x="${x}" y="${base - hI}" width="${bw}" height="${hI}" rx="${b.walkin ? 0 : r}" fill="var(--series-invited)"/>`;
    if (b.walkin) svg += `<rect x="${x}" y="${base - hI - hW}" width="${bw}" height="${Math.max(hW - (b.invited ? 2 : 0), 1)}" rx="${r}" fill="var(--series-walkin)"/>`;
    svg += `<rect x="${padL + i * slot}" y="${padT}" width="${slot}" height="${plotH}" fill="transparent" data-tip="${esc(fmtDay(new Date(b.t).toISOString()))} ${esc(fmtTime(b.t))}–${esc(fmtTime(b.t + step))}: ${b.invited} invited, ${b.walkin} walk-in"/>`;
    if (i % labelEvery === 0) svg += `<text x="${padL + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${esc(fmtTime(b.t))}</text>`;
  });
  el.innerHTML = svg + `</svg>`;
}

function renderPrefs(prefs) {
  const qs = config?.questions || [];
  const keys = [...qs.map((q) => q.key), ...Object.keys(prefs).filter((k) => !qs.some((q) => q.key === k))];
  const html = keys.filter((k) => prefs[k]).map((k) => {
    const items = prefs[k];
    const max = Math.max(...items.map((i) => i.count));
    const label = qs.find((q) => q.key === k)?.label || k;
    return `<div class="pref"><h3>${esc(label)}</h3>${items.map((i) => `
      <div class="hbar" data-tip="${esc(i.label)}: ${i.count} guest${i.count === 1 ? '' : 's'}"><span class="lbl">${esc(i.label)}</span>
      <div class="track"><span style="width:${(i.count / max) * 100}%"></span></div><span class="n">${i.count}</span></div>`).join('')}</div>`;
  }).join('');
  $('prefs').innerHTML = html || `<div class="empty">Preferences will appear as guests check in.</div>`;
}

function renderStages(stages) {
  const entries = STAGES.filter((s) => stages[s]);
  $('stages').innerHTML = entries.length
    ? entries.map((s) => `<span class="stage-chip" data-stage="${esc(s)}" style="font-size:14px;padding:6px 14px">${esc(s)} · <b>${stages[s]}</b></span>`).join('')
    : '<div class="empty" style="padding:8px 0;text-align:left">No stages set yet. Team members choose a stage on their page after talking to a guest.</div>';
}

const selectOpen = () => { const a = document.activeElement; return a && (a.tagName === 'SELECT' || (a.tagName === 'INPUT' && a.type === 'checkbox')) && a.closest('#list'); };
function builderCell(r) {
  const list = config?.builders || [];
  if (!list.length && !r.builder) return '<span class="muted">—</span>';
  const sel = splitB(r.builder), opts = [...new Set([...list, ...sel])];
  return `<details class="bld" data-bld="${r.id}"${openB.has(String(r.id)) ? ' open' : ''}><summary><b>${sel.length ? esc(sel.join(', ')) : '—'}</b></summary><div class="bld-opts">${opts.map((b) => `<label class="bld-opt"><input type="checkbox" data-bchk="${r.id}" value="${esc(b)}"${sel.includes(b) ? ' checked' : ''}> ${esc(b)}</label>`).join('')}</div></details>`;
}
function ownerCell(r) {
  const passed = r.passed_from && r.assigned_to ? ` <span class="tag-diff">now with ${esc(r.assigned_to)}</span>` : '';
  if (r.status === 'invited') {
    const asked = r.referred_by && !sameName(r.referred_by, r.invited_by) ? ` <span class="tag-diff">asked for ${esc(r.referred_by)}</span>` : '';
    return `${esc(r.invited_by || '—')}${r.linked ? ' <span class="muted">(linked)</span>' : ''}${asked}${passed}`;
  }
  if (r.passed_from && r.assigned_to) return `${esc(r.assigned_to)} <span class="muted">(passed from ${esc(r.passed_from)})</span>`;
  if (r.referred_by) return `${esc(r.referred_by)} <span class="muted">(named)</span>`;
  if (r.assigned_to) return `${esc(r.assigned_to)} <span class="muted">(assigned)</span>`;
  return '<span class="wait">no one free</span>';
}
function dupFlags(r) {
  const s = 'font-size:12px;color:var(--warn-ink);margin-top:4px;white-space:normal;max-width:340px';
  let h = '';
  if (r.dup_rsvp) h += `<div style="${s}">⚠ Maybe the invited guest <b>${esc(r.dup_rsvp.name)}</b> (${esc(r.dup_rsvp.phone)}, invited by ${esc(r.dup_rsvp.invited_by || '—')}) <button class="btn small" type="button" data-quicklink="${r.id}:${r.dup_rsvp.id}">Same person · link</button></div>`;
  if (r.dup_checkin) h += `<div style="${s}">⚠ Possible duplicate of <b>${esc(r.dup_checkin.name)}</b> (${esc(r.dup_checkin.phone)})${isObserver() ? '' : ` <button class="btn small" type="button" data-merge="${r.dup_checkin.id}:${r.id}">Merge</button>`}</div>`;
  return h;
}
function handledCell(r) {
  if (r.done_at) return `<span class="handled">✔ Done · ${esc(r.done_by)} · ${esc(timeAgo(r.done_at))}</span>`;
  if (r.ack_at) return `<span class="handled">✅ ${esc(r.ack_by)} · ${esc(timeAgo(r.ack_at))}</span>`;
  return r.day === data.today ? `<span class="wait">⏳ ${esc(timeAgo(r.at).replace(' ago', ''))}</span>` : '<span class="muted">—</span>';
}

function renderList() {
  const q = $('q').value.trim().toLowerCase();
  const match = (...f) => !q || f.some((v) => String(v ?? '').toLowerCase().includes(q));
  const d = data;
  const waiting = d.checkins.filter((r) => !r.ack_at && r.day === d.today);
  $('c-feed').textContent = `(${d.checkins.filter((r) => !r.done_at).length})`;
  $('c-done').textContent = `(${d.checkins.filter((r) => r.done_at).length})`;
  $('c-waiting').textContent = `(${waiting.length})`;
  $('c-pending').textContent = `(${d.not_arrived.length})`;
  $('c-walkins').textContent = `(${d.checkins.filter((r) => r.status === 'walkin').length})`;
  let html;
  if (tab === 'pending') {
    const rows = d.not_arrived.filter((r) => match(r.name, r.phone, r.invited_by));
    html = rows.length ? `<table><thead><tr><th>Name</th><th>Mobile</th><th>Invited by</th><th>Stage</th><th>Visited</th></tr></thead><tbody>${rows.map((r) =>
      `<tr><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.invited_by || '—')}</td>
       <td>${r.stage !== 'New' ? `<span class="stage-chip" data-stage="${esc(r.stage)}">${esc(r.stage)}</span>` : '<span class="muted">—</span>'}</td>
       <td class="muted">${(r.visited || []).map(fmtDay).join(', ') || '—'}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${d.invited ? 'Everyone on the guest list has arrived 🎉' : 'No RSVP list uploaded yet.'}</div>`;
  } else {
    const rows = d.checkins.filter((r) => ((tab === 'feed' && !r.done_at) || (tab === 'done' && r.done_at) || (tab === 'walkins' && r.status === 'walkin') || (tab === 'waiting' && !r.ack_at && r.day === d.today))
      && match(r.name, r.phone, r.invited_by, r.referred_by, r.assigned_to, r.ack_by, r.stage, r.note, r.builder, prefSummary(r.prefs)));
    html = rows.length ? `<table><thead><tr><th>Time</th><th>Name</th><th>Mobile</th><th>Status</th><th>Team member</th><th>Handled</th><th>Stage</th><th>Builder table</th><th>Preferences</th><th></th></tr></thead><tbody>${rows.map((r) =>
      `<tr data-id="${r.id}"><td class="muted">${day ? '' : esc(fmtDay(r.day)) + ' · '}${esc(fmtTime(r.at))}</td><td><b>${esc(r.name)}</b>${r.additional ? ` <span class="tag-diff">+${r.additional} with them</span>` : ''}${dupFlags(r)}</td><td>${esc(r.phone)}</td>
      <td><span class="badge ${r.status}">${r.status === 'invited' ? 'Invited' : 'Walk-in'}</span></td>
      <td>${ownerCell(r)}</td><td>${handledCell(r)}</td>
      <td>${r.stage !== 'New' ? `<span class="stage-chip" data-stage="${esc(r.stage)}" ${r.note ? `title="${esc(r.note)}"` : ''}>${esc(r.stage)}</span>` : '<span class="muted">—</span>'}${r.note ? ' 📝' : ''}</td>
      <td>${builderCell(r)}</td>
      <td class="prefs-cell">${esc(prefSummary(r.prefs) || '—')}</td>
      <td style="white-space:nowrap">${true ? `<button class="btn small" type="button" data-done="${r.id}:${r.done_at ? 0 : 1}" title="${r.done_at ? 'Put this guest back in the live feed' : 'Finished with this guest'}">${r.done_at ? '↩ Reopen' : '✅ Done'}</button> <button class="btn small" type="button" data-party="${r.id}" title="Change how many people came with this guest">👥 ${r.additional ? '+' + r.additional : 'Party'}</button> <button class="btn small" type="button" data-reassign="${r.id}" title="Hand this guest to another team member">Reassign</button> ` : ''}${r.status === 'walkin' ? `<button class="btn small" type="button" data-link="${r.id}" title="This guest used a different number than the RSVP list">Link to guest</button> ` : ''}${isObserver() ? '' : `<button class="x" title="Remove this check-in" data-del="${r.id}">×</button>`}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${q ? 'No matches.' : tab === 'waiting' ? 'Nobody is waiting 🎉' : tab === 'done' ? 'No finished guests yet.' : 'No check-ins yet.'}</div>`;
  }
  $('list').innerHTML = html;
}

function toast(r) {
  const t = document.createElement('div');
  t.className = `toast ${r.status}`;
  const who = r.invited_by || r.referred_by || r.assigned_to;
  const diff = r.status === 'invited' && r.referred_by && !sameName(r.referred_by, r.invited_by) ? ` (asked for <b>${esc(r.referred_by)}</b>)` : '';
  t.innerHTML = `<b>${esc(r.name)}</b> just checked in${who ? ` · ${r.status === 'invited' ? 'invited by' : r.referred_by ? 'named' : 'assigned to'} <b>${esc(who)}</b>${diff}` : ''}${r.status === 'walkin' ? ' <span class="badge walkin">Walk-in</span>' : ''}`;
  $('toasts').prepend(t);
  setTimeout(() => t.remove(), 9000);
  while ($('toasts').children.length > 4) $('toasts').lastChild.remove();
}

async function refresh() {
  try {
    const d = await rpc('admin_dashboard', { p_pin: PIN, p_day: day === undefined ? null : day });
    if (d.error) { store.del('walkin_pin'); location.reload(); return; }
    if (day === undefined) { day = d.today; return refresh(); }   // open on today's view
    const fresh = seen ? d.checkins.filter((c) => !seen.has(c.id)) : [];
    seen = new Set(d.checkins.map((c) => c.id));
    data = d; failures = 0;
    renderDaySelect(d); renderKpis(d); renderReady(d.reps); renderTeam(d.by_team); renderTimeline(d.timeline); renderPrefs(d.prefs); renderStages(d.stages); if (!selectOpen()) renderList();
    fresh.slice(0, 4).reverse().forEach(toast);
    fresh.forEach((c) => document.querySelector(`tr[data-id="${c.id}"]`)?.classList.add('new'));
    $('live').classList.remove('stale');
    $('updated').textContent = `Live · updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
  } catch {
    if (++failures >= 2) { $('live').classList.add('stale'); $('updated').textContent = 'Connection lost — retrying…'; }
  }
}

// tooltips for chart marks
document.addEventListener('mousemove', (e) => {
  const t = e.target.closest?.('[data-tip]'), tip = $('tip');
  if (!t) { tip.style.opacity = 0; return; }
  tip.textContent = t.dataset.tip;
  tip.style.opacity = 1;
  const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
  tip.style.left = `${x}px`; tip.style.top = `${e.clientY - 34}px`;
});

function setTab(t) {
  tab = t;
  document.querySelectorAll('.tab[data-tab]').forEach((x) => x.setAttribute('aria-selected', x.dataset.tab === t));
  if (data) renderList();
}
$('q').insertAdjacentHTML('beforebegin', '<button class="tab" role="tab" data-tab="done" aria-selected="false">Done <span id="c-done"></span></button>');
document.querySelectorAll('.tab[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('q').addEventListener('input', renderList);
$('day').closest('.top').insertAdjacentElement('afterend', Object.assign(document.createElement('div'), { id: 'daytabs', className: 'tabs', role: 'tablist' }));
$('daytabs').addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (!b) return; $('day').value = b.dataset.day; $('day').dispatchEvent(new Event('change')); });
$('day').style.display = 'none';
$('day').addEventListener('change', () => { day = $('day').value || null; seen = null; refresh(); });
$('waiting-show').addEventListener('click', () => { setTab('waiting'); if (day !== data.today) { day = data.today; seen = null; refresh(); } $('list').scrollIntoView({ behavior: 'smooth' }); });

$('list').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]'), link = e.target.closest('[data-link]');
  const ql = e.target.closest('[data-quicklink]'), mg = e.target.closest('[data-merge]');
  if (ql) {
    const [cid, rid] = ql.dataset.quicklink.split(':').map(Number);
    const row = data.checkins.find((c) => c.id === cid);
    if (!row || !confirm(`Count ${row.name} as the invited guest ${row.dup_rsvp?.name}? The inviter gets the credit and this number is remembered.`)) return;
    ql.disabled = true;
    const r = await rpc('admin_link_checkin', { p_pin: PIN, p_checkin_id: cid, p_rsvp_id: rid }).catch((x) => ({ error: x.message }));
    if (r.error) alert(r.error);
    refresh();
    return;
  }
  if (mg) {
    const [keepId, dropId] = mg.dataset.merge.split(':').map(Number);
    const keep = data.checkins.find((c) => c.id === keepId), drop = data.checkins.find((c) => c.id === dropId);
    if (!keep || !drop || !confirm(`These are the same person? "${drop.name}" will be removed and counted once, as "${keep.name}".`)) return;
    mg.disabled = true;
    const r = await rpc('admin_merge_checkin', { p_pin: PIN, p_keep_id: keepId, p_drop_id: dropId }).catch((x) => ({ error: x.message }));
    if (r.error) alert(r.error);
    refresh();
    return;
  }
  const dn = e.target.closest('[data-done]');
  if (dn) {
    const [cid, flag] = dn.dataset.done.split(':');
    dn.disabled = true;
    const r = await rpc('admin_set_done', { p_pin: PIN, p_checkin_id: Number(cid), p_done: flag === '1' }).catch((x) => ({ error: x.message }));
    if (r.error) alert(r.error);
    refresh();
    return;
  }
  const pt = e.target.closest('[data-party]');
  if (pt) {
    const row = data.checkins.find((c) => String(c.id) === pt.dataset.party);
    const v = prompt(`How many people came with ${row?.name} (besides them)?`, String(row?.additional || 0));
    if (v === null) return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 20) { alert('Enter a whole number from 0 to 20.'); return; }
    const r = await rpc('admin_set_additional', { p_pin: PIN, p_checkin_id: row.id, p_additional: n }).catch((x) => ({ error: x.message }));
    if (r.error) alert(r.error);
    refresh();
    return;
  }
  const re = e.target.closest('[data-reassign]');
  if (re) {
    const row = data.checkins.find((c) => String(c.id) === re.dataset.reassign);
    if (row) reassignModal({ pin: PIN, checkin: row, reps: data.reps, onDone: refresh });
    return;
  }
  if (link) {
    const row = data.checkins.find((c) => String(c.id) === link.dataset.link);
    if (row) linkModal({ pin: PIN, checkin: row, onDone: refresh });
    return;
  }
  if (!del) return;
  const row = data.checkins.find((c) => String(c.id) === del.dataset.del);
  if (!confirm(`Remove the check-in for ${row?.name}? Use this only for mistakes or test entries.`)) return;
  await rpc('admin_delete_checkin', { p_pin: PIN, p_id: Number(del.dataset.del) });
  refresh();
});
$('list').addEventListener('change', async (e) => {
  const bc = e.target.closest('[data-bchk]');
  if (bc) {
    const box = bc.closest('details'), vals = [...box.querySelectorAll('input[data-bchk]:checked')].map((x) => x.value).join(', ');
    box.querySelector('summary b').textContent = vals || '—';
    const r = await rpc('admin_set_builder', { p_pin: PIN, p_checkin_id: Number(bc.dataset.bchk), p_builder: vals }).catch((x) => ({ error: x.message }));
    if (r.error) alert(r.error);
    return;
  }
  const sel = e.target.closest('[data-builder]'); if (!sel) return;
  sel.blur();
  const r = await rpc('admin_set_builder', { p_pin: PIN, p_checkin_id: Number(sel.dataset.builder), p_builder: sel.value }).catch((x) => ({ error: x.message }));
  if (r.error) alert(r.error);
  refresh();
});
$('ready').addEventListener('change', async (e) => {
  const box = e.target.closest('[data-flag]'); if (!box) return;
  const args = { p_pin: PIN, p_name: box.dataset.rep };
  args[box.dataset.flag === 'in_rotation' ? 'p_in_rotation' : 'p_available'] = box.checked;
  await rpc('admin_set_rep_flags', args).catch(() => {});
  refresh();
});
$('fs').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const dayLabel = () => (day ? '' : 'all-days-');
const checkinCols = (qs) => [
  { label: 'Day', get: (r) => (r.day ? fmtDay(r.day) : '') },
  { label: 'Checked in at', get: (r) => (r.at ? fmtDateTime(r.at) : '') },
  { label: 'Name', get: (r) => r.name },
  { label: 'Mobile', get: (r) => r.phone },
  { label: 'Status', get: (r) => (r.status === 'invited' ? 'Invited' : 'Walk-in') },
  { label: 'Invited for (day)', get: (r) => (r.invite_day ? fmtDay(r.invite_day) : '') },
  { label: 'People with them', get: (r) => (r.at ? r.additional || 0 : '') },
  { label: 'Party size', get: (r) => (r.at ? 1 + (r.additional || 0) : '') },
  { label: 'Builder table', get: (r) => r.builder },
  { label: 'Invited by (RSVP)', get: (r) => r.invited_by },
  { label: 'Team member named by guest', get: (r) => r.referred_by },
  { label: 'Assigned (walk-in rotation)', get: (r) => r.assigned_to },
  { label: 'Passed from', get: (r) => r.passed_from },
  { label: 'Passed by', get: (r) => r.passed_by },
  { label: 'Handled by', get: (r) => r.ack_by },
  { label: 'Handled at', get: (r) => (r.ack_at ? fmtDateTime(r.ack_at) : '') },
  { label: 'Finished (Done) by', get: (r) => r.done_by },
  { label: 'Finished at', get: (r) => (r.done_at ? fmtDateTime(r.done_at) : '') },
  { label: 'Lead stage', get: (r) => r.stage },
  { label: 'Follow-up note', get: (r) => r.note },
  ...qs.map((q) => ({ label: q.label, get: (r) => [].concat(r.prefs?.[q.key] ?? []).join('; ') })),
  { label: 'Consent to contact', get: (r) => (r.at ? (r.consent ? 'Yes' : 'No') : '') },
  { label: 'Linked from another number', get: (r) => (r.linked ? 'Yes' : '') },
];
$('exp-checkins').addEventListener('click', () => {
  download(`checkins-${dayLabel()}${stamp()}.csv`, toCSV(data.checkins, checkinCols(config?.questions || [])));
});
$('exp-noshows').addEventListener('click', () => {
  download(`not-arrived-${dayLabel()}${stamp()}.csv`, toCSV(data.not_arrived, [
    { label: 'Invited by', get: (r) => r.invited_by },
    { label: 'Name', get: (r) => r.name },
    { label: 'Mobile', get: (r) => r.phone },
    { label: 'Invited for (day)', get: (r) => (r.invite_day ? fmtDay(r.invite_day) : '') },
    { label: 'Lead stage', get: (r) => r.stage },
    { label: 'Follow-up note', get: (r) => r.note },
    { label: 'Came on', get: (r) => (r.visited || []).map(fmtDay).join(', ') },
  ]));
});
// everything, whatever day is selected: every check-in on every day plus every invited guest who has not arrived
$('exp-noshows').insertAdjacentHTML('afterend', '<button class="btn small" id="exp-all" title="Every guest on every day: checked in and not arrived">Export everything</button>');
$('exp-all').addEventListener('click', async () => {
  const b = $('exp-all'); b.disabled = true; b.textContent = 'Preparing…';
  try {
    const d = await rpc('admin_dashboard', { p_pin: PIN, p_day: null });
    if (d.error) throw new Error(d.error);
    const rows = [
      ...d.checkins.map((r) => ({ ...r, _res: 'Checked in' })),
      ...d.not_arrived.map((r) => ({ ...r, status: 'invited', _res: 'Not arrived', day: null, at: null })),
    ];
    download(`everyone-${stamp()}.csv`, toCSV(rows, [{ label: 'Result', get: (r) => r._res }, ...checkinCols(config?.questions || [])]));
  } catch (e) { alert(e.message || 'Could not export.'); }
  b.disabled = false; b.textContent = 'Export everything';
});

(async () => {
  PIN = await requirePin('viewer');
  if (isObserver()) document.getElementById('admin-link')?.remove();
  config = await rpc('get_event_config').catch(() => null);
  if (config) { $('ev-name').textContent = config.event_name; document.title = `${config.event_name} · Live`; }
  $('app').classList.remove('hidden');
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 4000);
  addEventListener('resize', () => data && renderTimeline(data.timeline));
})();
