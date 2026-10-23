const $ = (id) => document.getElementById(id);
let PIN, config, parsed = [];
const note = (id, msg, kind = '') => { $(id).innerHTML = msg ? `<div class="note ${kind}">${msg}</div>` : ''; };

/* ---------- RSVP import ---------- */
function cellText(v) {
  if (typeof v === 'number') return v.toFixed(0); // avoid 9.87654E+09 for long numbers
  return String(v ?? '').trim();
}
function pickColumns(header) {
  const h = header.map((x) => String(x).toLowerCase());
  const find = (...keys) => h.findIndex((c) => keys.some((k) => c.includes(k)));
  const invited = find('invit', 'refer', 'team', 'owner', 'agent', 'rm', 'sales');
  const phone = find('phone', 'number', 'mobile', 'contact', 'whatsapp', 'no.');
  let name = h.findIndex((c, i) => c.includes('name') && i !== invited);
  return { name, phone, invited };
}
function ingest(rows) {
  rows = rows.filter((r) => r.some((c) => cellText(c)));
  if (rows.length < 2) { parsed = []; note('preview', 'Need a header row plus at least one guest.', 'bad'); updateButtons(); return; }
  const cols = pickColumns(rows[0]);
  if (cols.name < 0 || cols.phone < 0) {
    parsed = []; note('preview', `Couldn’t find the <b>Name</b> and <b>Number</b> columns. Headers seen: ${rows[0].map(esc).join(', ')}`, 'bad'); updateButtons(); return;
  }
  parsed = rows.slice(1).map((r) => ({
    name: cellText(r[cols.name]), phone: cellText(r[cols.phone]), invited_by: cols.invited >= 0 ? cellText(r[cols.invited]) : '',
  }));
  const valid = parsed.filter((r) => r.name && r.phone.replace(/\D/g, '').length >= 10);
  const bad = parsed.length - valid.length;
  const byNum = new Map();
  valid.forEach((r) => { const k = r.phone.replace(/\D/g, '').slice(-10); byNum.set(k, [...(byNum.get(k) || []), r]); });
  const dupGroups = [...byNum.entries()].filter(([, rows]) => rows.length > 1);
  const dupes = dupGroups.reduce((n, [, rows]) => n + rows.length - 1, 0);
  const dupLines = dupGroups.slice(0, 5).map(([k, rows]) => `${esc(k)} appears ${rows.length}× (${rows.map((r) => esc(r.invited_by || 'no inviter')).join(', ')}) — the first row, <b>${esc(rows[0].invited_by || 'no inviter')}</b>, is used`);
  $('preview').innerHTML = `
    <div class="note">Found <b>${parsed.length}</b> rows · columns: Name → “${esc(rows[0][cols.name])}”, Number → “${esc(rows[0][cols.phone])}”, Invited by → ${cols.invited >= 0 ? `“${esc(rows[0][cols.invited])}”` : '<b>not found</b>'}
    ${bad ? `<br>⚠️ ${bad} row(s) missing a name or a 10-digit number will be skipped.` : ''}${dupes ? `<br>⚠️ ${dupes} repeated number(s) — only the <b>first</b> row per number is kept:<br>${dupLines.join('<br>')}${dupGroups.length > 5 ? `<br>…and ${dupGroups.length - 5} more` : ''}` : ''}</div>
    <div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>Number</th><th>Invited by</th></tr></thead><tbody>
    ${parsed.slice(0, 5).map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.invited_by)}</td></tr>`).join('')}
    ${parsed.length > 5 ? `<tr><td colspan="3" class="muted">…and ${parsed.length - 5} more</td></tr>` : ''}</tbody></table></div>`;
  updateButtons();
}
function updateButtons() { $('imp-merge').disabled = $('imp-replace').disabled = !parsed.length; }

async function readFile(f) {
  const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
  ingest(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }));
}
$('drop').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => e.target.files[0] && readFile(e.target.files[0]));
['dragover', 'dragenter'].forEach((ev) => $('drop').addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => $('drop').addEventListener(ev, () => $('drop').classList.remove('over')));
$('drop').addEventListener('drop', (e) => { e.preventDefault(); e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]); });
$('paste').addEventListener('input', () => {
  const text = $('paste').value;
  if (!text.trim()) { parsed = []; $('preview').innerHTML = ''; updateButtons(); return; }
  const wb = XLSX.read(text, { type: 'string', raw: true });
  ingest(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }));
});

async function doImport(replace) {
  if (replace && !confirm('Replace the entire RSVP list with this file? Existing check-ins are kept and re-matched against the new list.')) return;
  note('imp-result', 'Uploading…');
  try {
    const r = await rpc('admin_import_rsvp', { p_pin: PIN, p_rows: parsed, p_replace: replace });
    if (r.error) throw new Error(r.error);
    note('imp-result', `✓ Saved ${r.imported} guests${r.skipped_invalid ? ` (${r.skipped_invalid} invalid rows skipped)` : ''}${r.duplicates_in_file ? `, ${r.duplicates_in_file} repeated number(s) ignored` : ''}. The RSVP list now has <b>${r.total_rsvp}</b> guests.`, 'ok');
    $('rsvp-count').textContent = `${r.total_rsvp} guests on the list`;
    loadRepLinks();
  } catch (e) { note('imp-result', esc(e.message), 'bad'); }
}
$('imp-merge').addEventListener('click', () => doImport(false));
$('imp-replace').addEventListener('click', () => doImport(true));

/* ---------- config ---------- */
function questionEl(q = { key: '', label: '', type: 'single', options: [] }) {
  const el = document.createElement('div');
  el.className = 'q';
  el.dataset.key = q.key || '';
  el.innerHTML = `
    <div class="row"><input type="text" class="q-label" placeholder="Question, e.g. Budget" value="${esc(q.label)}">
      <select class="q-type"><option value="single">Pick one</option><option value="multi">Pick any</option></select>
      <button class="btn small danger q-del" type="button">Remove</button></div>
    <textarea class="q-opts" placeholder="Options, one per line">${esc(q.options.join('\n'))}</textarea>`;
  el.querySelector('.q-type').value = q.type;
  el.querySelector('.q-del').addEventListener('click', () => el.remove());
  return el;
}
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || `q_${Date.now()}`; }

async function loadConfig() {
  config = await rpc('get_event_config');
  $('ev-name').value = config.event_name || '';
  $('ev-sub').value = config.event_subtitle || '';
  $('team').value = (config.extra_team || []).join('\n');
  $('builders').value = (config.builders || []).join('\n');
  $('questions').innerHTML = '';
  (config.questions || []).forEach((q) => $('questions').appendChild(questionEl(q)));
}
$('add-q').addEventListener('click', () => $('questions').appendChild(questionEl()));
$('save-cfg').addEventListener('click', async () => {
  const used = new Set();
  const questions = [...document.querySelectorAll('.q')].map((el) => {
    const label = el.querySelector('.q-label').value.trim();
    let key = el.dataset.key || slug(label);
    while (used.has(key)) key += '_2';
    used.add(key);
    return { key, label, type: el.querySelector('.q-type').value,
      options: el.querySelector('.q-opts').value.split('\n').map((s) => s.trim()).filter(Boolean) };
  }).filter((q) => q.label && q.options.length);
  const cfg = {
    event_name: $('ev-name').value.trim() || 'Walk-in Event',
    event_subtitle: $('ev-sub').value.trim(),
    team: $('team').value.split('\n').map((s) => s.trim()).filter(Boolean),
    builders: $('builders').value.split('\n').map((s) => s.trim()).filter(Boolean),
    questions,
    base_version: config.version,
  };
  try {
    const r = await rpc('admin_save_config', { p_pin: PIN, p_config: cfg });
    if (r.error) throw new Error(r.error);
    note('cfg-result', '✓ Saved. The guest form is updated immediately.', 'ok');
    await loadConfig();
    loadRepLinks();
  } catch (e) { note('cfg-result', esc(e.message), 'bad'); if (/somewhere else/.test(e.message)) loadConfig(); }
});

/* ---------- QR ---------- */
const base = location.href.replace(/admin\.html.*$/, '');
const guestUrl = base, kioskUrl = `${base}?kiosk=1`;
$('guest-url').textContent = guestUrl;
$('kiosk-url').textContent = kioskUrl;
new QRCode($('qr'), { text: guestUrl, width: 880, height: 880, correctLevel: QRCode.CorrectLevel.M });
$('dl-qr').addEventListener('click', () => {
  const c = $('qr').querySelector('canvas');
  const pad = 80, out = document.createElement('canvas');
  out.width = out.height = c.width + pad * 2;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height); ctx.drawImage(c, pad, pad);
  const a = document.createElement('a'); a.href = out.toDataURL('image/png'); a.download = 'checkin-qr.png'; a.click();
});

/* ---------- team links ---------- */
const repUrl = (token) => `${base}rep.html?t=${token}`;
async function loadRepLinks() {
  const box = $('rep-links');
  try {
    const links = await rpc('admin_rep_links', { p_pin: PIN });
    if (links.error) throw new Error(links.error);
    if (!links.length) { box.innerHTML = '<div class="note">Upload the RSVP list first — links appear for every name in the “Invited by” column.</div>'; return; }
    const event = $('ev-name').value.trim() || 'the event';
    box.innerHTML = `<div style="display:grid;gap:10px">${links.map((l) => {
      const msg = `Hi ${l.name}, this is your personal live guest page for ${event}: ${repUrl(l.token)}\n\nOpen it on your phone and tap “Enable alerts” — you’ll get a sound the moment one of your guests checks in. Please don’t share this link.`;
      return `<div class="rep"><div><b>${esc(l.name)}</b><div class="sub">${l.invited} invited · ${l.arrived} arrived</div></div>
        <div class="row">
          <button class="btn small" type="button" data-copy="${esc(repUrl(l.token))}">Copy link</button>
          <a class="btn small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Send on WhatsApp</a>
          <a class="btn small" target="_blank" rel="noopener" href="${esc(repUrl(l.token))}">Open</a>
          <button class="btn small danger" type="button" data-rotate="${esc(l.name)}" title="Invalidate the old link and make a new one">Reset link</button>
        </div></div>`;
    }).join('')}</div>`;
  } catch (e) { box.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
}
$('rep-links').addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]'), rot = e.target.closest('[data-rotate]');
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = 'Copied ✓'; } catch { prompt('Copy this link:', copy.dataset.copy); }
    setTimeout(() => (copy.textContent = 'Copy link'), 1800);
  }
  if (rot && confirm(`Make a new link for ${rot.dataset.rotate}? Their old link will stop working immediately.`)) {
    await rpc('admin_rotate_rep_token', { p_pin: PIN, p_name: rot.dataset.rotate });
    loadRepLinks();
  }
});
$('reload-links').addEventListener('click', loadRepLinks);

/* ---------- observers ---------- */
const obsUrl = (token) => `${base}dashboard.html?o=${token}`;
async function loadObservers() {
  const box = $('obs-list');
  try {
    const list = await rpc('admin_observers', { p_pin: PIN });
    if (list.error) throw new Error(list.error);
    if (!list.length) { box.innerHTML = '<div class="note">No observers yet.</div>'; return; }
    const event = $('ev-name').value.trim() || 'the event';
    box.innerHTML = `<div style="display:grid;gap:10px">${list.map((l) => {
      const msg = `Hi ${l.name}, here is your personal access link to the live dashboard and front desk for ${event}: ${obsUrl(l.token)}\n\nOpen it once on your phone or laptop and it stays signed in. Please don’t share this link.`;
      return `<div class="rep"><div><b>${esc(l.name)}</b><div class="sub">${l.last_seen ? 'Last opened ' + esc(timeAgo(l.last_seen)) : 'Not opened yet'}</div></div>
        <div class="row">
          <button class="btn small" type="button" data-ocopy="${esc(obsUrl(l.token))}">Copy link</button>
          <a class="btn small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Send on WhatsApp</a>
          <a class="btn small" target="_blank" rel="noopener" href="${esc(obsUrl(l.token))}">Open</a>
          <button class="btn small danger" type="button" data-orotate="${esc(l.name)}" title="Invalidate the old link and make a new one">Reset link</button>
          <button class="btn small danger" type="button" data-oremove="${esc(l.name)}">Remove</button>
        </div></div>`;
    }).join('')}</div>`;
  } catch (e) { box.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
}
$('obs-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await rpc('admin_observer_add', { p_pin: PIN, p_name: $('obs-name').value }).catch((x) => ({ error: x.message }));
  if (r.error) return note('obs-note', esc(r.error), 'bad');
  note('obs-note', '✓ Added. Copy or send their link below.', 'ok');
  e.target.reset(); loadObservers();
});
$('obs-list').addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-ocopy]'), rot = e.target.closest('[data-orotate]'), rem = e.target.closest('[data-oremove]');
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.ocopy); copy.textContent = 'Copied ✓'; } catch { prompt('Copy this link:', copy.dataset.ocopy); }
    setTimeout(() => (copy.textContent = 'Copy link'), 1800);
  }
  if (rot && confirm(`Make a new link for ${rot.dataset.orotate}? Their old link stops working immediately.`)) {
    await rpc('admin_observer_rotate', { p_pin: PIN, p_name: rot.dataset.orotate }); loadObservers();
  }
  if (rem && confirm(`Remove ${rem.dataset.oremove}? Their link stops working immediately.`)) {
    await rpc('admin_observer_remove', { p_pin: PIN, p_name: rem.dataset.oremove }); loadObservers();
  }
});

/* ---------- PIN / reset ---------- */
$('logout').addEventListener('click', () => { store.del('walkin_pin'); location.reload(); });
async function reset(what, msg) {
  if (!confirm(msg)) return;
  const r = await rpc('admin_reset', { p_pin: PIN, p_what: what });
  note('reset-result', r.ok ? '✓ Done.' : esc(r.error), r.ok ? 'ok' : 'bad');
  refreshCount();
}
$('reset-checkins').addEventListener('click', () => reset('checkins', 'Delete ALL check-ins? This cannot be undone.'));
$('reset-all').addEventListener('click', () => reset('all', 'Delete the RSVP list AND all check-ins? This cannot be undone.'));

async function refreshCount() {
  const d = await rpc('admin_dashboard', { p_pin: PIN });
  $('rsvp-count').textContent = `${d.invited} guests on the list · ${d.arrived_invited + d.walkins} check-ins so far`;
}

(async () => {
  PIN = await requirePin();
  $('app').classList.remove('hidden');
  await Promise.all([loadConfig(), refreshCount()]);
  loadRepLinks(); loadObservers();
})();
