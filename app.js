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
  const { data, error } = await sb.from('esdeveniments').select('*, projectes(nom)').gte('dia', start).lte('dia', end).order('dia').order('hora_inici');
  if (error) { console.error(error); return; }
  calEvents = data;
  renderCalGrid();
  renderCalAgenda();
  loadTodayTomorrow();
  loadAlerts();
}

async function loadTodayTomorrow() {
  const today = dateKey(new Date());
  const tomorrow = dateKey(new Date(Date.now() + 24 * 3600 * 1000));
  const { data, error } = await sb.from('esdeveniments').select('*').in('dia', [today, tomorrow]).order('hora_inici');
  const container = document.getElementById('cal-today-tomorrow');
  if (error || !container) return;
  const avui = (data || []).filter(e => e.dia === today);
  const dema = (data || []).filter(e => e.dia === tomorrow);
  const renderCard = (label, events) => `
    <div class="tt-card">
      <p class="tt-label">${label}</p>
      ${events.length ? events.map(e => `<p class="tt-event">${e.es_fotografia ? '📷 ' : ''}${escapeHtml(e.titol)}${e.tot_dia ? '' : ' · ' + (e.hora_inici || '').slice(0, 5)}</p>`).join('') : '<p class="tt-empty">Res previst</p>'}
    </div>`;
  container.innerHTML = `<div class="today-tomorrow">${renderCard('Avui', avui)}${renderCard('Demà', dema)}</div>`;
}

