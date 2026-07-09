const sb = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

const VIEW_TITLES = {
  calendari: 'Calendari',
  bateries: 'Bateries',
  equipament: 'Equipament',
  sd: 'Targetes SD',
  projectes: 'Projectes',
  pressupostos: 'Pressupostos'
};

let currentView = 'calendari';
let cache = { equipament: [], bateries: [], sd: [], projectes: [], pressupostos: [] };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Navegació ----------
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelectorAll('nav.bottom button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('header-title').textContent = VIEW_TITLES[view];
  document.getElementById('fab-add').style.display = 'flex';
  loadView(view);
}

document.querySelectorAll('nav.bottom button').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

const chipOnlyFoto = document.getElementById('chip-only-foto');
chipOnlyFoto.addEventListener('click', () => {
  chipOnlyFoto.classList.toggle('active');
  renderCalAgenda();
});

document.getElementById('fab-add').addEventListener('click', () => {
  if (currentView === 'calendari') openEventForm();
  else if (currentView === 'bateries') openBateriaForm();
  else if (currentView === 'equipament') openEquipamentForm();
  else if (currentView === 'sd') openSdForm();
  else if (currentView === 'projectes') openProjecteForm();
  else if (currentView === 'pressupostos') openPressupostForm();
});

// ============ CALENDARI (propi, guardat a Supabase) ============
let calMonth = startOfMonth(new Date());
let calSelectedDay = null;
let calEvents = [];

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function dateKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function formatDayLabel(key) {
  return new Date(key).toLocaleDateString('ca-ES', { day: '2-digit', month: 'short' }).toUpperCase();
}

function changeCalMonth(delta) {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1);
  calSelectedDay = null;
  loadCalEvents();
}

function selectCalDay(key) {
  calSelectedDay = calSelectedDay === key ? null : key;
  renderCalGrid();
  renderCalAgenda();
}

async function loadCalEvents() {
  const start = dateKey(calMonth);
  const end = dateKey(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0));
  const { data, error } = await sb.from('esdeveniments').select('*').gte('dia', start).lte('dia', end).order('dia').order('hora_inici');
  if (error) { console.error(error); return; }
  calEvents = data;
  renderCalGrid();
  renderCalAgenda();
}

function renderCalGrid() {
  const grid = document.getElementById('cal-month-grid');
  document.getElementById('cal-month-label').textContent = calMonth.toLocaleDateString('ca-ES', { month: 'long', year: 'numeric' });

  const fotoDays = new Set(calEvents.filter(e => e.es_fotografia).map(e => e.dia));
  const otherDays = new Set(calEvents.filter(e => !e.es_fotografia).map(e => e.dia));

  const firstWeekday = (calMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
  const todayKey = dateKey(new Date());

  let cells = '';
  for (let i = 0; i < firstWeekday; i++) cells += `<div class="cal-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calMonth.getFullYear()}-${String(calMonth.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = key === todayKey;
    const isSel = key === calSelectedDay;
    cells += `<button class="cal-cell ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''}" onclick="selectCalDay('${key}')">
      <span class="cal-cell-num">${d}</span>
      <span class="cal-cell-dots">${fotoDays.has(key) ? '<i class="dot foto"></i>' : ''}${otherDays.has(key) ? '<i class="dot other"></i>' : ''}</span>
    </button>`;
  }
  grid.innerHTML = `
    <div class="cal-weekdays"><span>DL</span><span>DT</span><span>DC</span><span>DJ</span><span>DV</span><span>DS</span><span>DG</span></div>
    <div class="cal-grid">${cells}</div>
  `;
}

function renderCalAgenda() {
  const container = document.getElementById('cal-events');
  const onlyFoto = chipOnlyFoto.classList.contains('active');
  let list = calEvents;
  if (calSelectedDay) list = list.filter(e => e.dia === calSelectedDay);
  if (onlyFoto) list = list.filter(e => e.es_fotografia);
  document.getElementById('cal-count').textContent = list.length;

  document.getElementById('cal-agenda-heading').textContent = calSelectedDay
    ? new Date(calSelectedDay).toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long' })
    : 'Tot el mes';

  if (!list.length) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">◻</div><p>${onlyFoto ? 'Cap sessió de fotografia.' : 'Cap esdeveniment.'}</p></div>`;
    return;
  }
  container.innerHTML = list.map(e => `
    <div class="event-row">
      <div class="event-date">${formatDayLabel(e.dia)}</div>
      <div style="flex:1;min-width:0" onclick="openEventForm('${e.id}')">
        <p class="event-title">${escapeHtml(e.titol)}</p>
        <p class="event-time">${e.tot_dia ? 'Tot el dia' : (e.hora_inici || '').slice(0, 5)}${e.google_event_id ? ' · sincronitzat' : ''}</p>
      </div>
      <button class="foto-toggle ${e.es_fotografia ? 'on' : ''}" onclick="toggleEventFoto('${e.id}')" title="Marcar com a sessió de fotografia">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="7" width="20" height="13" rx="2"/><circle cx="12" cy="13.5" r="4"/><path d="M8 7l1.5-2.5h5L16 7"/></svg>
      </button>
    </div>
  `).join('');
}

