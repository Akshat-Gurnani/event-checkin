const $ = (id) => document.getElementById(id);
const urlToken = new URLSearchParams(location.search).get('t') || '';
const token = urlToken || (() => { try { return localStorage.getItem('rep_token') || ''; } catch { return ''; } })();
if (urlToken) { try { localStorage.setItem('rep_token', urlToken); } catch {} }
const SEEN_KEY = 'seen_' + token.slice(0, 10);
let data, vdata = null, viewDay = null, tab = 'arrived', seen = null, audio = null, failures = 0, flashTimer = null, pollTimer = null, stopped = false, pendingRender = false;
const baseTitle = document.title;
const splitB = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const openB = new Set();
document.head.insertAdjacentHTML('beforeend', '<style>.bld > summary{cursor:pointer;list-style:none;font-size:13px;color:var(--text-2)}.bld > summary::-webkit-details-marker{display:none}.bld > summary::after{content:\' ▾\';color:var(--muted)}.bld-opts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;max-width:440px}.bld-opt{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--border);border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}.bld-opt input{width:15px;height:15px;margin:0;accent-color:var(--accent)}.bld-opt:has(input:checked){background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}</style>');
document.addEventListener('toggle', (e) => { const d = e.target; if (d && d.matches && d.matches('details[data-bld]')) { if (d.open) openB.add(d.dataset.bld); else openB.delete(d.dataset.bld); } }, true);

const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const prefLine = (prefs) => Object.values(prefs || {}).map((v) => [].concat(v).join(', ')).filter(Boolean).join(' · ');
const callBtn = (p) => `<a class="btn small" href="tel:+91${digits(p)}">📞 Call</a>`;
const waBtn = (p, text) => `<a class="btn small" target="_blank" rel="noopener" href="https://wa.me/91${digits(p)}${text ? '?text=' + encodeURIComponent(text) : ''}">💬 WhatsApp</a>`;
const welcome = (name) => `Hi ${name.split(/\s+/)[0]}, this is ${data.name}. Welcome to ${data.event || 'our event'} — I'll be with you shortly.`;

/* ---------- alerts: push notification, sound, vibration ---------- */
const PUSH_OK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const b64ToU8 = (s) => { const b = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };

function setEnable(html, { on = false, btn = null } = {}) {
  $('enable').classList.toggle('on', on);
  $('enable-msg').innerHTML = html;
  const b = $('enable-btn');
  b.hidden = !btn;
  if (btn) { b.textContent = btn.label; b.onclick = btn.fn; }
}
function unlockSound() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
}