async function loadAlerts() {
  const container = document.getElementById('cal-alerts');
  if (!container) return;
  const alerts = [];

  const today = dateKey(new Date());
  const tomorrow = dateKey(new Date(Date.now() + 24 * 3600 * 1000));
  const properaFoto = calEvents.find(e => e.es_fotografia && (e.dia === today || e.dia === tomorrow));
  if (properaFoto) {
    const [{ data: bateries }, { data: sds }] = await Promise.all([
      sb.from('bateries').select('carregada'),
      sb.from('targetes_sd').select('buidada')
    ]);
    const capCarregada = bateries && bateries.length && !bateries.some(b => b.carregada);
    const capBuidada = sds && sds.length && !sds.some(s => s.buidada);
    if (capCarregada) alerts.push(`Tens "${properaFoto.titol}" ${properaFoto.dia === today ? 'avui' : 'demà'} i cap bateria marcada com a carregada.`);
    if (capBuidada) alerts.push(`Tens "${properaFoto.titol}" ${properaFoto.dia === today ? 'avui' : 'demà'} i cap targeta SD buidada.`);
  }

  const { data: projectes } = await sb.from('projectes').select('nom, data_entrega, fotos_totals, fotos_editades').eq('estat', 'edicio');
  (projectes || []).forEach(p => {
    if (!p.data_entrega) return;
    const dies = Math.ceil((new Date(p.data_entrega) - new Date(today)) / 86400000);
    const pct = p.fotos_totals > 0 ? Math.round((p.fotos_editades / p.fotos_totals) * 100) : 100;
    if (dies >= 0 && dies <= 3 && pct < 100) {
      alerts.push(`"${p.nom}" s'entrega ${dies === 0 ? 'avui' : `en ${dies} dia(s)`} i només portes el ${pct}% editat.`);
    }
  });

  container.innerHTML = alerts.map(a => `<div class="alert-card"><span class="alert-icon">!</span><span>${escapeHtml(a)}</span></div>`).join('');
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
        <p class="event-time">${e.tot_dia ? 'Tot el dia' : (e.hora_inici || '').slice(0, 5)}${e.projectes ? ' · ' + escapeHtml(e.projectes.nom) : ''}${e.google_event_id ? ' · sincronitzat' : ''}</p>
        ${e.notes ? `<p class="item-meta" style="margin-top:2px">${escapeHtml(e.notes)}</p>` : ''}
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

async function importFromGoogle() {
  const start = dateKey(new Date());
  const end = dateKey(new Date(Date.now() + 90 * 24 * 3600 * 1000));
  const startISO = new Date(start + 'T00:00:00').toISOString();
  const endISO = new Date(end + 'T23:59:59').toISOString();

  openModal(`<h2>Important…</h2><p class="item-meta">Consultant el teu Google Calendar (des d'avui, propers 90 dies)…</p>`);
  const trobats = await GCal.pullEvents({ startISO, endISO });

  if (!trobats.length) {
    openModal(`<h2>Importar de Google</h2><p class="item-meta">No s'ha trobat cap esdeveniment a partir d'avui al teu Google Calendar (o no s'ha pogut connectar).</p><div class="modal-actions"><button class="btn full" onclick="closeModal()">Tancar</button></div>`);
    return;
  }

  const { data: totsImportats } = await sb.from('esdeveniments').select('google_event_id').not('google_event_id', 'is', null);
  const yaImportatsIds = new Set((totsImportats || []).map(e => e.google_event_id));
  const nous = trobats.filter(ev => !yaImportatsIds.has(ev.googleId));

  if (!nous.length) {
    openModal(`<h2>Importar de Google</h2><p class="item-meta">Tots els esdeveniments propers ja estan importats.</p><div class="modal-actions"><button class="btn full" onclick="closeModal()">Tancar</button></div>`);
    return;
  }

  const projOpts = cache.projectes.length ? cache.projectes : (await sb.from('projectes').select('id,nom')).data || [];
  window.__importCandidats = nous;
  window.__importProjOpts = projOpts;
  renderImportList(nous, projOpts);
}

function getFotografiaColorId() {
  let id = localStorage.getItem('fotografia_colorId');
  if (!id) {
    // Per defecte fem servir "Sage" (verd), el color d'esdeveniment de Google més semblant
    // al verd que ja fas servir a "Fotografia" al Calendar. Es desa perquè no calgui triar-ho mai més.
    id = '2';
    localStorage.setItem('fotografia_colorId', id);
  }
  return id;
}

async function renderImportList(nous, projOpts) {
  const fotoColorId = getFotografiaColorId();
  openModal(`
    <h2>Tria quins són de fotografia</h2>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <p class="item-meta" style="margin:0">${nous.length} esdeveniment(s) des d'avui. Els verds ja venen marcats sols.</p>
      <button class="btn ghost small" onclick="configurarColorFotografia()">⚙ Color</button>
    </div>
    <div id="import-list">
      ${nous.map((ev, i) => `
        <div class="event-row" style="flex-wrap:wrap">
          <div class="event-date">${formatDayLabel(ev.dia)}</div>
          <div style="flex:1;min-width:0;display:flex;align-items:center;gap:6px">
            ${ev.colorHex ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ev.colorHex};flex-shrink:0"></span>` : ''}
            <div>
              <p class="event-title">${escapeHtml(ev.title)}</p>
              <p class="event-time">${ev.totDia ? 'Tot el dia' : (ev.horaInici || '')}</p>
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-dim)">
            <input type="checkbox" class="import-foto" data-i="${i}" ${fotoColorId && ev.colorId === fotoColorId ? 'checked' : ''} style="width:auto"> foto
          </label>
          <select class="import-projecte" data-i="${i}" style="width:100%;margin-top:6px;font-size:12px;padding:6px">
            <option value="">— Sense projecte —</option>
            ${projOpts.map(p => `<option value="${p.id}">${escapeHtml(p.nom)}</option>`).join('')}
          </select>
        </div>
      `).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn primary full" onclick="confirmarImportacio()">Importar tots (${nous.length})</button>
    </div>
  `);
}

async function configurarColorFotografia() {
  const swatches = await GCal.getColorSwatches();
  const current = getFotografiaColorId();
  openModal(`
    <h2>Color de "Fotografia"</h2>
    <p class="item-meta" style="margin-bottom:10px">Tria el color que fas servir a Google Calendar per les sessions de fotografia.</p>
    <div class="color-picker-grid">
      ${swatches.map(s => `<button class="color-swatch ${s.id === current ? 'selected' : ''}" onclick="localStorage.setItem('fotografia_colorId','${s.id}'); renderImportList(window.__importCandidats, window.__importProjOpts)" style="background:${s.hex}"></button>`).join('')}
    </div>
    <div class="modal-actions"><button class="btn full ghost" onclick="renderImportList(window.__importCandidats, window.__importProjOpts)">Tornar</button></div>
  `);
}