async function toggleEventFoto(id) {
  const ev = calEvents.find(e => e.id === id);
  if (!ev) return;
  ev.es_fotografia = !ev.es_fotografia;
  renderCalGrid();
  renderCalAgenda();
  await sb.from('esdeveniments').update({ es_fotografia: ev.es_fotografia }).eq('id', id);
}

function openEventForm(id) {
  const existing = id ? calEvents.find(e => e.id === id) : null;
  const dia = existing ? existing.dia : (calSelectedDay || dateKey(new Date()));
  openModal(`
    <h2>${existing ? 'Editar esdeveniment' : 'Nou esdeveniment'}</h2>
    <div class="field"><label>Títol</label><input id="ev-titol" value="${existing ? escapeHtml(existing.titol) : ''}" placeholder="Sessió de fotos — Boda"></div>
    <div class="field"><label>Dia</label><input id="ev-dia" type="date" value="${dia}"></div>
    <div class="field">
      <label><input type="checkbox" id="ev-alldia" ${existing?.tot_dia ? 'checked' : ''} style="width:auto;margin-right:6px;vertical-align:middle"> Tot el dia</label>
    </div>
    <div class="field-row" id="ev-hores" style="display:${existing?.tot_dia ? 'none' : 'flex'}">
      <div class="field"><label>Hora inici</label><input id="ev-inici" type="time" value="${existing?.hora_inici ? existing.hora_inici.slice(0, 5) : '10:00'}"></div>
      <div class="field"><label>Hora fi</label><input id="ev-fi" type="time" value="${existing?.hora_fi ? existing.hora_fi.slice(0, 5) : '12:00'}"></div>
    </div>
    <div class="field">
      <label><input type="checkbox" id="ev-foto" ${existing ? (existing.es_fotografia ? 'checked' : '') : 'checked'} style="width:auto;margin-right:6px;vertical-align:middle"> És una sessió de fotografia</label>
    </div>
    <div class="field"><label>Notes</label><textarea id="ev-notes" rows="2">${existing ? escapeHtml(existing.notes || '') : ''}</textarea></div>
    <div class="modal-actions">
      ${existing ? `<button class="btn danger" onclick="deleteEvent('${id}')">Eliminar</button>` : ''}
      <button class="btn primary" onclick="saveEvent('${id || ''}')">Desar</button>
    </div>
    <button class="btn full ghost" style="margin-top:10px" onclick="syncEventToGoogle('${id || ''}')">📤 Sincronitzar amb Google Calendar</button>
  `);
  document.getElementById('ev-alldia').addEventListener('change', (e) => {
    document.getElementById('ev-hores').style.display = e.target.checked ? 'none' : 'flex';
  });
}

