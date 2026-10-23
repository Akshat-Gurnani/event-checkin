// Shared client for the walk-in check-in app.
// The publishable (anon) key is safe to ship: every table is locked behind RLS and all
// access goes through PIN/token-gated database functions.
// Set these two values in config.js (see docs/DEPLOYMENT.md).
const SB_URL = (window.APP_CONFIG || {}).SUPABASE_URL;
const SB_KEY = (window.APP_CONFIG || {}).SUPABASE_PUBLISHABLE_KEY;
if (!SB_URL || !SB_KEY || /YOUR-PROJECT|YOUR_KEY/.test(SB_URL + SB_KEY)) console.error('Missing Supabase settings: edit web/config.js');

async function rpc(fn, args = {}, timeoutMs = 12000) {
  // never hang forever on a slow or blocked network
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'The server took too long to respond.' : 'Could not reach the server.');
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.message) || `Request failed (${res.status})`);
  return body;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k) { try { return sessionStorage.getItem(k) || localStorage.getItem(k); } catch { return null; } },
  set(k, v, remember) {
    try { sessionStorage.setItem(k, v); if (remember) localStorage.setItem(k, v); } catch {}
  },
  del(k) { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch {} },
};

// PIN gate. level 'admin' (admin page) accepts only the admin PIN; 'viewer' (dashboard, front desk)
// also accepts a personal observer link (?o=TOKEN, kept on this device). Resolves with the credential.
const isObserver = () => (store.get('walkin_pin') || '').startsWith('obs_');
async function requirePin(level = 'admin') {
  const fromUrl = level === 'viewer' ? new URLSearchParams(location.search).get('o') : null;
  if (fromUrl) {
    history.replaceState(null, '', location.pathname);
    const r = await rpc('viewer_login', { p_pin: fromUrl }).catch(() => null);
    if (r && r.ok) { store.set('walkin_pin', fromUrl, true); return fromUrl; }
    document.body.insertAdjacentHTML('beforeend', '<div class="gate"><div class="gate-card"><h1>Link not valid</h1><p class="muted">This access link has been reset or removed. Ask the event admin for a new one.</p></div></div>');
    return new Promise(() => {});
  }
  const saved = store.get('walkin_pin');
  if (saved) {
    const ok = level === 'viewer' ? (await rpc('viewer_login', { p_pin: saved }).catch(() => null) || {}).ok : await rpc('admin_login', { p_pin: saved }).catch(() => false);
    if (ok) return saved;
  }
  if (!(saved || '').startsWith('obs_') || level === 'viewer') store.del('walkin_pin'); // an observer opening the admin page keeps their link

  return new Promise((resolve) => {
    const gate = document.createElement('div');
    gate.className = 'gate';
    gate.innerHTML = `
      <form class="gate-card">
        <h1>Staff access</h1>
        <p class="muted">Enter the admin PIN to continue.</p>
        <input name="pin" type="password" autocomplete="current-password" placeholder="Admin PIN" required autofocus>
        <label class="check"><input type="checkbox" name="remember"> Remember on this device</label>
        <p class="error" hidden></p>
        <button class="btn primary" type="submit">Unlock</button>
      </form>`;
    document.body.appendChild(gate);
    const form = gate.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = form.pin.value.trim();
      const err = form.querySelector('.error');
      err.hidden = true;
      const ok = level === 'viewer' ? ((await rpc('viewer_login', { p_pin: pin }).catch(() => null)) || {}).ok : await rpc('admin_login', { p_pin: pin }).catch(() => false);
      if (!ok) { err.textContent = 'Incorrect PIN (too many attempts locks access for 10 minutes).'; err.hidden = false; return; }
      store.set('walkin_pin', pin, form.remember.checked);
      gate.remove();
      resolve(pin);
    });
  });
}

function toCSV(rows, cols) {
  const cell = (v) => {
    let s = String(v ?? '');
    // stop guest-typed text from running as a spreadsheet formula (=, @, or +/- followed by non-numbers)
    if (/^[=@\t\r]/.test(s) || /^[+-](?![\d\s().-]*$)/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => cell(c.label)).join(','), ...rows.map((r) => cols.map((c) => cell(c.get(r))).join(','))].join('\n');
}

function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/* ---------- v2 helpers ---------- */
const STAGES = ['New', 'Yet To Talk', 'Followup', 'Hot', 'Cold', 'Converted', 'Lost', 'Warm'];
const stageOptions = (cur) => STAGES.map((s) => `<option${s === cur ? ' selected' : ''}>${esc(s)}</option>`).join('');

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
const fmtDay = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