// Registers this phone with the server so it can push a notification even when the phone is locked.
async function subscribePush() {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const key = await rpc('get_push_key');
  if (!key) throw new Error('Alerts are still being set up on the server — please try again in a minute.');
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
  const j = sub.toJSON();
  const r = await rpc('rep_push_subscribe', { p_token: token, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent.slice(0, 200) });
  if (r.error) throw new Error(r.error === 'unauthorized' ? 'This link is no longer valid.' : r.error);
}
function showOn() {
  setEnable('<b style="color:var(--good-ink)">Alerts are on.</b> You’ll get a notification the moment one of your guests checks in — even when your phone is locked.',
    { on: true, btn: { label: 'Send me a test', fn: sendTest } });
}
async function sendTest() {
  const b = $('enable-btn'); b.disabled = true;
  try {
    const r = await rpc('rep_push_test', { p_token: token });
    if (r.error) throw new Error(r.error);
    if (!r.devices) throw new Error('This phone isn’t registered yet — reload the page and try again.');
    b.textContent = 'Test sent ✓ — check your notifications';
  } catch (e) { b.textContent = e.message; }
  setTimeout(() => { b.disabled = false; b.textContent = 'Send me a test'; }, 5000);
}
async function enablePush() {
  unlockSound();
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return initPush();
    await subscribePush();
    showOn();
  } catch (e) {
    setEnable(`Couldn’t turn on alerts: ${esc(e.message)}`, { btn: { label: 'Try again', fn: enablePush } });
  }
}
async function initPush() {
  if (!PUSH_OK) {
    if (isIOS && !standalone) {
      return setEnable(`<b style="color:var(--text)">To get alerts on your iPhone</b>, add this page to your home screen first:<ol class="steps"><li>Tap the <b>Share</b> button (square with an arrow) in Safari</li><li>Choose <b>Add to Home Screen</b></li><li>Open <b>Guest Alerts</b> from your home screen, then tap <b>Enable alerts</b></li></ol>`);
    }
    return setEnable('This browser can’t send background alerts. Open this link in <b>Chrome</b> (Android) or <b>Safari</b> (iPhone, iOS 16.4 or newer). Until then, keep this page open to hear alerts.',
      { btn: { label: '🔔 Enable sound alerts', fn: () => { unlockSound(); beep(); $('enable-btn').hidden = true; } } });
  }
  if (Notification.permission === 'denied') {
    return setEnable('Notifications are <b>blocked</b> for this page. Open your browser’s site settings, set <b>Notifications</b> to <b>Allow</b>, then reload.');
  }
  if (Notification.permission === 'granted') {
    try { await subscribePush(); return showOn(); } catch {}
  }
  setEnable('<b style="color:var(--text)">Turn on alerts.</b> You’ll get a notification the moment one of your guests checks in — even when your phone is locked.',
    { btn: { label: '🔔 Enable alerts', fn: enablePush } });
}
function beep() {
  if (!audio) return;
  [0, 0.28, 0.56].forEach((d, i) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = i === 2 ? 1175 : 880;
    g.gain.setValueAtTime(0.0001, audio.currentTime + d);
    g.gain.exponentialRampToValueAtTime(0.6, audio.currentTime + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + d + 0.24);
    o.connect(g).connect(audio.destination); o.start(audio.currentTime + d); o.stop(audio.currentTime + d + 0.26);
  });
}
function notify(label) {
  beep();
  try { navigator.vibrate?.([250, 120, 250, 120, 400]); } catch {}
  clearInterval(flashTimer);
  let n = 0;
  flashTimer = setInterval(() => {
    document.title = n++ % 2 ? baseTitle : `🔔 ${label}`;
    if (n > 20) { clearInterval(flashTimer); document.title = baseTitle; }
  }, 700);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  clearInterval(flashTimer); document.title = baseTitle;
  refresh();
});

/* ---------- availability for the walk-in rotation ---------- */
function renderAvail() {
  const box = $('avail');
  if (!data.in_rotation) { box.hidden = true; return; }
  box.hidden = false;
  $('avail-msg').innerHTML = data.available
    ? '🟢 <b style="color:var(--text)">You’re available</b> for walk-in guests. New walk-ins are shared out in turn among free team members.'
    : '⏸ <b style="color:var(--text)">You’re away.</b> New walk-ins will skip you until you’re back.';
  $('avail-btn').textContent = data.available ? 'Go away' : 'I’m back';
}
$('avail-btn').addEventListener('click', async () => {
  $('avail-btn').disabled = true;
  try { await rpc('rep_set_available', { p_token: token, p_available: !data.available }); } catch {}
  $('avail-btn').disabled = false;
  refresh();
});