async function saveEvent(id) {
  const payload = {
    titol: document.getElementById('ev-titol').value.trim(),
    dia: document.getElementById('ev-dia').value,
    tot_dia: document.getElementById('ev-alldia').checked,
    hora_inici: document.getElementById('ev-alldia').checked ? null : document.getElementById('ev-inici').value,
    hora_fi: document.getElementById('ev-alldia').checked ? null : document.getElementById('ev-fi').value,
    es_fotografia: document.getElementById('ev-foto').checked,
    notes: document.getElementById('ev-notes').value.trim()
  };
  if (!payload.titol || !payload.dia) return;
  if (id) await sb.from('esdeveniments').update(payload).eq('id', id);
  else await sb.from('esdeveniments').insert(payload);
  closeModal();
  loadCalEvents();
}

async function deleteEvent(id) {
  await sb.from('esdeveniments').delete().eq('id', id);
  closeModal();
  loadCalEvents();
}

async function syncEventToGoogle(id) {
  const titol = document.getElementById('ev-titol').value.trim();
  const dateStr = document.getElementById('ev-dia').value;
  const allDay = document.getElementById('ev-alldia').checked;
  const startTime = document.getElementById('ev-inici').value;
  const endTime = document.getElementById('ev-fi').value;
  if (!titol || !dateStr) return;
  const created = await GCal.pushEvent({ title: titol, dateStr, startTime, endTime, allDay });
  if (created && created.id) {
    if (id) await sb.from('esdeveniments').update({ google_event_id: created.id }).eq('id', id);
    alert('Sincronitzat amb Google Calendar');
    loadCalEvents();
  } else {
    alert('No s\'ha pogut sincronitzar. Torna-ho a provar.');
  }
}

function loadView(view) {
  if (view === 'calendari') loadCalEvents();
  else if (view === 'bateries') loadBateries();
  else if (view === 'equipament') loadEquipament();
  else if (view === 'sd') loadSd();
  else if (view === 'projectes') loadProjectes();
  else if (view === 'pressupostos') loadPressupostos();
}

// ---------- Modal helpers ----------
const backdrop = document.getElementById('modal-backdrop');
const modalContent = document.getElementById('modal-content');

function openModal(html) {
  modalContent.innerHTML = html;
  backdrop.classList.add('active');
}
function closeModal() {
  backdrop.classList.remove('active');
  modalContent.innerHTML = '';
}
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });

// ============ BATERIES ============
async function loadBateries() {
  const { data, error } = await sb.from('bateries').select('*, equipament(nom)').order('nom');
  if (error) { console.error(error); return; }
  cache.bateries = data;
  document.getElementById('bat-count').textContent = data.length;
  const list = document.getElementById('bat-list');
  document.getElementById('bat-empty').style.display = data.length ? 'none' : 'block';
  list.innerHTML = data.map(b => `
    <div class="frame ${b.carregada ? '' : 'warn'}">
      <div class="item-row">
        <div class="item-main" onclick="openBateriaForm('${b.id}')">
          <p class="item-name">${escapeHtml(b.nom)}</p>
          <p class="item-meta">${b.equipament ? escapeHtml(b.equipament.nom) : 'Sense equip assignat'}</p>
        </div>
        <div class="ring-toggle ${b.carregada ? 'on' : ''}" onclick="toggleBateria('${b.id}', ${!b.carregada})">
          <span class="ring-label">${b.carregada ? 'OK' : '·'}</span>
        </div>
      </div>
    </div>
  `).join('');
}

async function toggleBateria(id, nouEstat) {
  await sb.from('bateries').update({ carregada: nouEstat, actualitzat_el: new Date().toISOString() }).eq('id', id);
  loadBateries();
}

