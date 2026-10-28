const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLE = { Frontend: ['bi-window', '#6366f1'], Backend: ['bi-hdd-network', '#0ea5e9'], 'Full Stack': ['bi-layers', '#8b5cf6'], Designer: ['bi-palette', '#ec4899'], 'Data/AI': ['bi-cpu', '#10b981'], Other: ['bi-stars', '#f59e0b'] };
const av = (n, s = 36) => `<img class="av" width="${s}" height="${s}" title="${esc(n)}" alt="${esc(n)}" src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(n)}">`;
const roleBadge = r => `<span class="badge" style="background:${(ROLE[r] || ROLE.Other)[1]}"><i class="bi ${(ROLE[r] || ROLE.Other)[0]}"></i> ${esc(r)}</span>`;
const ring = s => `<div class="ring" style="--p:${s};--c:${s >= 70 ? '#22c55e' : s >= 45 ? '#f59e0b' : '#ef4444'}" title="Team balance score"><span>${s}</span></div>`;
const joinModal = new bootstrap.Modal('#joinModal');
let joinTeamId = null, joinAction = 'join', teamsCache = [];

function toast(msg, type = 'success') {
  const d = document.createElement('div');
  d.className = `alert alert-${type} shadow fade show`; d.textContent = msg;
  $('#alertBox').append(d); setTimeout(() => d.remove(), 4000);
}
const party = () => typeof confetti === 'function' && confetti({ particleCount: 140, spread: 80, origin: { y: .6 } });

async function api(url, method = 'GET', data) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw json.errors || [{ msg: 'Something went wrong' }];
  return json;
}

function handleForm(form, onSubmit, keep) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('.server-error').forEach(x => x.remove());
    form.querySelectorAll('.is-invalid').forEach(x => x.classList.remove('is-invalid'));
    if (!form.checkValidity()) { form.classList.add('was-validated'); return; }
    const data = {};
    for (const [k, v] of new FormData(form).entries()) data[k] = k in data ? [].concat(data[k], v) : v;
    try { await onSubmit(data, e); if (!keep) { form.reset(); form.classList.remove('was-validated'); } }
    catch (errs) {
      (Array.isArray(errs) ? errs : [{ msg: 'Network error' }]).forEach(er => {
        const input = er.field && form.elements[er.field];
        if (input) { input.classList.add('is-invalid'); const d = document.createElement('div'); d.className = 'invalid-feedback d-block server-error'; d.textContent = er.msg; input.after(d); }
        else toast(er.msg, 'danger');
      });
    }
  });
}

function countUp(el, to) {
  const from = +el.textContent || 0, t0 = performance.now();
  (function step(t) { const p = Math.min((t - t0) / 900, 1); el.textContent = Math.round(from + (to - from) * p); if (p < 1) requestAnimationFrame(step); })(t0);
}
async function loadStats() {
  const s = await api('/api/stats').catch(() => null); if (!s) return;
  document.querySelectorAll('[data-key]').forEach(el => countUp(el, s[el.dataset.key]));
  const max = Math.max(1, ...Object.values(s.roles));
  $('#roleBars').innerHTML = Object.keys(ROLE).map(r => `<div class="d-flex align-items-center gap-2 mb-2"><div style="width:110px" class="small">${roleBadge(r)}</div>
    <div class="role-bar flex-grow-1"><div style="width:${(s.roles[r] || 0) / max * 100}%;background:${ROLE[r][1]}"></div></div><b class="small" style="width:24px">${s.roles[r] || 0}</b></div>`).join('');
}

function teamCard(t, extra = '', i = 0) {
  const full = t.members.length >= t.maxSize, b = t.balance || { score: 0, missing: [] };
  return `<div class="col-md-6 col-lg-4"><div class="card team-card h-100" style="animation-delay:${i * 60}ms"><div class="card-body d-flex flex-column">
    <div class="d-flex justify-content-between align-items-start mb-2"><div><h5 class="mb-0">${esc(t.name)}</h5><small class="text-muted"><i class="bi bi-trophy"></i> ${esc(t.hackathon)}</small></div>${ring(b.score)}</div>
    <p class="small">${esc(t.description)}</p>
    <div class="mb-2">${(t.techStack || []).map(s => `<span class="badge badge-skill me-1">${esc(s)}</span>`).join('')}</div>
    ${(t.lookingFor || []).length ? `<div class="small mb-2"><i class="bi bi-search text-primary"></i> Looking for: ${t.lookingFor.map(roleBadge).join(' ')}</div>` : ''}
    ${b.missing.length && !full ? `<div class="small text-warning mb-2"><i class="bi bi-exclamation-triangle"></i> Balance tip: add ${b.missing.map(esc).join(' / ')}</div>` : ''}
    ${extra}
    <div class="mt-auto pt-2"><div class="d-flex align-items-center justify-content-between mb-2"><div class="av-stack d-flex">${t.members.map(m => av(m.name)).join('')}</div>
      <span class="badge ${full ? 'bg-danger' : 'bg-success'}">${t.members.length}/${t.maxSize}</span></div>
      <div class="d-flex gap-2"><button class="btn btn-grad btn-sm flex-fill" ${full ? 'disabled' : ''} data-act="join" data-id="${t._id}" data-name="${esc(t.name)}">${full ? 'Team Full' : 'Join'}</button>
      <button class="btn btn-outline-secondary btn-sm" data-act="leave" data-id="${t._id}" data-name="${esc(t.name)}">Leave</button></div></div>
  </div></div></div>`;
}