/* ---------- guest cards ---------- */
function ackBlock(ackId, g, arrivedAt) {
  if (!ackId) return '';
  if (g.other) return `<div class="handled" style="color:var(--text-2)">➡️ Passed to ${esc(g.other)} — they’re looking after this guest</div>`;
  if (g.ack_at) {
    const mine = g.ack_by && g.ack_by.trim().toLowerCase() === data.name.trim().toLowerCase();
    return `<div class="handled">✅ ${mine ? 'You’re handling this guest' : 'Being handled by ' + esc(g.ack_by)} · ${esc(timeAgo(g.ack_at))}</div>`;
  }
  return `<div class="row"><button class="btn small primary" type="button" data-ack="${ackId}">🙋 I’ve got this guest</button><span class="waiting">Waiting ${esc(timeAgo(arrivedAt).replace(' ago', ''))}</span></div>`;
}
function leadBlock(kind, id, stage, note) {
  return `<div class="lead" data-kind="${kind}" data-id="${id}">
    <div class="row"><select class="stage" data-stage="${esc(stage)}" aria-label="Lead stage">${stageOptions(stage)}</select>
      <button class="btn small" type="button" data-notetoggle>📝 ${note ? 'Edit note' : 'Add note'}</button><span class="saved"></span></div>
    ${note ? `<div class="note-preview">${esc(note)}</div>` : ''}
    <div class="note-box" hidden><textarea maxlength="600" placeholder="Follow-up note — what they want, next step, when to call…">${esc(note || '')}</textarea>
      <button class="btn small primary" type="button" data-notesave>Save note</button></div>
  </div>`;
}
function partyBlock(g, ackId) {
  if (!ackId) return '';
  return `<div class="row"><span class="meta">👥 ${g.additional ? '+' + g.additional + ' with them' : 'Came alone'}</span><button class="btn small" type="button" data-party="${ackId}:${g.additional || 0}">Edit</button></div>`;
}
function builderBlock(g, ackId) {
  if (!ackId || !(data.builders || []).length) return '';
  const sel = splitB(g.builder), opts = [...new Set([...data.builders, ...sel])];
  return `<details class="bld" data-bld="${ackId}"${openB.has(String(ackId)) ? ' open' : ''}><summary>🏢 Builder tables: <b>${sel.length ? esc(sel.join(', ')) : '— not set —'}</b></summary><div class="bld-opts">${opts.map((b) => `<label class="bld-opt"><input type="checkbox" data-bchk="${ackId}" value="${esc(b)}"${sel.includes(b) ? ' checked' : ''}> ${esc(b)}</label>`).join('')}</div></details>`;
}
function doneBlock(g, ackId) {
  if (!ackId || g.other) return '';
  if (g.done_at) return `<div class="row"><span class="handled">✔ Done · ${esc(timeAgo(g.done_at))}</span><button class="btn small" type="button" data-done="${ackId}:0">↩ Reopen</button></div>`;
  return `<div class="row"><button class="btn small" type="button" data-done="${ackId}:1">✅ Done with this guest</button></div>`;
}
function card(g, { kind, id, ackId, arrivedAt, extra = '' }) {
  const pl = prefLine(g.prefs);
  return `<div class="card g"><div class="top"><div><b>${esc(g.name)}</b><div class="ph">${esc(g.phone || '')}</div></div>
    ${g.at ? `<span class="muted" style="font-size:12px">${esc(fmtTime(g.at))}</span>` : ''}</div>
    ${extra}${pl ? `<div class="meta">${esc(pl)}</div>` : ''}
    ${partyBlock(g, ackId)}
    ${builderBlock(g, ackId)}
    ${ackBlock(ackId, g, arrivedAt)}
    ${doneBlock(g, ackId)}
    <div class="row">${callBtn(g.phone)}${waBtn(g.phone, ackId ? welcome(g.name) : '')}</div>
    ${leadBlock(kind, id, g.stage || 'New', g.note)}</div>`;
}
const visitsTag = (g) => (g.visits && g.visits.length ? `<div class="visits">Also visited: ${g.visits.map(fmtDay).map(esc).join(', ')}</div>` : '');