async function confirmarImportacio() {
  const candidats = window.__importCandidats || [];
  const fotoSet = new Set([...document.querySelectorAll('.import-foto:checked')].map(el => Number(el.dataset.i)));
  const projecteMap = {};
  document.querySelectorAll('.import-projecte').forEach(el => {
    if (el.value) projecteMap[Number(el.dataset.i)] = el.value;
  });
  const registres = candidats.map((ev, i) => ({
    titol: ev.title,
    dia: ev.dia,
    tot_dia: ev.totDia,
    hora_inici: ev.totDia ? null : ev.horaInici,
    hora_fi: ev.totDia ? null : ev.horaFi,
    es_fotografia: fotoSet.has(i),
    google_event_id: ev.googleId,
    projecte_id: projecteMap[i] || null
  }));
  if (registres.length) await sb.from('esdeveniments').insert(registres);
  closeModal();
  loadCalEvents();
  loadProjectes();
}

async function syncAllToGoogle() {
  if (!calEvents.length) {
    alert('Aquest mes no hi ha cap esdeveniment creat encara.');
    return;
  }
  const pendents = calEvents.filter(e => !e.google_event_id);
  if (!pendents.length) {
    alert('Tots els esdeveniments d\'aquest mes ja estan sincronitzats.');
    return;
  }
  const ok = confirm(`Sincronitzar ${pendents.length} esdeveniment(s) amb Google Calendar?`);
  if (!ok) return;
  let fets = 0;
  let errors = 0;
  for (const ev of pendents) {
    try {
      const created = await GCal.pushEvent({
        title: ev.titol,
        dateStr: ev.dia,
        startTime: ev.hora_inici ? ev.hora_inici.slice(0, 5) : null,
        endTime: ev.hora_fi ? ev.hora_fi.slice(0, 5) : null,
        allDay: ev.tot_dia
      });
      if (created && created.id) {
        await sb.from('esdeveniments').update({ google_event_id: created.id }).eq('id', ev.id);
        fets++;
      } else {
        console.error('Error sincronitzant', ev.titol, created);
        errors++;
      }
    } catch (e) {
      console.error('Error sincronitzant', ev.titol, e);
      errors++;
    }
  }
  alert(`Sincronitzats ${fets} de ${pendents.length} esdeveniments.${errors ? ` (${errors} amb error, mira la consola)` : ''}`);
  loadCalEvents();
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
          <p class="item-meta">${TIPUS_LABEL[e.tipus] || e.tipus}${e.ubicacio ? ' · ' + escapeHtml(e.ubicacio) : ''}${e.ultima_revisio ? ' · revisat ' + formatDate(e.ultima_revisio) : ' · sense revisar'}</p>
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
    <div class="field"><label>Última revisió</label><input id="f-revisio" type="date" value="${existing?.ultima_revisio || ''}"></div>
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
    ultima_revisio: document.getElementById('f-revisio').value || null,
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
let projFiltre = 'tots';
const ESTAT_LABEL = { en_curs: 'En curs', edicio: 'Edició', entregat: 'Entregat', cancelat: 'Cancel·lat' };

function setProjFiltre(estat) {
  projFiltre = estat;
  renderProjectes();
}

async function loadProjectes() {
  const { data, error } = await sb.from('projectes').select('*, esdeveniments(id, dia, titol)').order('data_entrega', { nullsFirst: false });
  if (error) { console.error(error); return; }
  cache.projectes = data;
  renderProjectChips();
  renderProjectes();
}

function renderProjectChips() {
  const chips = document.getElementById('proj-status-chips');
  const opcions = [['tots', 'Tots'], ['en_curs', 'En curs'], ['edicio', 'Edició'], ['entregat', 'Entregat'], ['cancelat', 'Cancel·lat']];
  chips.innerHTML = opcions.map(([val, label]) => `<button class="chip ${projFiltre === val ? 'active' : ''}" onclick="setProjFiltre('${val}')">${label}</button>`).join('');
}

function renderProjectes() {
  const data = projFiltre === 'tots' ? cache.projectes : cache.projectes.filter(p => p.estat === projFiltre);
  document.getElementById('proj-count').textContent = data.length;
  const list = document.getElementById('proj-list');
  document.getElementById('proj-empty').style.display = data.length ? 'none' : 'block';
  list.innerHTML = data.map(p => {
    const pct = p.fotos_totals > 0 ? Math.min(100, Math.round((p.fotos_editades / p.fotos_totals) * 100)) : 0;
    const sessions = (p.esdeveniments || []).slice().sort((a, b) => a.dia.localeCompare(b.dia));
    const sessionsLabel = sessions.length
      ? `${sessions.length} sessi${sessions.length > 1 ? 'ons' : 'ó'} · propera ${formatDate(sessions[0].dia)}`
      : '';
    return `
    <div class="frame" onclick="openProjecteForm('${p.id}')">
      <div class="item-row">
        <div class="item-main">
          <p class="item-name">${escapeHtml(p.nom)}</p>
          <p class="item-meta">${p.client ? escapeHtml(p.client) + ' · ' : ''}${sessionsLabel || (p.data_entrega ? 'Entrega ' + formatDate(p.data_entrega) : 'Sense data')}</p>
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
  window.__currentProjecteId = id || null;
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
      <div class="field">
        <label>Data d'entrega</label>
        <input id="f-data" type="date" value="${existing?.data_entrega || ''}">
      </div>
    </div>
    <div class="section-title" style="margin-top:18px">Sessions vinculades</div>
    <div id="sessions-vinculades"></div>
    <div class="field" id="sessions-disponibles"></div>
    <div class="section-title" style="margin-top:18px">Equipament per a aquest projecte</div>
    <div class="field" id="equip-checklist"></div>
    <div class="field-row">
      <div class="field"><label>Fotos totals</label><input id="f-tot" type="number" value="${existing ? existing.fotos_totals : 0}"></div>
      <div class="field"><label>Fotos editades</label><input id="f-edit" type="number" value="${existing ? existing.fotos_editades : 0}"></div>
    </div>
    <div class="field"><label>Notes</label><textarea id="f-notes" rows="2">${existing ? escapeHtml(existing.notes || '') : ''}</textarea></div>
    <div class="modal-actions">
      ${existing ? `<button class="btn danger" onclick="deleteProjecte('${id}')">Eliminar</button>` : ''}
      <button class="btn primary" onclick="saveProjecte('${id || ''}')">Desar</button>
    </div>
    ${existing ? `
    <div class="modal-actions" style="margin-top:8px">
      <button class="btn full ghost" onclick="duplicarProjecte('${id}')">⎘ Duplicar projecte</button>
      <button class="btn full ghost" onclick="compartirProjecte('${id}')">🔗 Compartir</button>
    </div>` : ''}
  `);
  renderSessionsPickers(existing);
  renderEquipChecklist(existing);
}

async function renderEquipChecklist(existing) {
  const equipament = cache.equipament.length ? cache.equipament : (await sb.from('equipament').select('*').order('nom')).data || [];
  let vinculats = new Set();
  if (existing) {
    const { data } = await sb.from('projecte_equipament').select('equipament_id').eq('projecte_id', existing.id);
    vinculats = new Set((data || []).map(r => r.equipament_id));
  }
  const cont = document.getElementById('equip-checklist');
  if (!equipament.length) {
    cont.innerHTML = `<p class="item-meta">Encara no tens equipament registrat.</p>`;
    return;
  }
  cont.innerHTML = equipament.map(e => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0">
      <input type="checkbox" class="equip-check" value="${e.id}" ${vinculats.has(e.id) ? 'checked' : ''} style="width:auto">
      <span style="font-size:14px">${escapeHtml(e.nom)}</span>
    </label>
  `).join('');
}

async function renderSessionsPickers(existing) {
  const vinculades = existing ? (existing.esdeveniments || []).slice().sort((a, b) => a.dia.localeCompare(b.dia)) : [];
  const vincContainer = document.getElementById('sessions-vinculades');
  vincContainer.innerHTML = vinculades.length
    ? vinculades.map(ev => `
        <div class="event-row">
          <div class="event-date">${formatDayLabel(ev.dia)}</div>
          <div style="flex:1"><p class="event-title">${escapeHtml(ev.titol)}</p></div>
          <button class="link-btn" onclick="desvincularSessio('${ev.id}')" title="Desvincular">×</button>
        </div>`).join('')
    : `<p class="item-meta" style="margin-bottom:10px">Encara cap sessió vinculada.</p>`;

  const disp = document.getElementById('sessions-disponibles');
  disp.innerHTML = `<p class="item-meta">Carregant sessions disponibles…</p>`;
  const { data: disponibles, error } = await sb.from('esdeveniments')
    .select('id, dia, titol')
    .eq('es_fotografia', true)
    .is('projecte_id', null)
    .order('dia', { ascending: false })
    .limit(50);
  if (error) { disp.innerHTML = `<p class="item-meta">Error carregant sessions.</p>`; return; }
  if (disponibles.length) {
    disp.innerHTML = `
      <label>Afegir sessió de fotografia (qualsevol mes, sense vincular encara)</label>
      <select id="f-add-sessio">
        <option value="">— Tria una sessió —</option>
        ${disponibles.map(ev => `<option value="${ev.id}">${formatDayLabel(ev.dia)} — ${escapeHtml(ev.titol)}</option>`).join('')}
      </select>
    `;
    document.getElementById('f-add-sessio').addEventListener('change', async (e) => {
      if (!e.target.value) return;
      await vincularSessio(e.target.value);
    });
  } else {
    disp.innerHTML = `<p class="item-meta">No hi ha cap sessió de fotografia sense vincular encara. Marca-la primer amb la icona de càmera al Calendari.</p>`;
  }
}

async function vincularSessio(esdevenimentId) {
  const id = window.__currentProjecteId;
  if (!id) { alert('Primer desa el projecte i torna a editar-lo per afegir sessions.'); return; }
  await sb.from('esdeveniments').update({ projecte_id: id }).eq('id', esdevenimentId);
  await refreshProjecteEnEdicio(id);
  suggerirDataEntrega();
}

async function desvincularSessio(esdevenimentId) {
  await sb.from('esdeveniments').update({ projecte_id: null }).eq('id', esdevenimentId);
  const id = window.__currentProjecteId;
  if (id) await refreshProjecteEnEdicio(id);
}

function suggerirDataEntrega() {
  const campData = document.getElementById('f-data');
  if (!campData || campData.value) return; // no trepitgem una data ja posada
  const id = window.__currentProjecteId;
  const proj = cache.projectes.find(p => p.id === id);
  const sessions = proj ? (proj.esdeveniments || []) : [];
  if (!sessions.length) return;
  const primera = sessions.slice().sort((a, b) => a.dia.localeCompare(b.dia))[0];
  const suggerida = new Date(primera.dia);
  suggerida.setDate(suggerida.getDate() + 15);
  campData.value = dateKey(suggerida);
  campData.style.borderColor = 'var(--accent)';
}

async function refreshProjecteEnEdicio(id) {
  const { data } = await sb.from('projectes').select('*, esdeveniments(id, dia, titol)').eq('id', id).single();
  if (data) {
    const idx = cache.projectes.findIndex(p => p.id === id);
    if (idx >= 0) cache.projectes[idx] = data;
    renderSessionsPickers(data);
  }
  loadCalEvents();
}

async function saveProjecte(id) {
  const payload = {
    nom: document.getElementById('f-nom').value.trim(),
    client: document.getElementById('f-client').value.trim(),
    estat: document.getElementById('f-estat').value,
    data_entrega: document.getElementById('f-data').value || null,
    fotos_totals: Number(document.getElementById('f-tot').value) || 0,
    fotos_editades: Number(document.getElementById('f-edit').value) || 0,
    notes: document.getElementById('f-notes').value.trim()
  };
  if (!payload.nom) return;
  if (id) {
    await sb.from('projectes').update(payload).eq('id', id);
    await desarEquipamentVinculat(id);
    closeModal();
    loadProjectes();
  } else {
    const { data, error } = await sb.from('projectes').insert(payload).select().single();
    if (error) { console.error(error); return; }
    id = data.id;
    await desarEquipamentVinculat(id);
    await loadProjectes();
    // Reobrim el formulari ja com a edició, amb el botó "Desar" ben vinculat al nou id
    openProjecteForm(id);
  }
}

async function desarEquipamentVinculat(projecteId) {
  const seleccionats = [...document.querySelectorAll('.equip-check:checked')].map(el => el.value);
  await sb.from('projecte_equipament').delete().eq('projecte_id', projecteId);
  if (seleccionats.length) {
    await sb.from('projecte_equipament').insert(seleccionats.map(eqId => ({ projecte_id: projecteId, equipament_id: eqId })));
  }
}

async function duplicarProjecte(id) {
  const proj = cache.projectes.find(p => p.id === id);
  if (!proj) return;
  const { nom, client, estat, notes } = proj;
  await sb.from('projectes').insert({ nom: nom + ' (còpia)', client, estat: 'en_curs', notes, fotos_totals: 0, fotos_editades: 0 });
  closeModal();
  loadProjectes();
}

function compartirProjecte(id) {
  const url = `${window.location.origin}${window.location.pathname}?share=${id}`;
  navigator.clipboard.writeText(url).then(() => alert('Enllaç de només lectura copiat:\n' + url));
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
let historialConceptes = [];

async function carregarHistorialConceptes() {
  if (historialConceptes.length) return;
  const { data } = await sb.from('pressupost_linies').select('concepte, preu_unitat').limit(200);
  const vist = new Map();
  (data || []).forEach(l => { if (l.concepte && !vist.has(l.concepte)) vist.set(l.concepte, l.preu_unitat); });
  historialConceptes = [...vist.entries()];
}

async function openPressupostForm(id) {
  const existing = id ? cache.pressupostos.find(p => p.id === id) : null;
  currentLinies = existing ? existing.pressupost_linies.slice().sort((a, b) => a.ordre - b.ordre) : [];
  if (!currentLinies.length) currentLinies.push({ concepte: '', quantitat: 1, preu_unitat: 0 });
  const projOpts = cache.projectes.length ? cache.projectes : (await sb.from('projectes').select('id,nom')).data || [];
  await carregarHistorialConceptes();

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
      <input list="historial-conceptes" placeholder="Concepte" value="${escapeHtml(l.concepte)}" oninput="currentLinies[${i}].concepte = this.value" onchange="omplirPreuHistoric(${i}, this.value)">
      <input type="number" placeholder="Qtat" value="${l.quantitat}" oninput="currentLinies[${i}].quantitat = Number(this.value) || 0; updateTotal()">
      <input type="number" placeholder="Preu" value="${l.preu_unitat}" oninput="currentLinies[${i}].preu_unitat = Number(this.value) || 0; updateTotal()">
      <button class="link-btn" onclick="removeLinia(${i})">×</button>
    </div>
  `).join('') + `<datalist id="historial-conceptes">${historialConceptes.map(([c]) => `<option value="${escapeHtml(c)}">`).join('')}</datalist>`;
  updateTotal();
}

function omplirPreuHistoric(i, concepte) {
  const trobat = historialConceptes.find(([c]) => c === concepte);
  if (trobat) {
    currentLinies[i].preu_unitat = trobat[1];
    renderLinies();
  }
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
  const params = new URLSearchParams(window.location.search);
  const shareId = params.get('share');
  if (shareId) {
    renderShareView(shareId);
    return;
  }
  GCal.init();
  switchView('calendari');
});

async function renderShareView(id) {
  document.querySelector('nav.bottom').style.display = 'none';
  document.getElementById('fab-add').style.display = 'none';
  document.querySelector('header.top .eyebrow').textContent = 'Fitxa de projecte';
  document.getElementById('header-title').textContent = 'Carregant…';

  const { data: p, error } = await sb.from('projectes').select('*, esdeveniments(dia, titol)').eq('id', id).single();
  const main = document.querySelector('main');
  if (error || !p) {
    main.innerHTML = `<div class="empty"><p>No s'ha trobat aquest projecte.</p></div>`;
    return;
  }
  document.getElementById('header-title').textContent = p.nom;
  const ESTAT_LABEL_SHARE = { en_curs: 'En curs', edicio: 'En edició', entregat: 'Entregat', cancelat: 'Cancel·lat' };
  const pct = p.fotos_totals > 0 ? Math.min(100, Math.round((p.fotos_editades / p.fotos_totals) * 100)) : 0;
  const sessions = (p.esdeveniments || []).slice().sort((a, b) => a.dia.localeCompare(b.dia));

  main.innerHTML = `
    <div class="frame">
      <div class="item-row">
        <div class="item-main">
          <p class="item-name">${escapeHtml(p.nom)}</p>
          <p class="item-meta">${p.client ? escapeHtml(p.client) : ''}</p>
        </div>
        <span class="pill ${p.estat === 'entregat' ? 'ok' : 'warn'}">${ESTAT_LABEL_SHARE[p.estat] || p.estat}</span>
      </div>
      ${p.data_entrega ? `<p class="item-meta" style="margin-top:10px">Data d'entrega: ${formatDate(p.data_entrega)}</p>` : ''}
      ${p.fotos_totals > 0 ? `<p class="item-meta" style="margin-top:10px">${p.fotos_editades} / ${p.fotos_totals} fotos editades</p><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
    </div>
    ${sessions.length ? `
    <div class="section-title">Sessions</div>
    <div class="frame">
      ${sessions.map(s => `<div class="event-row"><div class="event-date">${formatDayLabel(s.dia)}</div><div><p class="event-title">${escapeHtml(s.titol)}</p></div></div>`).join('')}
    </div>` : ''}
  `;
}
