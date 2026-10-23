const kiosk = new URLSearchParams(location.search).has('kiosk');
const $ = (id) => document.getElementById(id);
let config;

function renderQuestions(questions) {
  $('questions').innerHTML = questions.map((q) => `
    <fieldset style="border:0;margin:0;padding:0">
      <legend class="field" style="padding:0;margin-bottom:8px;font-weight:600;font-size:14px">${esc(q.label)}
        ${q.type === 'multi' ? '<span class="hint">(select all that apply)</span>' : ''}</legend>
      <div class="chips">
        ${q.options.map((o) => `<label class="chip"><input type="${q.type === 'multi' ? 'checkbox' : 'radio'}" name="q_${esc(q.key)}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('')}
      </div>
    </fieldset>`).join('');
}

function renderReferred(team) {
  $('referred').innerHTML = `<option value="">Select…</option>`
    + team.map((t) => `<option>${esc(t)}</option>`).join('')
    + `<option value="">No one – I came on my own</option>`;
}

function renderBuilders(list) {
  const box = $('builder-box');
  if (!list.length) { box.classList.add('hidden'); return; }
  $('builder').style.display = 'none';
  box.querySelector('label').innerHTML = 'Which builders’ tables are you visiting? <span class="hint">(optional — pick all that apply)</span>';
  let w = $('builder-opts');
  if (!w) { w = document.createElement('div'); w.id = 'builder-opts'; w.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px'; $('builder').insertAdjacentElement('afterend', w); }
  w.innerHTML = list.map((b) => `<label class="check" style="border:1px solid var(--border);border-radius:999px;padding:8px 12px;align-items:center"><input type="checkbox" value="${esc(b)}" style="margin:0"> ${esc(b)}</label>`).join('');
  box.classList.remove('hidden');
}

async function init() {
  $('loading').textContent = 'Loading…';
  try {
    try { config = await rpc('get_event_config'); }
    catch { config = await rpc('get_event_config'); } // one automatic retry
  } catch (e) {
    $('loading').innerHTML = '<p style="margin:0 0 6px;color:var(--text)">We couldn’t load the check-in form.</p>'
      + '<p style="margin:0 0 16px">Please check your internet connection. If you’re on Wi-Fi, try switching to mobile data.</p>'
      + '<button class="btn" type="button" id="retry">Try again</button>';
    $('retry').addEventListener('click', init);
    return;
  }
  document.title = `${config.event_name} · Check-in`;
  $('ev-name').textContent = config.event_name;
  $('ev-sub').textContent = config.event_subtitle || '';
  renderQuestions(config.questions || []);
  renderReferred(config.team || []);
  renderBuilders(config.builders || []);
  $('loading').classList.add('hidden');
  $('form').classList.remove('hidden');
}

function collectPrefs() {
  const prefs = {};
  for (const q of config.questions || []) {
    const picked = [...document.querySelectorAll(`input[name="q_${CSS.escape(q.key)}"]:checked`)].map((i) => i.value);
    if (!picked.length) continue;
    prefs[q.key] = q.type === 'multi' ? picked : picked[0];
  }
  return prefs;
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('err');
  err.hidden = true;
  const name = $('name').value.trim();
  const digits = $('phone').value.replace(/\D/g, '').slice(-10);
  if (name.length < 2) { err.textContent = 'Please enter your name.'; err.hidden = false; $('name').focus(); return; }
  if (digits.length !== 10) { err.textContent = 'Please enter a valid 10-digit mobile number.'; err.hidden = false; $('phone').focus(); return; }

  const btn = $('submit');
  btn.disabled = true; btn.textContent = 'Checking in…';
  try {
    const r = await rpc('check_in', {
      p_name: name, p_phone: $('phone').value, p_prefs: collectPrefs(),
      p_referred_by: $('referred').value || null, p_consent: $('consent').checked,
      p_additional: Number($('additional').value) || 0,
      p_builder: [...document.querySelectorAll('#builder-opts input:checked')].map((x) => x.value).join(', ') || null,
    });
    if (!r.ok) throw new Error(r.error);
    showDone(r);
  } catch (ex) {
    err.textContent = ex.message || 'Something went wrong. Please try again.';
    err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Check in';
  }
});

function showDone(r) {
  const first = esc(r.name.split(/\s+/)[0]);
  const copy = {
    invited:   [`Welcome, ${first}!`, 'You’re on our guest list. A member of our team will be with you shortly.'],
    walkin:    [`Welcome, ${first}!`, 'Thank you for checking in. A member of our team will be with you shortly.'],
    duplicate: [`You’re already checked in, ${first}.`, 'No need to check in again — please enjoy the event.'],
  }[r.status];
  $('done-title').innerHTML = copy[0];
  $('done-msg').textContent = copy[1];
  $('form').classList.add('hidden');
  $('done').classList.remove('hidden');
  window.scrollTo(0, 0);
  if (kiosk) setTimeout(reset, 8000);
}

function reset() {
  $('form').reset();
  $('done').classList.add('hidden');
  $('form').classList.remove('hidden');
  window.scrollTo(0, 0);
}
$('again').addEventListener('click', reset);
if (!kiosk) $('again').classList.add('hidden');

init();