function render() {
  if (viewDay && !vdata) { $('list').innerHTML = '<div class="empty">Loading…</div>'; return; }
  const D = vdata || data, past = D.day !== undefined && D.day !== data.today, A = (id) => id;
  const dl = past ? fmtDay(D.day) : 'today';
  const guests = D.guests, arrivedAll = guests.filter((g) => g.arrived), pending = guests.filter((g) => !g.arrived);
  const arrived = arrivedAll.filter((g) => !g.done_at), named = D.named_me.filter((g) => !g.done_at);
  const doneList = [
    ...arrivedAll.filter((g) => g.done_at).map((g) => ({ g, kind: 'rsvp', id: g.id, ackId: A(g.checkin_id), at: g.at })),
    ...D.named_me.filter((g) => g.done_at).map((g) => ({ g, kind: 'checkin', id: g.id, ackId: A(g.id), at: g.at })),
  ];
  renderDays();
  $('hello').textContent = `Hi, ${data.name}`;
  $('k-inv').textContent = guests.length; $('k-arr').textContent = arrivedAll.length; $('k-pend').textContent = pending.length;
  $('c-arr').textContent = `(${arrived.length})`; $('c-pend').textContent = `(${pending.length})`; $('c-named').textContent = `(${named.length})`; $('c-done').textContent = `(${doneList.length})`;
  renderAvail();
  const tag = (g) => g.named && g.named.trim().toLowerCase() !== data.name.trim().toLowerCase() ? `<div class="tag">Customer also named ${esc(g.named)}</div>` : '';
  let html;
  if (tab === 'arrived') html = arrived.map((g) => card(g, { kind: 'rsvp', id: g.id, ackId: A(g.checkin_id), arrivedAt: g.at, extra: tag(g) + visitsTag(g) })).join('')
    || (past ? `<div class="empty">${arrivedAll.length ? `Everyone who came on ${esc(dl)} is marked Done — see the Done tab to call them back.` : `None of your invited guests arrived on ${esc(dl)}.`}</div>` : '<div class="empty">No one has arrived yet today. You’ll be alerted here.</div>');
  else if (tab === 'pending') html = pending.map((g) => card(g, { kind: 'rsvp', id: g.id, ackId: null, extra: visitsTag(g) })).join('')
    || (past ? `<div class="empty">Everyone you invited came on ${esc(dl)} 🎉</div>` : '<div class="empty">Everyone you invited has arrived 🎉</div>');
  else if (tab === 'done') html = doneList.map(({ g, kind, id, ackId, at }) => card(g, { kind, id, ackId, arrivedAt: at })).join('')
    || '<div class="empty">No finished guests yet. When you’re done with a guest, tap “Done with this guest” and they’ll move here.</div>';
  else html = named.map((g) => card(g, { kind: 'checkin', id: g.id, ackId: A(g.id), arrivedAt: g.at,
      extra: `<div class="tag">${g.assigned ? (g.passed_from ? 'Passed to you from ' + esc(g.passed_from) : 'Walk-in assigned to you') : g.status === 'walkin' ? 'Walk-in who asked for you' : 'Invited by ' + esc(g.invited_by || 'another rep') + ', but asked for you'} · ${esc(fmtDay(g.day))}</div>` })).join('')
    || (past ? `<div class="empty">No walk-ins or requests on ${esc(dl)}.</div>` : '<div class="empty">No walk-ins or requests yet. Walk-ins assigned to you or asking for you appear here.</div>');
  $('list').innerHTML = html;
}
function renderDays() {
  const el = $('daytabs'); if (!el) return;
  const cur = viewDay || data.today;
  const days = [...new Set([data.today, ...(((vdata || data).days) || []).map(String)])].sort();
  el.innerHTML = days.map((d) => {
    const sub = d === data.today ? 'Today' : d < data.today ? 'Earlier' : 'Upcoming';
    return `<button class="tab daytab" role="tab" data-day="${esc(d)}" aria-selected="${d === cur}">${esc(fmtDay(d))}<small style="display:block;font-weight:700;font-size:11px;opacity:.75">${sub}</small></button>`;
  }).join('');
  $('daynote').hidden = cur === data.today;
  $('daynote').textContent = `Showing ${fmtDay(cur)} — call anyone who came that day, or who didn’t make it.`;
}
function typing() { const a = document.activeElement; return a && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && a.type === 'checkbox')) && $('list').contains(a); }
function safeRender() { if (typing()) { pendingRender = true; return; } pendingRender = false; render(); }
document.addEventListener('focusout', () => { if (pendingRender) setTimeout(() => { if (!typing()) safeRender(); }, 250); });