async function openBateriaForm(id) {
  const existing = id ? cache.bateries.find(b => b.id === id) : null;
  const equipOpts = cache.equipament.length ? cache.equipament : (await sb.from('equipament').select('id,nom')).data || [];
  openModal(`
    <h2>${existing ? 'Editar bateria' : 'Nova bateria'}</h2>
    <div class="field"><label>Nom</label><input id="f-nom" value="${existing ? escapeHtml(existing.nom) : ''}" placeholder="Bateria A — Sony A7III"></div>
    <div class="field">
      <label>Equip assignat</label>
      <select id="f-equip">
        <option value="">— Cap —</option>
        ${equipOpts.map(e => `<option value="${e.id}" ${existing?.equipament_id === e.id ? 'selected' : ''}>${escapeHtml(e.nom)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Notes</label><textarea id="f-notes" rows="2">${existing ? escapeHtml(existing.notes || '') : ''}</textarea></div>
    <div class="modal-actions">
      ${existing ? `<button class="btn danger" onclick="deleteBateria('${id}')">Eliminar</button>` : ''}
      <button class="btn primary" onclick="saveBateria('${id || ''}')">Desar</button>
    </div>
  `);
}

async function saveBateria(id) {
  const payload = {
    nom: document.getElementById('f-nom').value.trim(),
    equipament_id: document.getElementById('f-equip').value || null,
    notes: document.getElementById('f-notes').value.trim()
  };
  if (!payload.nom) return;
  if (id) await sb.from('bateries').update(payload).eq('id', id);
  else await sb.from('bateries').insert({ ...payload, carregada: false });
  closeModal();
  loadBateries();
}

async function deleteBateria(id) {
  await sb.from('bateries').delete().eq('id', id);
  closeModal();
  loadBateries();
}

// ============ EQUIPAMENT ============
const TIPUS_EQUIP = ['camera', 'objectiu', 'microfon', 'estabilitzador', 'altre'];
const TIPUS_LABEL = { camera: 'Càmera', objectiu: 'Objectiu', microfon: 'Micròfon', estabilitzador: 'Estabilitzador', altre: 'Altre' };

async function loadEquipament() {
  const { data, error } = await sb.from('equipament').select('*').order('tipus').order('nom');
  if (error) { console.error(error); return; }
  cache.equipament = data;
  document.getElementById('eq-count').textContent = data.length;
  const list = document.getElementById('eq-list');
  document.getElementById('eq-empty').style.display = data.length ? 'none' : 'block';
  list.innerHTML = data.map(e => `
    <div class="frame ${e.estat === 'preparat' ? '' : 'warn'}" onclick="openEquipamentForm('${e.id}')">
      <div class="item-row">
        <div class="item-main">
          <p class="item-name">${escapeHtml(e.nom)}</p>
          <p class="item-meta">${TIPUS_LABEL[e.tipus] || e.tipus}${e.ubicacio ? ' · ' + escapeHtml(e.ubicacio) : ''}</p>
        </div>
        <span class="pill ${e.estat === 'preparat' ? 'ok' : 'warn'}">${e.estat}</span>
      </div>
    </div>
  `).join('');
}

function openEquipamentForm(id) {
  const existing = id ? cache.equipament.find(e => e.id === id) : null;
  openModal(`
    <h2>${existing ? 'Editar equipament' : 'Nou equipament'}</h2>
    <div class="field"><label>Nom</label><input id="f-nom" value="${existing ? escapeHtml(existing.nom) : ''}" placeholder="Sony A7III"></div>
    <div class="field-row">
      <div class="field">
        <label>Tipus</label>
        <select id="f-tipus">${TIPUS_EQUIP.map(t => `<option value="${t}" ${existing?.tipus === t ? 'selected' : ''}>${TIPUS_LABEL[t]}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>Estat</label>
        <select id="f-estat">
          <option value="preparat" ${existing?.estat === 'preparat' ? 'selected' : ''}>Preparat</option>
          <option value="pendent" ${existing?.estat === 'pendent' ? 'selected' : ''}>Pendent</option>
          <option value="manteniment" ${existing?.estat === 'manteniment' ? 'selected' : ''}>Manteniment</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Ubicació</label><input id="f-ubicacio" value="${existing ? escapeHtml(existing.ubicacio || '') : ''}" placeholder="Motxilla / calaix / maleta"></div>
    <div class="field"><label>Notes</label><textarea id="f-notes" rows="2">${existing ? escapeHtml(existing.notes || '') : ''}</textarea></div>
    <div class="modal-actions">
      ${existing ? `<button class="btn danger" onclick="deleteEquipament('${id}')">Eliminar</button>` : ''}
      <button class="btn primary" onclick="saveEquipament('${id || ''}')">Desar</button>
    </div>
  `);
}

async function saveEquipament(id) {
  const payload = {
    nom: document.getElementById('f-nom').value.trim(),
    tipus: document.getElementById('f-tipus').value,
    estat: document.getElementById('f-estat').value,
    ubicacio: document.getElementById('f-ubicacio').value.trim(),
    notes: document.getElementById('f-notes').value.trim()
  };
  if (!payload.nom) return;
  if (id) await sb.from('equipament').update(payload).eq('id', id);
  else await sb.from('equipament').insert(payload);
  closeModal();
  loadEquipament();
}

async function deleteEquipament(id) {
  await sb.from('equipament').delete().eq('id', id);
  closeModal();
  loadEquipament();
}

// ============ TARGETES SD ============
async function loadSd() {
  const { data, error } = await sb.from('targetes_sd').select('*').order('nom');
  if (error) { console.error(error); return; }
  cache.sd = data;
  document.getElementById('sd-count').textContent = data.length;
  const list = document.getElementById('sd-list');
  document.getElementById('sd-empty').style.display = data.length ? 'none' : 'block';
  list.innerHTML = data.map(s => {
    const pct = s.capacitat_gb > 0 ? Math.min(100, Math.round((s.ocupat_gb / s.capacitat_gb) * 100)) : 0;
    return `
    <div class="frame ${s.buidada ? '' : 'warn'}" onclick="openSdForm('${s.id}')">
      <div class="item-row">
        <div class="item-main">
          <p class="item-name">${escapeHtml(s.nom)}</p>
          <p class="item-meta">${s.ocupat_gb} GB / ${s.capacitat_gb} GB</p>
        </div>
        <span class="pill ${s.buidada ? 'ok' : 'warn'}">${s.buidada ? 'Buidada' : 'Amb material'}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function openSdForm(id) {
  const existing = id ? cache.sd.find(s => s.id === id) : null;
  openModal(`
    <h2>${existing ? 'Editar targeta' : 'Nova targeta SD'}</h2>
    <div class="field"><label>Nom</label><input id="f-nom" value="${existing ? escapeHtml(existing.nom) : ''}" placeholder="SD 1 — 128GB"></div>
    <div class="field-row">
      <div class="field"><label>Capacitat (GB)</label><input id="f-cap" type="number" value="${existing ? existing.capacitat_gb : ''}"></div>
      <div class="field"><label>Ocupat (GB)</label><input id="f-ocup" type="number" value="${existing ? existing.ocupat_gb : 0}"></div>
    </div>
    <div class="field">
      <label>Estat</label>
      <select id="f-buidada">
        <option value="true" ${existing?.buidada !== false ? 'selected' : ''}>Buidada</option>
        <option value="false" ${existing?.buidada === false ? 'selected' : ''}>Amb material</option>
      </select>
    </div>
    <div class="field"><label>Notes</label><textarea id="f-notes" rows="2">${existing ? escapeHtml(existing.notes || '') : ''}</textarea></div>
    <div class="modal-actions">
      ${existing ? `<button class="btn danger" onclick="deleteSd('${id}')">Eliminar</button>` : ''}
      <button class="btn primary" onclick="saveSd('${id || ''}')">Desar</button>
    </div>
  `);
}

async function saveSd(id) {
  const payload = {
    nom: document.getElementById('f-nom').value.trim(),
    capacitat_gb: Number(document.getElementById('f-cap').value) || 0,
    ocupat_gb: Number(document.getElementById('f-ocup').value) || 0,
    buidada: document.getElementById('f-buidada').value === 'true',
    notes: document.getElementById('f-notes').value.trim(),
    actualitzat_el: new Date().toISOString()
  };
  if (!payload.nom) return;
  if (id) await sb.from('targetes_sd').update(payload).eq('id', id);
  else await sb.from('targetes_sd').insert(payload);
  closeModal();
  loadSd();
}

async function deleteSd(id) {
  await sb.from('targetes_sd').delete().eq('id', id);
  closeModal();
  loadSd();
}

// ============ PROJECTES ============
async function loadProjectes() {
  const { data, error } = await sb.from('projectes').select('*').order('data_entrega', { nullsFirst: false });
  if (error) { console.error(error); return; }
  cache.projectes = data;
  document.getElementById('proj-count').textContent = data.length;
  const list = document.getElementById('proj-list');
  document.getElementById('proj-empty').style.display = data.length ? 'none' : 'block';
  const ESTAT_LABEL = { en_curs: 'En curs', edicio: 'Edició', entregat: 'Entregat', cancelat: 'Cancel·lat' };
  list.innerHTML = data.map(p => {
    const pct = p.fotos_totals > 0 ? Math.min(100, Math.round((p.fotos_editades / p.fotos_totals) * 100)) : 0;
    return `
    <div class="frame ${p.estat === 'entregat' ? '' : ''}" onclick="openProjecteForm('${p.id}')">
      <div class="item-row">
        <div class="item-main">
          <p class="item-name">${escapeHtml(p.nom)}</p>
          <p class="item-meta">${p.client ? escapeHtml(p.client) + ' · ' : ''}${p.data_realitzacio ? 'Realitzat ' + formatDate(p.data_realitzacio) + (p.data_entrega ? ' · ' : '') : ''}${p.data_entrega ? 'Entrega ' + formatDate(p.data_entrega) : (!p.data_realitzacio ? 'Sense data' : '')}</p>
        </div>
        <span class="pill ${p.estat === 'entregat' ? 'ok' : 'warn'}">${ESTAT_LABEL[p.estat] || p.estat}</span>
      </div>
      ${p.fotos_totals > 0 ? `<p class="item-meta" style="margin-top:8px">${p.fotos_editades} / ${p.fotos_totals} fotos editades</p><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
    </div>`;
  }).join('');
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('ca-ES', { day: '2-digit', month: 'short' });
}

function openProjecteForm(id) {
  const existing = id ? cache.projectes.find(p => p.id === id) : null;
  openModal(`
    <h2>${existing ? 'Editar projecte' : 'Nou projecte'}</h2>
    <div class="field"><label>Nom</label><input id="f-nom" value="${existing ? escapeHtml(existing.nom) : ''}" placeholder="Boda Marta i Joan"></div>
    <div class="field"><label>Client</label><input id="f-client" value="${existing ? escapeHtml(existing.client || '') : ''}"></div>
    <div class="field-row">
      <div class="field">
        <label>Estat</label>
        <select id="f-estat">
          <option value="en_curs" ${existing?.estat === 'en_curs' ? 'selected' : ''}>En curs</option>
          <option value="edicio" ${existing?.estat === 'edicio' ? 'selected' : ''}>Edició</option>
          <option value="entregat" ${existing?.estat === 'entregat' ? 'selected' : ''}>Entregat</option>
          <option value="cancelat" ${existing?.estat === 'cancelat' ? 'selected' : ''}>Cancel·lat</option>
        </select>
      </div>
      <div class="field"><label>Data d'entrega</label><input id="f-data" type="date" value="${existing?.data_entrega || ''}"></div>
    </div>
    <div class="field">
      <label>Data de realització</label>
      <input id="f-data-realitzacio" type="date" value="${existing?.data_realitzacio || ''}">
      <input type="hidden" id="f-google-event-id" value="${existing?.google_event_id || ''}">
    </div>
    <div class="field" id="foto-events-picker"></div>
    <div class="field-row">
      <div class="field"><label>Fotos totals</label><input id="f-tot" type="number" value="${existing ? existing.fotos_totals : 0}"></div>
      <div class="field"><label>Fotos editades</label><input id="f-edit" type="number" value="${existing ? existing.fotos_editades : 0}"></div>
    </div>
    <div class="field"><label>Notes</label><textarea id="f-notes" rows="2">${existing ? escapeHtml(existing.notes || '') : ''}</textarea></div>
    <div class="modal-actions">
      ${existing ? `<button class="btn danger" onclick="deleteProjecte('${id}')">Eliminar</button>` : ''}
      <button class="btn primary" onclick="saveProjecte('${id || ''}')">Desar</button>
    </div>
  `);
  const fotoEvents = calEvents.filter(e => e.es_fotografia);
  const picker = document.getElementById('foto-events-picker');
  if (fotoEvents.length) {
    picker.innerHTML = `
      <label>O tria un esdeveniment de fotografia del calendari (mes obert)</label>
      <select id="f-event-select">
        <option value="">— Data manual —</option>
        ${fotoEvents.map(ev => `<option value="${ev.id}|${ev.dia}" ${existing?.google_event_id === ev.id ? 'selected' : ''}>${formatDayLabel(ev.dia)} — ${escapeHtml(ev.titol)}</option>`).join('')}
      </select>
    `;
    document.getElementById('f-event-select').addEventListener('change', (e) => {
      if (!e.target.value) return;
      const [evId, evDate] = e.target.value.split('|');
      document.getElementById('f-data-realitzacio').value = evDate;
      document.getElementById('f-google-event-id').value = evId;
    });
  } else {
    picker.innerHTML = `<p class="item-meta">Cap esdeveniment marcat com a fotografia al mes obert del Calendari.</p>`;
  }
}

async function saveProjecte(id) {
  const payload = {
    nom: document.getElementById('f-nom').value.trim(),
    client: document.getElementById('f-client').value.trim(),
    estat: document.getElementById('f-estat').value,
    data_entrega: document.getElementById('f-data').value || null,
    data_realitzacio: document.getElementById('f-data-realitzacio').value || null,
    google_event_id: document.getElementById('f-google-event-id').value || null,
    fotos_totals: Number(document.getElementById('f-tot').value) || 0,
    fotos_editades: Number(document.getElementById('f-edit').value) || 0,
    notes: document.getElementById('f-notes').value.trim()
  };
  if (!payload.nom) return;
  if (id) await sb.from('projectes').update(payload).eq('id', id);
  else await sb.from('projectes').insert(payload);
  closeModal();
  loadProjectes();
}

async function deleteProjecte(id) {
  await sb.from('projectes').delete().eq('id', id);
  closeModal();
  loadProjectes();
}

// ============ PRESSUPOSTOS ============
async function loadPressupostos() {
  const { data, error } = await sb.from('pressupostos').select('*, pressupost_linies(*)').order('creat_el', { ascending: false });
  if (error) { console.error(error); return; }
  cache.pressupostos = data;
  document.getElementById('pres-count').textContent = data.length;
  const list = document.getElementById('pres-list');
  document.getElementById('pres-empty').style.display = data.length ? 'none' : 'block';
  list.innerHTML = data.map(p => {
    const total = (p.pressupost_linies || []).reduce((s, l) => s + l.quantitat * l.preu_unitat, 0);
    return `
    <div class="frame" onclick="openPressupostForm('${p.id}')">
      <div class="item-row">
        <div class="item-main">
          <p class="item-name">${escapeHtml(p.nom)}</p>
          <p class="item-meta">${p.client ? escapeHtml(p.client) + ' · ' : ''}${formatDate(p.data)}</p>
        </div>
        <span class="pill">${total.toFixed(2)} €</span>
      </div>
    </div>`;
  }).join('');
}

let currentLinies = [];

async function openPressupostForm(id) {
  const existing = id ? cache.pressupostos.find(p => p.id === id) : null;
  currentLinies = existing ? existing.pressupost_linies.slice().sort((a, b) => a.ordre - b.ordre) : [];
  if (!currentLinies.length) currentLinies.push({ concepte: '', quantitat: 1, preu_unitat: 0 });
  const projOpts = cache.projectes.length ? cache.projectes : (await sb.from('projectes').select('id,nom')).data || [];

  openModal(`
    <h2>${existing ? 'Editar pressupost' : 'Nou pressupost'}</h2>
    <div class="field"><label>Nom</label><input id="f-nom" value="${existing ? escapeHtml(existing.nom) : ''}" placeholder="Pressupost — Sessió retrats"></div>
    <div class="field"><label>Client</label><input id="f-client" value="${existing ? escapeHtml(existing.client || '') : ''}"></div>
    <div class="field">
      <label>Projecte vinculat</label>
      <select id="f-projecte">
        <option value="">— Cap —</option>
        ${projOpts.map(p => `<option value="${p.id}" ${existing?.projecte_id === p.id ? 'selected' : ''}>${escapeHtml(p.nom)}</option>`).join('')}
      </select>
    </div>
    <div class="section-title" style="margin-top:18px">Línies</div>
    <div id="linies-container"></div>
    <button class="btn small" onclick="addLinia()">+ Afegir línia</button>
    <div class="budget-total"><span class="label">Total</span><span class="value" id="pres-total">0,00 €</span></div>
    <div class="modal-actions">
      ${existing ? `<button class="btn danger" onclick="deletePressupost('${id}')">Eliminar</button>` : ''}
      <button class="btn primary" onclick="savePressupost('${id || ''}')">Desar</button>
    </div>
    <button class="btn full ghost" style="margin-top:10px" onclick="copiarResumPressupost()">Copiar resum per compartir</button>
  `);
  renderLinies();
}

function renderLinies() {
  const c = document.getElementById('linies-container');
  c.innerHTML = currentLinies.map((l, i) => `
    <div class="budget-line">
      <input placeholder="Concepte" value="${escapeHtml(l.concepte)}" oninput="currentLinies[${i}].concepte = this.value">
      <input type="number" placeholder="Qtat" value="${l.quantitat}" oninput="currentLinies[${i}].quantitat = Number(this.value) || 0; updateTotal()">
      <input type="number" placeholder="Preu" value="${l.preu_unitat}" oninput="currentLinies[${i}].preu_unitat = Number(this.value) || 0; updateTotal()">
      <button class="link-btn" onclick="removeLinia(${i})">×</button>
    </div>
  `).join('');
  updateTotal();
}

function addLinia() {
  currentLinies.push({ concepte: '', quantitat: 1, preu_unitat: 0 });
  renderLinies();
}
function removeLinia(i) {
  currentLinies.splice(i, 1);
  renderLinies();
}
function updateTotal() {
  const total = currentLinies.reduce((s, l) => s + (l.quantitat * l.preu_unitat), 0);
  document.getElementById('pres-total').textContent = total.toFixed(2).replace('.', ',') + ' €';
}

async function savePressupost(id) {
  const payload = {
    nom: document.getElementById('f-nom').value.trim(),
    client: document.getElementById('f-client').value.trim(),
    projecte_id: document.getElementById('f-projecte').value || null
  };
  if (!payload.nom) return;
  let presId = id;
  if (id) {
    await sb.from('pressupostos').update(payload).eq('id', id);
    await sb.from('pressupost_linies').delete().eq('pressupost_id', id);
  } else {
    const { data, error } = await sb.from('pressupostos').insert(payload).select().single();
    if (error) { console.error(error); return; }
    presId = data.id;
  }
  const linies = currentLinies.filter(l => l.concepte.trim()).map((l, i) => ({
    pressupost_id: presId, concepte: l.concepte.trim(), quantitat: l.quantitat, preu_unitat: l.preu_unitat, ordre: i
  }));
  if (linies.length) await sb.from('pressupost_linies').insert(linies);
  closeModal();
  loadPressupostos();
}

async function deletePressupost(id) {
  await sb.from('pressupostos').delete().eq('id', id);
  closeModal();
  loadPressupostos();
}

function copiarResumPressupost() {
  const nom = document.getElementById('f-nom').value.trim();
  const total = currentLinies.reduce((s, l) => s + (l.quantitat * l.preu_unitat), 0);
  let text = `*${nom}*\n\n`;
  currentLinies.filter(l => l.concepte.trim()).forEach(l => {
    text += `${l.concepte} — ${l.quantitat} x ${l.preu_unitat}€ = ${(l.quantitat * l.preu_unitat).toFixed(2)}€\n`;
  });
  text += `\n*Total: ${total.toFixed(2)}€*`;
  navigator.clipboard.writeText(text).then(() => alert('Resum copiat al porta-retalls'));
}

// ---------- Init ----------
window.addEventListener('load', () => {
  GCal.init();
  switchView('calendari');
});