function renderTeams() {
  const sort = $('#teamSort').value, list = [...teamsCache];
  if (sort === 'bal') list.sort((a, b) => b.balance.score - a.balance.score);
  if (sort === 'spots') list.sort((a, b) => (b.maxSize - b.members.length) - (a.maxSize - a.members.length));
  $('#teamList').innerHTML = list.length ? list.map((t, i) => teamCard(t, '', i)).join('') : '<p class="text-center text-muted py-5"><i class="bi bi-emoji-smile fs-1 d-block"></i>No teams yet. Create the first one!</p>';
}
async function loadTeams() { teamsCache = await api('/api/teams?search=' + encodeURIComponent($('#teamSearch').value)).catch(() => []); renderTeams(); }

async function loadPeople() {
  const people = await api('/api/participants?skill=' + encodeURIComponent($('#skillSearch').value)).catch(() => []);
  $('#peopleList').innerHTML = people.length ? people.map((p, i) => `<div class="col-md-6 col-lg-4"><div class="card person-card h-100" style="animation-delay:${i * 50}ms"><div class="card-body text-center">
    ${av(p.name, 84)}<h5 class="mt-2 mb-1">${esc(p.name)}</h5>${roleBadge(p.role)} <span class="badge bg-secondary">${esc(p.experience)}</span>
    <p class="small text-muted my-2">${esc(p.bio)}</p>${p.skills.map(s => `<span class="badge badge-skill me-1">${esc(s)}</span>`).join('')}</div></div></div>`).join('')
    : '<p class="text-center text-muted py-5">No participants yet.</p>';
}
const refresh = () => { loadTeams(); loadPeople(); loadStats(); };

function openModal(act, id, name, email = '') {
  joinAction = act; joinTeamId = id;
  $('#joinMode').textContent = act === 'join' ? 'Join' : 'Leave'; $('#joinTeamName').textContent = name;
  $('#joinForm').elements.email.value = email; joinModal.show();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (b) openModal(b.dataset.act, b.dataset.id, b.dataset.name, b.dataset.email);
  const g = e.target.closest('[data-go]'); if (g) document.querySelector(`[data-bs-target="${g.dataset.go}"]`).click();
});

handleForm($('#registerForm'), async d => { await api('/api/participants', 'POST', d); toast('Registration successful!'); party(); refresh(); });
handleForm($('#teamForm'), async d => { await api('/api/teams', 'POST', d); toast('Team created!'); party(); refresh(); document.querySelector('[data-bs-target="#teamsTab"]').click(); });
handleForm($('#joinForm'), async d => {
  const r = await api(`/api/teams/${joinTeamId}/${joinAction}`, 'POST', d);
  joinModal.hide(); toast(r.message); if (joinAction === 'join') party(); refresh();
});
handleForm($('#matchForm'), async d => {
  const res = await api('/api/match?email=' + encodeURIComponent(d.email));
  $('#matchList').innerHTML = res.length ? res.map((r, i) => teamCard(r.team, `<div class="mb-2"><div class="d-flex justify-content-between"><b>Match</b><span class="match-pct">${r.match}%</span></div>
    <div class="progress mb-2" style="height:8px"><div class="progress-bar bg-success" style="width:${r.match}%"></div></div>
    <ul class="small ps-3 mb-0">${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`, i)).join('')
    : '<p class="text-center text-muted">No open teams to match right now. Try the Auto Builder!</p>';
}, true);

let autoSave = false;
$('#autoForm').addEventListener('click', e => { const b = e.target.closest('button[data-save]'); if (b) autoSave = b.dataset.save === 'true'; });
handleForm($('#autoForm'), async d => {
  const r = await api('/api/auto-teams', 'POST', { ...d, save: autoSave });
  $('#autoResult').innerHTML = r.teams.map((t, i) => `<div class="col-md-6 col-lg-4"><div class="card team-card h-100" style="animation-delay:${i * 80}ms"><div class="card-body">
    <div class="d-flex justify-content-between"><h5>${esc(t.name)}</h5>${ring(t.balance.score)}</div>
    ${t.members.map(m => `<div class="d-flex align-items-center gap-2 mb-2">${av(m.name)}<div class="small"><b>${esc(m.name)}</b><br>${roleBadge(m.role)} <span class="text-muted">${esc(m.experience)}</span></div></div>`).join('')}</div></div></div>`).join('');
  if (r.saved) { toast(`${r.teams.length} balanced teams created!`); party(); refresh(); } else toast('Preview ready. Press "Build & Save" to create them.', 'info');
}, true);

$('#roleChecks').innerHTML = Object.keys(ROLE).map(r => `<div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" name="lookingFor" value="${r}" id="lf-${r}"><label class="form-check-label" for="lf-${r}">${r}</label></div>`).join('');
$('#registerForm').elements.name.addEventListener('input', e => $('#regAvatar').src = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(e.target.value || 'you'));
$('#themeBtn').addEventListener('click', () => { const h = document.documentElement; h.dataset.bsTheme = h.dataset.bsTheme === 'dark' ? 'light' : 'dark'; });
let timer; const debounce = fn => () => { clearTimeout(timer); timer = setTimeout(fn, 300); };
$('#teamSearch').addEventListener('input', debounce(loadTeams)); $('#teamSort').addEventListener('change', renderTeams);
$('#skillSearch').addEventListener('input', debounce(loadPeople));
refresh();