function showAlert(kind, g) {
  const el = document.createElement('div');
  el.className = 'alert';
  const title = kind === 'mine' ? 'Your guest has arrived'
    : g.assigned ? (g.passed_from ? `Passed to you from ${esc(g.passed_from)}` : 'Walk-in assigned to you')
    : g.status === 'walkin' ? 'A walk-in asked for you' : `Asked for you · invited by ${esc(g.invited_by || 'another rep')}`;
  const pl = prefLine(g.prefs);
  const ackId = kind === 'mine' ? g.checkin_id : g.id;
  el.innerHTML = `<div class="t">🔔 ${title}</div><h2>${esc(g.name)}</h2><p>${esc(g.phone || '')}${g.additional ? ` · 👥 +${g.additional} with them` : ''}${pl ? ' · ' + esc(pl) : ''}</p>
    <div class="row"><button class="btn small primary" type="button" data-ack="${ackId}">🙋 I’ve got this guest</button>${callBtn(g.phone)}${waBtn(g.phone, welcome(g.name))}<button class="btn small" type="button" data-dismiss>Dismiss</button></div>`;
  $('alerts').prepend(el);
}

/* ---------- actions: acknowledge, stage, notes ---------- */
async function saveLead(el) {
  const kind = el.dataset.kind, id = Number(el.dataset.id);
  const stage = el.querySelector('select.stage').value, note = el.querySelector('textarea').value;
  const saved = el.querySelector('.saved');
  saved.textContent = 'Saving…';
  try {
    const r = await rpc('rep_set_lead', { p_token: token, p_kind: kind, p_id: id, p_stage: stage, p_note: note });
    if (r.error) throw new Error(r.error);
    saved.textContent = 'Saved ✓';
    const list = kind === 'rsvp' ? data.guests : data.named_me;
    const item = list.find((x) => x.id === id);
    if (item) { item.stage = stage; item.note = note.trim() || null; }
    if (typing()) document.activeElement.blur();   // phones keep the keyboard open otherwise, and the page waits while you type
    setTimeout(render, 600);
  } catch (e) { saved.textContent = '⚠ ' + e.message; }
}
document.addEventListener('click', async (e) => {
  const dn = e.target.closest('[data-done]');
  if (dn) {
    const [cid, flag] = dn.dataset.done.split(':');
    dn.disabled = true;
    try { const r = await rpc('rep_set_done', { p_token: token, p_checkin_id: Number(cid), p_done: flag === '1' }); if (r.error) alert(r.error); } catch (x) { alert(x.message); }
    refresh();
    return;
  }
  const pt = e.target.closest('[data-party]');
  if (pt) {
    const [cid, cur] = pt.dataset.party.split(':').map(Number);
    const v = prompt('How many people came with this guest (besides them)?', String(cur));
    if (v === null) return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 20) { alert('Enter a whole number from 0 to 20.'); return; }
    pt.disabled = true;
    try { const r = await rpc('rep_set_additional', { p_token: token, p_checkin_id: cid, p_additional: n }); if (r.error) alert(r.error); } catch (x) { alert(x.message); }
    refresh();
    return;
  }
  const ack = e.target.closest('[data-ack]');
  if (ack) {
    ack.disabled = true;
    try { await rpc('rep_ack', { p_token: token, p_checkin_id: Number(ack.dataset.ack) }); } catch {}
    ack.closest('.alert')?.remove();
    refresh();
    return;
  }
  if (e.target.closest('[data-dismiss]')) { e.target.closest('.alert').remove(); return; }
  const tog = e.target.closest('[data-notetoggle]');
  if (tog) { const box = tog.closest('.lead').querySelector('.note-box'); box.hidden = !box.hidden; if (!box.hidden) box.querySelector('textarea').focus(); return; }
  const sv = e.target.closest('[data-notesave]');
  if (sv) saveLead(sv.closest('.lead'));
});
document.addEventListener('change', async (e) => {
  const bc = e.target.closest('[data-bchk]');
  if (bc) {
    const box = bc.closest('details'), vals = [...box.querySelectorAll('input[data-bchk]:checked')].map((x) => x.value).join(', ');
    box.querySelector('summary b').textContent = vals || '— not set —';
    try { const r = await rpc('rep_set_builder', { p_token: token, p_checkin_id: Number(bc.dataset.bchk), p_builder: vals }); if (r.error) alert(r.error); } catch (x) { alert(x.message); }
    return;
  }
  const bs = e.target.closest('[data-builder]');
  if (bs) {
    bs.blur();
    try { const r = await rpc('rep_set_builder', { p_token: token, p_checkin_id: Number(bs.dataset.builder), p_builder: bs.value }); if (r.error) alert(r.error); } catch (x) { alert(x.message); }
    refresh();
    return;
  }
  const sel = e.target.closest('select.stage');
  if (sel) { sel.dataset.stage = sel.value; saveLead(sel.closest('.lead')); }
});