// Pop-up used by the dashboard and the front desk: match a walk-in (different number) to an invited guest.
function linkModal({ pin, checkin, onDone }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>Link “${esc(checkin.name)}” to an invited guest</h2>
      <p class="muted" style="margin:0;font-size:14px">${esc(checkin.name)} checked in with ${esc(checkin.phone)}, which isn't on the guest list. Find them in the RSVP list: they become that guest, the inviter gets the credit and an alert, and this number is remembered.</p>
      <input type="search" placeholder="Search by name, number or inviter…" autofocus>
      <div class="results" style="display:grid;gap:8px"></div>
      <p class="error" hidden></p>
      <div style="display:flex;justify-content:flex-end"><button class="btn" type="button" data-close>Cancel</button></div>
    </div>`;
  document.body.appendChild(back);
  const input = back.querySelector('input'), box = back.querySelector('.results'), err = back.querySelector('.error');
  const close = () => back.remove();
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', function esc_(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc_); } });
  let timer;
  async function search() {
    err.hidden = true;
    const rows = await rpc('admin_rsvp_search', { p_pin: pin, p_q: input.value }).catch(() => []);
    box.innerHTML = Array.isArray(rows) && rows.length
      ? rows.map((r) => `<div class="pick"><div><b>${esc(r.name)}</b><div class="sub">${esc(r.phone)} · invited by ${esc(r.invited_by || '—')}</div></div>
          ${r.arrived_today ? '<span class="muted" style="font-size:12px">already in today</span>' : `<button class="btn small primary" type="button" data-link="${r.id}">Link</button>`}</div>`).join('')
      : '<div class="muted" style="font-size:14px">No matching guests.</div>';
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-link]'); if (!b) return;
    b.disabled = true;
    const r = await rpc('admin_link_checkin', { p_pin: pin, p_checkin_id: checkin.id, p_rsvp_id: Number(b.dataset.link) }).catch((x) => ({ error: x.message }));
    if (r.error) { err.textContent = r.error; err.hidden = false; b.disabled = false; return; }
    close(); onDone && onDone(r);
  });
  search();
}

// Availability label for a team member, from the dashboard's `reps` data.
function repStatus(r) {
  const recent = r.last_ack_at && Date.now() - new Date(r.last_ack_at).getTime() < 20 * 60e3;
  if (r.in_rotation && !r.available) return { rank: 2, label: 'Away' };
  if (r.open_walkins || recent) return { rank: 1, label: r.open_walkins ? `Busy · ${r.open_walkins} waiting` : 'Busy with a guest' };
  return { rank: 0, label: r.in_rotation ? 'Free' : 'Free · doesn’t take walk-ins' };
}

// Pop-up used by the dashboard and the front desk: hand a guest to another team member.
function reassignModal({ pin, checkin, reps, onDone }) {
  const now = String(checkin.assigned_to || checkin.referred_by || checkin.invited_by || '').trim();
  const list = (reps || []).map((r) => ({ r, s: repStatus(r) })).sort((a, b) => a.s.rank - b.s.rank || a.r.name.localeCompare(b.r.name));
  const colour = ['var(--good-ink)', 'var(--warn-ink)', 'var(--muted)'];
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>Pass “${esc(checkin.name)}” to someone else</h2>
      <p class="muted" style="margin:0;font-size:14px">${now ? `Currently with <b>${esc(now)}</b>. ` : ''}The new person gets an alert and can tap “I’ve got this guest”; the previous person is told it has been passed on.</p>
      <button class="btn primary" type="button" data-next>⚡ Next free person</button>
      <div class="results" style="display:grid;gap:8px">${list.map(({ r, s }) => {
        const here = r.name.trim().toLowerCase() === now.toLowerCase();
        return `<div class="pick"><div><b>${esc(r.name)}</b><div class="sub" style="color:${colour[s.rank]}">● ${esc(s.label)}</div></div>
          ${here ? '<span class="muted" style="font-size:12px">has the guest</span>' : `<button class="btn small" type="button" data-to="${esc(r.name)}">Pass to ${esc(r.name)}</button>`}</div>`;
      }).join('') || '<div class="muted" style="font-size:14px">No team members yet.</div>'}</div>
      <p class="error" hidden></p>
      <div style="display:flex;justify-content:flex-end"><button class="btn" type="button" data-close>Cancel</button></div>
    </div>`;
  document.body.appendChild(back);
  const err = back.querySelector('.error');
  const close = () => back.remove();
  document.addEventListener('keydown', function esc_(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc_); } });
  back.addEventListener('click', async (e) => {
    if (e.target === back || e.target.closest('[data-close]')) return close();
    const b = e.target.closest('[data-to],[data-next]'); if (!b) return;
    back.querySelectorAll('button').forEach((x) => (x.disabled = true));
    err.hidden = true;
    const r = await rpc('admin_reassign', { p_pin: pin, p_checkin_id: checkin.id, p_to: b.dataset.to || null }).catch((x) => ({ error: x.message }));
    if (r.error) { err.textContent = r.error; err.hidden = false; back.querySelectorAll('button').forEach((x) => (x.disabled = false)); return; }
    close(); onDone && onDone(r);
  });
}