/* ---------- polling ---------- */
function currentArrivals() {
  const m = new Map();
  data.guests.filter((g) => g.arrived).forEach((g) => m.set('g' + g.checkin_id, ['mine', g]));
  data.named_me.forEach((g) => m.set('n' + g.id, ['named', g]));
  return m;
}
async function refresh() {
  if (stopped) return false;
  try {
    const d = await rpc('rep_dashboard', { p_token: token });
    if (d.error) { stopped = true; clearInterval(pollTimer); $('app').classList.add('hidden'); $('invalid').classList.remove('hidden'); return false; }
    data = d; failures = 0;
    const now = currentArrivals();
    if (seen === null) { try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || 'null') ?? [...now.keys()]); } catch { seen = new Set(now.keys()); } }
    const fresh = [...now].filter(([k]) => !seen.has(k));
    fresh.forEach(([k, [kind, g]]) => { seen.add(k); showAlert(kind, g); });
    if (fresh.length) notify(fresh.length === 1 ? `${fresh[0][1][1].name} arrived` : `${fresh.length} guests arrived`);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch {}
    try { const v = await rpc('rep_dashboard_day', { p_token: token, p_day: viewDay }); if (!v.error) vdata = v; } catch {}
    if (!viewDay && vdata && vdata.day !== data.today) vdata = null;
    $('app').classList.remove('hidden'); $('invalid').classList.add('hidden');
    safeRender();
    $('live').classList.remove('stale');
    $('updated').textContent = `Live · ${fmtDay(d.today)} · updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
    return true;
  } catch {
    if (++failures >= 2) { $('live').classList.add('stale'); $('updated').textContent = 'Connection lost — retrying…'; $('app').classList.remove('hidden'); }
    return true;
  }
}

document.querySelector('.kpis').insertAdjacentHTML('beforebegin', '<div class="tabs" id="daytabs" role="tablist" aria-label="Event day"></div><div class="meta muted" id="daynote" hidden style="font-size:13px"></div>');
$('daytabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]'); if (!b || !data) return;
  viewDay = b.dataset.day === data.today ? null : b.dataset.day;
  vdata = null; document.querySelectorAll('.daytab').forEach((x) => x.setAttribute('aria-selected', x === b)); $('daynote').hidden = !viewDay; $('list').innerHTML = '<div class="empty">Loading…</div>'; refresh();
});
document.querySelector('.tabs:not(#daytabs)').insertAdjacentHTML('beforeend', '<button class="tab" role="tab" data-tab="done" aria-selected="false">Done <span id="c-done"></span></button>');
document.querySelectorAll('.tab[data-tab]').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  document.querySelectorAll('.tab[data-tab]').forEach((x) => x.setAttribute('aria-selected', x === b));
  if (data) render();
}));

(async () => {
  if (!token) { $('invalid').classList.remove('hidden'); return; }
  initPush();
  if (await refresh()) pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, 4000);
})();
