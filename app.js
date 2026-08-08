function mostrarSkeleton(containerId, files) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const n = files || 3;
  el.innerHTML = Array.from({ length: n }, () => `<div class="skeleton-row"></div>`).join('');
}

// ---------- Toasts i confirmació personalitzada ----------
function toast(missatge, tipus) {
  if (!tipus) tipus = /no s'ha pogut|error/i.test(missatge) ? 'error' : 'info';
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${tipus}`;
  el.textContent = missatge;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

function confirmDialog(missatge, textBoto) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-overlay');
    document.getElementById('confirm-message').textContent = missatge;
    document.getElementById('confirm-ok').textContent = textBoto || 'Eliminar';
    overlay.classList.add('active');
    const cancelBtn = document.getElementById('confirm-cancel');
    const okBtn = document.getElementById('confirm-ok');
    const cleanup = (result) => {
      overlay.classList.remove('active');
      cancelBtn.removeEventListener('click', onCancel);
      okBtn.removeEventListener('click', onOk);
      resolve(result);
    };
    const onCancel = () => cleanup(false);
    const onOk = () => cleanup(true);
    cancelBtn.addEventListener('click', onCancel);
    okBtn.addEventListener('click', onOk);
  });
}

// ---------- Accés a dades: helpers genèrics ----------
// Centralitzen el patró repetit "insert o update + gestió d'error" i
// "confirmar + delete + gestió d'error" que abans es repetia a cada entitat.
const ERROR_DESAR = 'No s\'ha pogut desar. Comprova la connexió i torna-ho a provar.';
const ERROR_ELIMINAR = 'No s\'ha pogut eliminar. Comprova la connexió i torna-ho a provar.';

/**
 * Crea o actualitza una fila. Retorna la fila desada (amb `id`) o `null` si ha fallat
 * (ja mostra el toast d'error, no cal repetir-ho a qui el crida).
 */
async function dbUpsert(table, id, payload) {
  const query = id
    ? sb.from(table).update(payload).eq('id', id).select().single()
    : sb.from(table).insert(payload).select().single();
  const { data, error } = await query;
  if (error) {
    toast(ERROR_DESAR);
    console.error(`dbUpsert(${table})`, error);
    return null;
  }
  return data;
}

/**
 * Demana confirmació i elimina una fila. Retorna `true` si s'ha eliminat,
 * `false` si l'usuari ha cancel·lat o ha fallat (ja mostra el toast d'error).
 */
async function dbRemove(table, id, missatgeConfirmacio) {
  const ok = await confirmDialog(missatgeConfirmacio || 'Segur que ho vols eliminar? No es pot desfer.');
  if (!ok) return false;
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) {
    toast(ERROR_ELIMINAR);
    console.error(`dbRemove(${table})`, error);
    return false;
  }
  return true;
}

/**
 * Executa `worker` sobre tots els `items` amb un màxim de `concurrencia` en paral·lel
 * (en lloc d'un `for` seqüencial que espera un a un). Útil per sincronitzacions massives
 * amb una API externa sense disparar-les totes de cop ni fer-les una darrere l'altra.
 */
async function executarEnLots(items, worker, concurrencia = 4) {
  const resultats = [];
  let index = 0;
  async function seguentLot() {
    while (index < items.length) {
      const i = index++;
      resultats[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrencia, items.length) }, seguentLot));
  return resultats;
}

const sb = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// ---------- Ombra de capçalera en fer scroll ----------
const headerTopEl = document.querySelector('header.top');
window.addEventListener('scroll', () => {
  if (headerTopEl) headerTopEl.classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });

// ---------- Estat de connexió ----------
function actualitzarEstatConnexio() {
  const banner = document.getElementById('offline-banner');
  if (banner) banner.style.display = navigator.onLine ? 'none' : 'block';
}
window.addEventListener('online', actualitzarEstatConnexio);
window.addEventListener('offline', actualitzarEstatConnexio);
actualitzarEstatConnexio();

// Evita doble enviament: desactiva el boto en clicar-lo i el reactiva si cal
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn.primary:not(.fg-etiqueta-btn), .btn.danger');
  if (!btn || btn.disabled) return;
  if (!navigator.onLine) {
    e.preventDefault();
    e.stopPropagation();
    toast('Estàs sense connexió. Torna-ho a provar quan tinguis internet.');
    return;
  }
  const textOriginal = btn.textContent;
  btn.disabled = true;
  btn.style.opacity = '0.6';
  setTimeout(() => {
    // Si el modal encara existeix (per exemple, ha fallat el desat), reactivem el boto
    if (document.body.contains(btn)) {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }, 2500);
}, true);

const VIEW_TITLES = {
  projectes: { calendari: 'Calendari', llista: 'Projectes', pressupostos: 'Pressupostos' },
  equip: { equipament: 'Equipament', bateries: 'Bateries', sd: 'Targetes SD' },
  carrets: { carrets: 'Carrets' }
};

let currentView = 'projectes';
let projSub = 'calendari';
let eqSub = 'equipament';
let cache = { equipament: [], bateries: [], sd: [], projectes: [], pressupostos: [], carrets: [], tasques: [] };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Navegació ----------
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelectorAll('nav.bottom button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('fab-add').style.display = 'flex';
  if (view === 'projectes') { setProjSubview(projSub); }
  else if (view === 'equip') { setEquipSubview(eqSub); }
  else { document.getElementById('header-title').textContent = 'Carrets'; loadCarrets(); }
}

function setProjSubview(sub) {
  projSub = sub;
  ['calendari', 'llista', 'pressupostos'].forEach(s => {
    document.getElementById(`chip-proj-${s}`).classList.toggle('active', s === sub);
    document.getElementById(`subview-proj-${s}`).style.display = s === sub ? 'block' : 'none';
  });
  document.getElementById('header-title').textContent = VIEW_TITLES.projectes[sub];
  if (sub === 'calendari') loadCalEvents();
  else if (sub === 'llista') { loadProjectes(); loadTasques(); }
  else if (sub === 'pressupostos') loadPressupostos();
}

document.querySelectorAll('nav.bottom button').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

document.getElementById('fab-add').addEventListener('click', () => {
  if (currentView === 'projectes') {
    if (projSub === 'calendari') openEventForm();
    else if (projSub === 'llista') openProjecteForm();
    else if (projSub === 'pressupostos') openPressupostForm();
  } else if (currentView === 'equip') {
    if (eqSub === 'equipament') openEquipamentForm();
    else if (eqSub === 'bateries') openBateriaForm();
    else if (eqSub === 'sd') openSdForm();
  } else if (currentView === 'carrets') {
    openCarretForm();
  }
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
  mostrarPassats = false;
  loadCalEvents();
}

function selectCalDay(key) {
  calSelectedDay = calSelectedDay === key ? null : key;
  renderCalGrid();
  renderCalAgenda();
}

async function loadCalEvents() {
  if (!calEvents.length) mostrarSkeleton('cal-events');
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

  // Totes les consultes necessàries es disparen alhora, no una darrere l'altra.
  const [bateriesRes, sdsRes, projectesRes] = await Promise.all([
    properaFoto ? sb.from('bateries').select('carregada') : Promise.resolve({ data: null }),
    properaFoto ? sb.from('targetes_sd').select('buidada') : Promise.resolve({ data: null }),
    sb.from('projectes').select('nom, data_entrega, fotos_totals, fotos_editades').eq('estat', 'edicio')
  ]);

  if (properaFoto) {
    const bateries = bateriesRes.data;
    const sds = sdsRes.data;
    const capCarregada = bateries && bateries.length && !bateries.some(b => b.carregada);
    const capBuidada = sds && sds.length && !sds.some(s => s.buidada);
    if (capCarregada) alerts.push(`Tens "${properaFoto.titol}" ${properaFoto.dia === today ? 'avui' : 'demà'} i cap bateria marcada com a carregada.`);
    if (capBuidada) alerts.push(`Tens "${properaFoto.titol}" ${properaFoto.dia === today ? 'avui' : 'demà'} i cap targeta SD buidada.`);
  }

  (projectesRes.data || []).forEach(p => {
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

let mostrarPassats = false;

function renderCalAgenda() {
  const container = document.getElementById('cal-events');
  let list = calEvents;
  const avui = dateKey(new Date());
  if (calSelectedDay) {
    list = list.filter(e => e.dia === calSelectedDay);
  } else if (!mostrarPassats) {
    list = list.filter(e => e.dia >= avui);
  }
  document.getElementById('cal-count').textContent = list.length;

  document.getElementById('cal-agenda-heading').textContent = calSelectedDay
    ? new Date(calSelectedDay).toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long' })
    : 'Tot el mes';

  const hiHaPassats = !calSelectedDay && calEvents.some(e => e.dia < avui);
  const toggleHtml = hiHaPassats
    ? `<button class="btn ghost small" style="margin-bottom:10px" onclick="alternarPassats()">${mostrarPassats ? '👁 Amagar passats' : '🕓 Veure passats'}</button>`
    : '';

  if (!list.length) {
    container.innerHTML = `${toggleHtml}<div class="empty"><div class="empty-icon">◻</div><p>Cap esdeveniment.</p></div>`;
    return;
  }
  container.innerHTML = toggleHtml + list.map(e => `
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

function alternarPassats() {
  mostrarPassats = !mostrarPassats;
  renderCalAgenda();
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
      <label><input type="checkbox" id="ev-alldia" ${existing?.tot_dia ? 'checked' : ''} class="checkbox-inline"> Tot el dia</label>
    </div>
    <div class="field-row" id="ev-hores" style="display:${existing?.tot_dia ? 'none' : 'flex'}">
      <div class="field"><label>Hora inici</label><input id="ev-inici" type="time" value="${existing?.hora_inici ? existing.hora_inici.slice(0, 5) : '10:00'}"></div>
      <div class="field"><label>Hora fi</label><input id="ev-fi" type="time" value="${existing?.hora_fi ? existing.hora_fi.slice(0, 5) : '12:00'}"></div>
    </div>
    <div class="field">
      <label><input type="checkbox" id="ev-foto" ${existing ? (existing.es_fotografia ? 'checked' : '') : 'checked'} class="checkbox-inline"> És una sessió de fotografia</label>
    </div>
    <div class="field" id="ev-projecte-wrap"></div>
    <div class="field"><label>Notes</label><textarea id="ev-notes" rows="2">${existing ? escapeHtml(existing.notes || '') : ''}</textarea></div>
    <div class="modal-actions">
      ${existing ? `<button class="btn danger" onclick="deleteEvent('${id}')">Eliminar</button>` : ''}
      <button class="btn primary" onclick="saveEvent('${id || ''}')">Desar</button>
    </div>
  `);
  document.getElementById('ev-alldia').addEventListener('change', (e) => {
    document.getElementById('ev-hores').style.display = e.target.checked ? 'none' : 'flex';
  });
  carregarSelectorProjecteEvent(existing);
}

async function carregarSelectorProjecteEvent(existing) {
  const projOpts = cache.projectes.length ? cache.projectes : (await sb.from('projectes').select('id,nom')).data || [];
  const wrap = document.getElementById('ev-projecte-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <label>Forma part d'un projecte?</label>
    <select id="ev-projecte">
      <option value="">— Cap projecte —</option>
      ${projOpts.map(p => `<option value="${p.id}" ${existing?.projecte_id === p.id ? 'selected' : ''}>${escapeHtml(p.nom)}</option>`).join('')}
    </select>
  `;
}

async function saveEvent(id) {
  const payload = {
    titol: document.getElementById('ev-titol').value.trim(),
    dia: document.getElementById('ev-dia').value,
    tot_dia: document.getElementById('ev-alldia').checked,
    hora_inici: document.getElementById('ev-alldia').checked ? null : document.getElementById('ev-inici').value,
    hora_fi: document.getElementById('ev-alldia').checked ? null : document.getElementById('ev-fi').value,
    es_fotografia: document.getElementById('ev-foto').checked,
    projecte_id: document.getElementById('ev-projecte')?.value || null,
    notes: document.getElementById('ev-notes').value.trim()
  };
  if (!payload.titol || !payload.dia) return;
  if (!await dbUpsert('esdeveniments', id, payload)) return;
  closeModal();
  loadCalEvents();
  loadProjectes();
}

async function deleteEvent(id) {
  if (!await dbRemove('esdeveniments', id)) return;
  closeModal();
  loadCalEvents();
}

let importMonth = startOfMonth(calMonth || new Date());

async function importFromGoogle() {
  importMonth = startOfMonth(calMonth || new Date());
  await carregarIRenderitzarImport();
}

async function canviarMesImport(delta) {
  importMonth = new Date(importMonth.getFullYear(), importMonth.getMonth() + delta, 1);
  await carregarIRenderitzarImport();
}

async function carregarIRenderitzarImport() {
  const start = dateKey(importMonth);
  const end = dateKey(new Date(importMonth.getFullYear(), importMonth.getMonth() + 1, 0));
  const startISO = new Date(start + 'T00:00:00').toISOString();
  const endISO = new Date(end + 'T23:59:59').toISOString();

  const mesLabel = importMonth.toLocaleDateString('ca-ES', { month: 'long', year: 'numeric' });
  openModal(`<h2>Important…</h2><p class="item-meta">Consultant el teu Google Calendar (${mesLabel})…</p>`);
  const [trobats, { data: totsImportats }] = await Promise.all([
    GCal.pullEvents({ startISO, endISO }),
    sb.from('esdeveniments').select('google_event_id').not('google_event_id', 'is', null)
  ]);

  const yaImportatsIds = new Set((totsImportats || []).map(e => e.google_event_id));
  const nous = trobats.filter(ev => !yaImportatsIds.has(ev.googleId));

  window.__importCandidats = nous;
  renderImportList(nous);
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

function renderImportList(nous) {
  const fotoColorId = getFotografiaColorId();
  const mesLabel = importMonth.toLocaleDateString('ca-ES', { month: 'long', year: 'numeric' });
  openModal(`
    <h2>Importar de Google</h2>
    <div class="cal-month-nav" style="margin-bottom:6px">
      <button class="btn ghost small" onclick="canviarMesImport(-1)">‹</button>
      <span class="cal-month-label">${mesLabel}</span>
      <button class="btn ghost small" onclick="canviarMesImport(1)">›</button>
    </div>
    ${nous.length ? `<button class="btn primary full" id="btn-importar-seleccio" onclick="confirmarImportacio()" style="margin-bottom:10px" disabled>Importar seleccionats (0)</button>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <p class="item-meta" style="margin:0">${nous.length ? nous.length + ' esdeveniment(s) nous. Els verds ja venen marcats.' : 'Cap esdeveniment nou aquest mes.'}</p>
      <button class="btn ghost small" onclick="configurarColorFotografia()">⚙ Color</button>
    </div>
    ${nous.length ? `
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <button class="btn small ghost" onclick="marcarTotsImport(true)">Seleccionar tots</button>
      <button class="btn small ghost" onclick="marcarTotsImport(false)">Cap</button>
    </div>` : ''}
    <div id="import-list">
      ${nous.map((ev, i) => `
        <div class="event-row">
          <input type="checkbox" class="import-check" data-i="${i}" ${fotoColorId && ev.colorId === fotoColorId ? 'checked' : ''} onchange="actualitzarComptadorImport()" style="width:auto">
          ${ev.colorHex ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ev.colorHex};flex-shrink:0"></span>` : ''}
          <div class="event-date">${formatDayLabel(ev.dia)}</div>
          <div style="flex:1;min-width:0">
            <p class="event-title">${escapeHtml(ev.title)}</p>
            <p class="event-time">${ev.totDia ? 'Tot el dia' : (ev.horaInici || '')}</p>
          </div>
        </div>
      `).join('')}
    </div>
    ${!nous.length ? `<div class="modal-actions"><button class="btn full" onclick="closeModal()">Tancar</button></div>` : ''}
  `);
  actualitzarComptadorImport();
}

function marcarTotsImport(valor) {
  document.querySelectorAll('.import-check').forEach(el => { el.checked = valor; });
  actualitzarComptadorImport();
}

function actualitzarComptadorImport() {
  const n = document.querySelectorAll('.import-check:checked').length;
  const btn = document.getElementById('btn-importar-seleccio');
  if (!btn) return;
  btn.textContent = `Importar seleccionats (${n})`;
  btn.disabled = n === 0;
}

async function configurarColorFotografia() {
  const swatches = await GCal.getColorSwatches();
  const current = getFotografiaColorId();
  openModal(`
    <h2>Color de "Fotografia"</h2>
    <p class="item-meta" style="margin-bottom:10px">Tria el color que fas servir a Google Calendar per les sessions de fotografia.</p>
    <div class="color-picker-grid">
      ${swatches.map(s => `<button class="color-swatch ${s.id === current ? 'selected' : ''}" onclick="localStorage.setItem('fotografia_colorId','${s.id}'); renderImportList(window.__importCandidats)" style="background:${s.hex}"></button>`).join('')}
    </div>
    <div class="modal-actions"><button class="btn full ghost" onclick="renderImportList(window.__importCandidats)">Tornar</button></div>
  `);
}

async function confirmarImportacio() {
  const candidats = window.__importCandidats || [];
  const seleccionats = new Set([...document.querySelectorAll('.import-check:checked')].map(el => Number(el.dataset.i)));
  if (!seleccionats.size) return;
  const registres = candidats
    .map((ev, i) => ({ ev, i }))
    .filter(({ i }) => seleccionats.has(i))
    .map(({ ev }) => ({
      titol: ev.title,
      dia: ev.dia,
      tot_dia: ev.totDia,
      hora_inici: ev.totDia ? null : ev.horaInici,
      hora_fi: ev.totDia ? null : ev.horaFi,
      es_fotografia: true,
      google_event_id: ev.googleId
    }));
  if (registres.length) await sb.from('esdeveniments').insert(registres);
  closeModal();
  loadCalEvents();
}

async function syncAllToGoogle() {
  if (!calEvents.length) {
    toast('Aquest mes no hi ha cap esdeveniment creat encara.');
    return;
  }
  const pendents = calEvents.filter(e => !e.google_event_id);
  if (!pendents.length) {
    toast('Tots els esdeveniments d\'aquest mes ja estan sincronitzats.');
    return;
  }
  const ok = await confirmDialog(`Sincronitzar ${pendents.length} esdeveniment(s) amb Google Calendar?`);
  if (!ok) return;
  let fets = 0;
  let errors = 0;
  await executarEnLots(pendents, async (ev) => {
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
  });
  toast(`Sincronitzats ${fets} de ${pendents.length} esdeveniments.${errors ? ` (${errors} amb error, mira la consola)` : ''}`);
  loadCalEvents();
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
  if (window.__mapaExposicionsInstance) { window.__mapaExposicionsInstance.remove(); window.__mapaExposicionsInstance = null; }
  if (window.__mapaPickerInstance) { window.__mapaPickerInstance.remove(); window.__mapaPickerInstance = null; }
}
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });

// ============ MOTXILLA ============
async function obrirMotxilla() {
  openModal(`<h2>🎒 Motxilla</h2><p class="item-meta">Carregant...</p>`);
  const [{ data: equip }, { data: bat }, { data: sd }] = await Promise.all([
    sb.from('equipament').select('id, nom, tipus, en_motxilla').order('tipus').order('nom'),
    sb.from('bateries').select('id, nom, en_motxilla').order('nom'),
    sb.from('targetes_sd').select('id, nom, en_motxilla').order('nom')
  ]);
  window.__motxillaData = { equip: equip || [], bat: bat || [], sd: sd || [] };
  renderMotxilla();
}

function renderMotxilla() {
  const { equip, bat, sd } = window.__motxillaData;
  const marcats = equip.filter(e => e.en_motxilla).length + bat.filter(b => b.en_motxilla).length + sd.filter(s => s.en_motxilla).length;

  const grupEquip = (tipus, titol) => {
    const items = equip.filter(e => e.tipus === tipus);
    if (!items.length) return '';
    return `
      <p style="font-family:var(--sans);font-weight:700;font-size:13px;text-transform:uppercase;color:var(--text-dim);margin:14px 0 6px">${titol}</p>
      ${items.map(e => `
        <label style="display:flex;align-items:center;gap:8px;padding:7px 0">
          <input type="checkbox" class="checkbox-inline" ${e.en_motxilla ? 'checked' : ''} onchange="toggleMotxilla('equipament', '${e.id}', this.checked)">
          <span style="font-size:15px">${escapeHtml(e.nom)}</span>
        </label>
      `).join('')}
    `;
  };

  const grupSimple = (items, taula, titol) => {
    if (!items.length) return '';
    return `
      <p style="font-family:var(--sans);font-weight:700;font-size:13px;text-transform:uppercase;color:var(--text-dim);margin:14px 0 6px">${titol}</p>
      ${items.map(i => `
        <label style="display:flex;align-items:center;gap:8px;padding:7px 0">
          <input type="checkbox" class="checkbox-inline" ${i.en_motxilla ? 'checked' : ''} onchange="toggleMotxilla('${taula}', '${i.id}', this.checked)">
          <span style="font-size:15px">${escapeHtml(i.nom)}</span>
        </label>
      `).join('')}
    `;
  };

  openModal(`
    <h2>🎒 Motxilla</h2>
    <p class="item-meta" style="margin-bottom:6px">Marca el que et portes avui. <b>${marcats}</b> element(s) marcats.</p>
    ${grupEquip('camera', 'Càmeres')}
    ${grupEquip('objectiu', 'Objectius')}
    ${grupEquip('accessori', 'Accessoris')}
    ${grupSimple(window.__motxillaData.bat, 'bateries', 'Bateries')}
    ${grupSimple(window.__motxillaData.sd, 'targetes_sd', 'Targetes SD')}
    <div class="modal-actions" style="margin-top:16px">
      <button class="btn full ghost" onclick="buidarMotxilla()">Desmarcar tot</button>
    </div>
    <button class="btn primary full" style="margin-top:10px" onclick="generarPdfMotxilla()">📄 Generar PDF</button>
  `);
}

async function toggleMotxilla(taula, id, marcat) {
  const grup = taula === 'equipament' ? window.__motxillaData.equip : (taula === 'bateries' ? window.__motxillaData.bat : window.__motxillaData.sd);
  const item = grup.find(i => i.id === id);
  if (item) item.en_motxilla = marcat;
  const { error } = await sb.from(taula).update({ en_motxilla: marcat }).eq('id', id);
  if (error) { toast(ERROR_DESAR); console.error(error); }
  // Actualitzem només el comptador, sense redibuixar tota la llista (evita perdre el focus del checkbox tocat)
  const marcats = window.__motxillaData.equip.filter(e => e.en_motxilla).length +
    window.__motxillaData.bat.filter(b => b.en_motxilla).length +
    window.__motxillaData.sd.filter(s => s.en_motxilla).length;
  const comptador = modalContent.querySelector('.item-meta b');
  if (comptador) comptador.textContent = marcats;
}

async function buidarMotxilla() {
  if (!await confirmDialog('Desmarcar tots els elements de la motxilla?', 'Desmarcar')) return;
  const { equip, bat, sd } = window.__motxillaData;
  await Promise.all([
    ...equip.filter(e => e.en_motxilla).map(e => sb.from('equipament').update({ en_motxilla: false }).eq('id', e.id)),
    ...bat.filter(b => b.en_motxilla).map(b => sb.from('bateries').update({ en_motxilla: false }).eq('id', b.id)),
    ...sd.filter(s => s.en_motxilla).map(s => sb.from('targetes_sd').update({ en_motxilla: false }).eq('id', s.id))
  ]);
  equip.forEach(e => e.en_motxilla = false);
  bat.forEach(b => b.en_motxilla = false);
  sd.forEach(s => s.en_motxilla = false);
  renderMotxilla();
}

function carregarJsPdf() {
  return new Promise((resolve) => {
    if (window.jspdf) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = resolve;
    document.body.appendChild(script);
  });
}

async function generarPdfMotxilla() {
  const { equip, bat, sd } = window.__motxillaData;
  const marcatsEquip = equip.filter(e => e.en_motxilla);
  const marcatsBat = bat.filter(b => b.en_motxilla);
  const marcatsSd = sd.filter(s => s.en_motxilla);
  if (!marcatsEquip.length && !marcatsBat.length && !marcatsSd.length) {
    toast('Marca almenys un element abans de generar el PDF.');
    return;
  }

  await carregarJsPdf();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 20;

  doc.setFontSize(18);
  doc.text('Motxilla', 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(new Date().toLocaleDateString('ca-ES', { day: 'numeric', month: 'long', year: 'numeric' }), 14, y);
  doc.setTextColor(0);
  y += 12;

  const seccio = (titol, items) => {
    if (!items.length) return;
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.text(titol, 14, y);
    y += 7;
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    items.forEach(item => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(`☐  ${item.nom}`, 18, y);
      y += 7;
    });
    y += 5;
  };

  const TIPUS_LABEL_PDF = { camera: 'Càmeres', objectiu: 'Objectius', accessori: 'Accessoris' };
  ['camera', 'objectiu', 'accessori'].forEach(t => seccio(TIPUS_LABEL_PDF[t], marcatsEquip.filter(e => e.tipus === t)));
  seccio('Bateries', marcatsBat);
  seccio('Targetes SD', marcatsSd);

  doc.save(`motxilla-${dateKey(new Date())}.pdf`);
}

// ============ BATERIES ============
async function loadBateries() {
  if (!cache.bateries.length) mostrarSkeleton('bat-list');
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
          <p class="item-meta">${b.equipament ? escapeHtml(b.equipament.nom) : 'Sense equip assignat'}${b.percentatge != null ? ' · 🔋 ' + b.percentatge + '%' : ''}${b.usos ? ' · ' + b.usos + ' càrrega' + (b.usos === 1 ? '' : 's') : ''}</p>
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
    <div class="field-row">
      <div class="field"><label>Percentatge (opcional)</label><input id="f-percentatge" type="number" min="0" max="100" value="${existing?.percentatge ?? ''}" placeholder="—"></div>
      <div class="field"><label>Usos (opcional)</label><input id="f-usos" type="number" min="0" value="${existing?.usos || 0}"></div>
    </div>
    <div class="modal-actions">
      ${existing ? `<button class="btn danger" onclick="deleteBateria('${id}')">Eliminar</button>` : ''}
      <button class="btn primary" onclick="saveBateria('${id || ''}')">Desar</button>
    </div>
  `);
}

async function saveBateria(id) {
  const percentatgeVal = document.getElementById('f-percentatge').value;
  const payload = {
    nom: document.getElementById('f-nom').value.trim(),
    equipament_id: document.getElementById('f-equip').value || null,
    notes: document.getElementById('f-notes').value.trim(),
    percentatge: percentatgeVal === '' ? null : Number(percentatgeVal),
    usos: Number(document.getElementById('f-usos').value) || 0
  };
  if (!payload.nom) return;
  if (!id) payload.carregada = false;
  if (!await dbUpsert('bateries', id, payload)) return;
  closeModal();
  loadBateries();
}

async function deleteBateria(id) {
  if (!await dbRemove('bateries', id)) return;
  closeModal();
  loadBateries();
}

// ============ EQUIPAMENT ============
const TIPUS_EQUIP_BASE = ['camera', 'objectiu', 'accessori'];
const TIPUS_LABEL = { camera: 'Càmera', objectiu: 'Objectiu', accessori: 'Accessori' };

async function loadEquipament() {
  if (!cache.equipament.length) mostrarSkeleton('eq-list');
  const { data, error } = await sb.from('equipament').select('*').order('tipus').order('nom');
  if (error) { console.error(error); return; }
  cache.equipament = data;
  document.getElementById('eq-count').textContent = data.length;
  const list = document.getElementById('eq-list');
  document.getElementById('eq-empty').style.display = data.length ? 'none' : 'block';

  const analogiques = data.filter(e => e.tipus === 'camera' && e.tipus_captura === 'analogica');
  let carretsPerCamera = {};
  if (analogiques.length) {
    const { data: carretsCarregats } = await sb.from('carrets').select('marca_model, camera_id').in('estat', ['carregat', 'exposat_parcial']).not('camera_id', 'is', null);
    (carretsCarregats || []).forEach(c => { carretsPerCamera[c.camera_id] = c.marca_model; });
  }

  const targetaHtml = (e) => {
    const carretCarregat = (e.tipus === 'camera' && e.tipus_captura === 'analogica') ? carretsPerCamera[e.id] : null;
    return `
    <div class="frame ${e.estat === 'preparat' ? '' : 'warn'}" onclick="openEquipamentForm('${e.id}')">
      <div class="item-row">
        <div class="item-main">
          <p class="item-name">${escapeHtml(e.nom)}${e.cedit ? ' 🤝' : ''}</p>
          <p class="item-meta">${e.tipus === 'camera' ? (e.tipus_captura === 'analogica' ? 'Analògica' : 'Digital') + ' · ' : ''}${e.ubicacio ? escapeHtml(e.ubicacio) + ' · ' : ''}${e.ultima_revisio ? 'revisat ' + formatDate(e.ultima_revisio) : 'sense revisar'}${e.cedit ? ' · Cedit' + (e.cedit_a ? ' a ' + escapeHtml(e.cedit_a) : '') : ''}${e.te_bateria && e.bateria_pct != null ? ' · 🔋 ' + e.bateria_pct + '%' : ''}${carretCarregat ? ' · 🎞 ' + escapeHtml(carretCarregat) : (e.tipus === 'camera' && e.tipus_captura === 'analogica' ? ' · sense carret' : '')}</p>
        </div>
        <span class="pill ${e.estat === 'preparat' ? 'ok' : 'warn'}">${e.estat}</span>
      </div>
    </div>
  `;
  };

  const grups = TIPUS_EQUIP_BASE.map(tipus => ({ tipus, items: data.filter(e => e.tipus === tipus) }))
    .filter(g => g.items.length);

  list.innerHTML = grups.map(g => `
    <div class="section-title" style="margin-top:18px">${TIPUS_LABEL[g.tipus]} <span class="count-tag">${g.items.length}</span></div>
    ${g.items.map(targetaHtml).join('')}
  `).join('');
}

function openEquipamentForm(id) {
  const existing = id ? cache.equipament.find(e => e.id === id) : null;
  openModal(`
    <h2>${existing ? 'Editar equipament' : 'Nou equipament'}</h2>
    <div class="field"><label>Nom</label><input id="f-nom" value="${existing ? escapeHtml(existing.nom) : ''}" placeholder="Sony A7III"></div>
    <div class="field-row">
      <div class="field">
        <label>Categoria</label>
        <select id="f-tipus" onchange="onCanviTipusEquip(this.value)">
          ${TIPUS_EQUIP_BASE.map(t => `<option value="${t}" ${(existing ? existing.tipus === t : t === 'camera') ? 'selected' : ''}>${TIPUS_LABEL[t]}</option>`).join('')}
        </select>
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
    <div class="field" id="f-captura-wrap" style="display:${(!existing || existing.tipus === 'camera') ? 'block' : 'none'}">
      <label>Tipus de captura</label>
      <select id="f-captura">
        <option value="digital" ${(!existing || existing.tipus_captura !== 'analogica') ? 'selected' : ''}>Digital</option>
        <option value="analogica" ${existing?.tipus_captura === 'analogica' ? 'selected' : ''}>Analògica</option>
      </select>
    </div>
    <div class="field"><label>Ubicació</label><input id="f-ubicacio" value="${existing ? escapeHtml(existing.ubicacio || '') : ''}" placeholder="Motxilla / calaix / maleta"></div>
    <div class="field">
      <label>Número de sèrie (opcional)</label>
      <div style="display:flex;gap:8px">
        <input id="f-numero-serie" value="${existing ? escapeHtml(existing.numero_serie || '') : ''}" placeholder="Per si es perd o el roben" style="flex:1">
        ${existing?.numero_serie ? `<button type="button" class="btn small" onclick="copiarNumeroSerie()">Copiar</button>` : ''}
      </div>
    </div>
    <div class="field"><label>Última revisió</label><input id="f-revisio" type="date" value="${existing?.ultima_revisio || ''}"></div>

    <div class="field">
      <label><input type="checkbox" id="f-cedit" ${existing?.cedit ? 'checked' : ''} onchange="document.getElementById('f-cedit-a-wrap').style.display = this.checked ? 'block' : 'none'" class="checkbox-inline"> Cedit a algú</label>
    </div>
    <div class="field" id="f-cedit-a-wrap" style="display:${existing?.cedit ? 'block' : 'none'}">
      <label>A qui</label>
      <input id="f-cedit-a" value="${existing ? escapeHtml(existing.cedit_a || '') : ''}" placeholder="Nom de la persona">
    </div>

    <div class="field" id="f-bateria-wrap" style="display:${(!existing || existing.tipus !== 'camera') ? 'block' : 'none'}">
      <label><input type="checkbox" id="f-te-bateria" ${existing?.te_bateria ? 'checked' : ''} onchange="document.getElementById('f-bateria-pct-wrap').style.display = this.checked ? 'block' : 'none'" class="checkbox-inline"> Té bateria integrada</label>
    </div>
    <div class="field" id="f-bateria-pct-wrap" style="display:${existing?.te_bateria ? 'block' : 'none'}">
      <label>Percentatge de bateria (opcional)</label>
      <input id="f-bateria-pct" type="number" min="0" max="100" value="${existing?.bateria_pct ?? ''}" placeholder="—">
    </div>

    <div class="field"><label>Notes</label><textarea id="f-notes" rows="2">${existing ? escapeHtml(existing.notes || '') : ''}</textarea></div>
    <div class="modal-actions">
      ${existing ? `<button class="btn danger" onclick="deleteEquipament('${id}')">Eliminar</button>` : ''}
      <button class="btn primary" onclick="saveEquipament('${id || ''}')">Desar</button>
    </div>
  `);
}

function copiarNumeroSerie() {
  const valor = document.getElementById('f-numero-serie').value.trim();
  if (!valor) return;
  navigator.clipboard.writeText(valor).then(() => toast('Número de sèrie copiat.'));
}

function onCanviTipusEquip(valor) {
  const esCamera = valor === 'camera';
  document.getElementById('f-captura-wrap').style.display = esCamera ? 'block' : 'none';
  document.getElementById('f-bateria-wrap').style.display = esCamera ? 'none' : 'block';
  if (esCamera) {
    document.getElementById('f-te-bateria').checked = false;
    document.getElementById('f-bateria-pct-wrap').style.display = 'none';
  }
}

async function saveEquipament(id) {
  const teBateria = document.getElementById('f-te-bateria')?.checked || false;
  const payload = {
    nom: document.getElementById('f-nom').value.trim(),
    tipus: document.getElementById('f-tipus').value || 'accessori',
    tipus_captura: document.getElementById('f-captura').value,
    estat: document.getElementById('f-estat').value,
    ubicacio: document.getElementById('f-ubicacio').value.trim(),
    numero_serie: document.getElementById('f-numero-serie').value.trim() || null,
    ultima_revisio: document.getElementById('f-revisio').value || null,
    cedit: document.getElementById('f-cedit').checked,
    cedit_a: document.getElementById('f-cedit').checked ? document.getElementById('f-cedit-a').value.trim() : null,
    te_bateria: teBateria,
    bateria_pct: teBateria ? (document.getElementById('f-bateria-pct').value === '' ? null : Number(document.getElementById('f-bateria-pct').value)) : null,
    notes: document.getElementById('f-notes').value.trim()
  };
  if (!payload.nom) return;
  if (!await dbUpsert('equipament', id, payload)) return;
  closeModal();
  loadEquipament();
}

async function deleteEquipament(id) {
  if (!await dbRemove('equipament', id)) return;
  closeModal();
  loadEquipament();
}

// ============ SUBVISTA EQUIPAMENT/CARRETS ============
function setEquipSubview(sub) {
  eqSub = sub;
  ['equipament', 'bateries', 'sd'].forEach(s => {
    document.getElementById(`chip-eq-${s}`).classList.toggle('active', s === sub);
    document.getElementById(`subview-eq-${s}`).style.display = s === sub ? 'block' : 'none';
  });
  document.getElementById('header-title').textContent = VIEW_TITLES.equip[sub];
  if (sub === 'equipament') loadEquipament();
  else if (sub === 'bateries') loadBateries();
  else if (sub === 'sd') loadSd();
}

// ============ CARRETS ============
const ESTAT_CARRET_LABEL = { sense_estrenar: 'Sense estrenar', carregat: 'Carregat en una càmera', exposat_parcial: 'Exposat parcialment (a mitges)', exposat: 'Exposat, pendent revelar', revelat: 'Revelat' };
const ESTAT_CARRET_ORDRE = ['carregat', 'exposat_parcial', 'exposat', 'sense_estrenar', 'revelat'];
let carretFiltre = 'tots';

function setCarretFiltre(estat) {
  carretFiltre = estat;
  renderCarretChips();
  renderCarrets();
}

function renderCarretChips() {
  const chips = document.getElementById('carrets-status-chips');
  const opcions = [['tots', 'Tots'], ['carregat', 'Carregats'], ['exposat', 'Exposats'], ['revelat', 'Revelats'], ['sense_estrenar', 'En stock']];
  chips.innerHTML = opcions.map(([val, label]) => `<button class="chip ${carretFiltre === val ? 'active' : ''}" onclick="setCarretFiltre('${val}')">${label}</button>`).join('');
}

async function loadCarrets() {
  if (!cache.carrets.length) mostrarSkeleton('carrets-list');
  const { data, error } = await sb.from('carrets').select('*, equipament(nom), numfotos:fotogrames(count)').order('creat_el', { ascending: false });
  if (error) { console.error(error); return; }
  cache.carrets = data;
  renderCarretChips();
  renderCarrets();
}

function renderCarrets() {
  let data = cache.carrets;
  if (carretFiltre === 'exposat') data = data.filter(c => c.estat === 'exposat' || c.estat === 'exposat_parcial');
  else if (carretFiltre !== 'tots') data = data.filter(c => c.estat === carretFiltre);

  document.getElementById('carrets-count').textContent = data.length;
  const list = document.getElementById('carrets-list');
  document.getElementById('carrets-empty').style.display = data.length ? 'none' : 'block';
  const ordenats = data.slice().sort((a, b) => ESTAT_CARRET_ORDRE.indexOf(a.estat) - ESTAT_CARRET_ORDRE.indexOf(b.estat));
  list.innerHTML = ordenats.map(c => {
    const fetes = c.numfotos?.[0]?.count || 0;
    const restants = c.fotogrames != null ? Math.max(0, c.fotogrames - fetes) : null;
    const mostrarRestants = (c.estat === 'carregat' || c.estat === 'exposat_parcial') && restants != null;
    const isoLabel = c.iso_forcat && c.iso_forcat !== c.iso
      ? `ISO ${c.iso || '?'}→${c.iso_forcat}` + (c.iso && c.iso_forcat ? ` (${etiquetaPushPull(c.iso, c.iso_forcat)})` : '')
      : `ISO ${c.iso || '?'}`;
    return `
    <div class="frame ${c.estat === 'exposat' ? 'warn' : (c.estat === 'exposat_parcial' ? 'pending' : '')}" onclick="openCarretForm('${c.id}')">
      <div class="item-row">
        <div class="item-main">
          <p class="item-name">${c.titol ? escapeHtml(c.titol) : escapeHtml(c.marca_model)}</p>
          <p class="item-meta">${c.titol ? escapeHtml(c.marca_model) + ' · ' : ''}${c.format} · ${isoLabel} · ${c.tipus_pelicula === 'bn' ? 'B/N' : 'Color'}${c.equipament ? ' · ' + escapeHtml(c.equipament.nom) : ''}${mostrarRestants ? ` · queden ${restants}/${c.fotogrames}` : ''}</p>
        </div>
        <span class="pill ${c.estat === 'revelat' ? 'ok' : (c.estat === 'exposat' ? 'warn' : (c.estat === 'exposat_parcial' ? 'pending' : ''))}">${ESTAT_CARRET_LABEL[c.estat]}</span>
      </div>
    </div>
  `;
  }).join('');
}

function etiquetaPushPull(natiu, forcat) {
  const stops = Math.log2(forcat / natiu);
  if (Math.abs(stops) < 0.1) return 'normal';
  const arrodonit = Math.round(stops * 2) / 2;
  return arrodonit > 0 ? `push +${arrodonit}` : `pull ${arrodonit}`;
}

async function openCarretForm(id) {
  const existing = id ? cache.carrets.find(c => c.id === id) : null;
  const cameresJaCarregades = cache.equipament.length > 0;
  const cameres = cameresJaCarregades
    ? cache.equipament.filter(e => e.tipus === 'camera' && e.tipus_captura === 'analogica')
    : [];
  window.__currentCarretId = id || null;

  // Prebusquem els fotogrames ABANS d'obrir el modal, perquè surti ja complet
  // des del primer instant i no faci "salt" quan arriba la resposta.
  let fotogrames = [];
  if (existing) {
    const { data, error } = await sb.from('fotogrames').select('*').eq('carret_id', id).order('numero', { ascending: true, nullsFirst: false });
    if (!error) fotogrames = data || [];
    window.__fotogramesCache = fotogrames;
  }

  openModal(`
    <h2>${existing ? escapeHtml(existing.titol || existing.marca_model) : 'Nou carret'}</h2>

    ${existing ? `
    ${buildHeroHtml(existing, fotogrames)}
    <div class="section-title">Exposicions <span class="count-tag">${existing.fotogrames ? Math.min(100, Math.round((fotogrames.length / existing.fotogrames) * 100)) + '%' : fotogrames.length}</span></div>
    <div id="fotogrames-list">${buildFotogramesListHtml(fotogrames, id)}</div>
    <button class="btn full ghost" style="margin-top:6px" onclick="obrirFormBatchFotogrames()">+ Afegir-ne diverses de cop</button>
    ${(existing.estat === 'carregat' || existing.estat === 'exposat_parcial') ? `<button class="lab-btn" onclick="enviarARevelar('${id}')">🧪 Enviar a revelar</button>` : ''}
    ${buildMapReservationHtml(fotogrames)}
    <div class="section-title" style="margin-top:26px">Detalls del carret</div>
    ` : ''}

    <div class="field"><label>Títol (opcional)</label><input id="f-titol" value="${existing?.titol ? escapeHtml(existing.titol) : ''}" placeholder="Viatge a Lisboa, boda de la Marta..."></div>
    <div class="field">
      <label>Pel·lícula</label>
      <div style="display:flex;gap:8px">
        <input id="f-marca" list="film-stocks-list" value="${existing ? escapeHtml(existing.marca_model) : ''}" placeholder="Kodak Portra 400" oninput="onCanviFilmStock(this.value)" style="flex:1">
        <button type="button" class="btn small" onclick="obrirDirectoriPellicules()">🎞 Directori</button>
      </div>
      <datalist id="film-stocks-list">
        ${FILM_STOCKS.map(f => `<option value="${f.nom}">`).join('')}
      </datalist>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Format</label>
        <select id="f-format" onchange="onCanviFormatCarret(this.value)">
          <option value="35mm" ${existing?.format === '35mm' ? 'selected' : ''}>35mm</option>
          <option value="120" ${existing?.format === '120' ? 'selected' : ''}>120</option>
          <option value="altres" ${existing?.format === 'altres' ? 'selected' : ''}>Altres</option>
        </select>
      </div>
      <div class="field">
        <label>Tipus</label>
        <select id="f-tipus-pel">
          <option value="color" ${!existing || existing.tipus_pelicula === 'color' ? 'selected' : ''}>Color</option>
          <option value="bn" ${existing?.tipus_pelicula === 'bn' ? 'selected' : ''}>Blanc i negre</option>
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>ISO nativa</label><input id="f-iso" type="number" value="${existing?.iso || 400}"></div>
      <div class="field"><label>Fotogrames</label><input id="f-fotogrames" type="number" value="${existing?.fotogrames || 36}"></div>
    </div>
    <div class="field">
      <label>Forçar carret a ISO (opcional, push/pull)</label>
      <input id="f-iso-forcat" type="number" value="${existing?.iso_forcat ?? ''}" placeholder="Deixa buit si no el forces">
    </div>
    <div class="field">
      <label>Estat</label>
      <select id="f-estat-carret" onchange="document.getElementById('f-camera-wrap').style.display = this.value==='carregat' ? 'block' : 'none'">
        ${Object.entries(ESTAT_CARRET_LABEL).map(([v, l]) => `<option value="${v}" ${existing?.estat === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="field" id="f-camera-wrap" style="display:${existing?.estat === 'carregat' ? 'block' : 'none'}">
      <label>Càmera</label>
      <select id="f-camera">
        <option value="">— Cap —</option>
        ${cameres.map(c => `<option value="${c.id}" ${existing?.camera_id === c.id ? 'selected' : ''}>${escapeHtml(c.nom)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Notes</label><textarea id="f-notes-carret" rows="2">${existing ? escapeHtml(existing.notes || '') : ''}</textarea></div>
    <div class="modal-actions">
      ${existing ? `<button class="btn danger" onclick="deleteCarret('${id}')">Eliminar</button>` : ''}
      <button class="btn primary" onclick="saveCarret('${id || ''}')">Desar</button>
    </div>
    ${existing ? `<button class="btn full ghost" style="margin-top:8px" onclick="duplicarCarret('${id}')">⎘ Duplicar carret</button>` : ''}
    ${existing ? `<button class="fab-modal" onclick="obrirFormFotograma()" title="Apuntar foto ràpid">+</button>` : ''}
  `);

  if (existing) iniciarMapaExposicions(fotogrames);

  if (!cameresJaCarregades) {
    const { data } = await sb.from('equipament').select('*').eq('tipus', 'camera').eq('tipus_captura', 'analogica');
    const select = document.getElementById('f-camera');
    if (select && data?.length) {
      select.innerHTML = `<option value="">— Cap —</option>` +
        data.map(c => `<option value="${c.id}" ${existing?.camera_id === c.id ? 'selected' : ''}>${escapeHtml(c.nom)}</option>`).join('');
    }
  }
}

function buildHeroHtml(carret, fotogrames) {
  const total = carret.fotogrames || null;
  const fetes = fotogrames.length;
  const pct = total ? Math.min(100, Math.round((fetes / total) * 100)) : 0;
  const pushPull = carret.iso_forcat && carret.iso && carret.iso_forcat !== carret.iso
    ? etiquetaPushPull(carret.iso, carret.iso_forcat)
    : 'Normal';
  const camera = cache.equipament.find(e => e.id === carret.camera_id);
  const enCurs = carret.estat === 'carregat' || carret.estat === 'exposat_parcial';

  return `
    <div class="hero-carret">
      <div class="hero-badge ${enCurs ? '' : 'warn-badge'}"><span class="dot"></span> ${ESTAT_CARRET_LABEL[carret.estat]}</div>
      <div class="hero-top">
        <div class="hero-count">
          <span class="big">${fetes}</span>${total ? `<span class="small">/${total}</span>` : ''}
        </div>
        <button class="quick-shot-btn" onclick="obrirFormFotograma()">📷 Apuntar foto</button>
      </div>
      ${total ? `<div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
      <div class="hero-meta-row">
        <div class="hero-meta"><div class="label">Format</div><div class="value">${carret.format}</div></div>
        <div class="hero-meta"><div class="label">ISO</div><div class="value">${carret.iso || '—'}</div></div>
        <div class="hero-meta"><div class="label">Push/Pull</div><div class="value">${pushPull}</div></div>
        <div class="hero-meta"><div class="label">Càmera</div><div class="value">${camera ? escapeHtml(camera.nom) : '—'}</div></div>
      </div>
    </div>
  `;
}

async function enviarARevelar(id) {
  const { error } = await sb.from('carrets').update({ estat: 'exposat' }).eq('id', id);
  if (error) { toast(ERROR_DESAR); console.error(error); return; }
  toast('Carret marcat com a exposat, pendent de revelar.');
  await loadCarrets();
  openCarretForm(id);
}

function onCanviFilmStock(nom) {
  const stock = trobarFilmStock(nom);
  if (!stock) return;
  document.getElementById('f-iso').value = stock.iso;
  document.getElementById('f-tipus-pel').value = stock.tipus;
  if (stock.formats?.length && !stock.formats.includes(document.getElementById('f-format').value)) {
    document.getElementById('f-format').value = stock.formats[0];
  }
  const exposicions = suggerirExposicions(stock, document.getElementById('f-format').value);
  if (exposicions) document.getElementById('f-fotogrames').value = exposicions;
}

function onCanviFormatCarret(format) {
  const stock = trobarFilmStock(document.getElementById('f-marca').value);
  const exposicions = suggerirExposicions(stock, format);
  if (exposicions) document.getElementById('f-fotogrames').value = exposicions;
}

function obrirDirectoriPellicules() {
  const contingutPrevi = modalContent.innerHTML;
  window.__prevFormHtml = contingutPrevi;
  openModal(`
    <h2>Directori de pel·lícules</h2>
    <div class="field"><input id="directori-cerca" placeholder="Cerca (Kodak, Ilford, Portra...)" oninput="filtrarDirectoriPellicules(this.value)" autofocus></div>
    <div id="directori-llista" style="max-height:60vh;overflow-y:auto"></div>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn full ghost" onclick="modalContent.innerHTML = window.__prevFormHtml">Cancel·lar</button>
    </div>
  `);
  filtrarDirectoriPellicules('');
}

function filtrarDirectoriPellicules(text) {
  const cont = document.getElementById('directori-llista');
  const net = text.trim().toLowerCase();
  const resultats = net
    ? FILM_STOCKS.filter(f => f.nom.toLowerCase().includes(net))
    : FILM_STOCKS;
  if (!resultats.length) {
    cont.innerHTML = `<p class="item-meta" style="padding:12px 0">Cap resultat.</p>`;
    return;
  }
  cont.innerHTML = resultats.map(f => `
    <div class="event-row" style="cursor:pointer" onclick="triarPellicula('${f.nom.replace(/'/g, "\\'")}')">
      <div style="flex:1">
        <p class="event-title">${escapeHtml(f.nom)}</p>
        <p class="event-time">ISO ${f.iso} · ${f.tipus === 'bn' ? 'B/N' : 'Color'} · ${f.formats.join(' / ')}</p>
      </div>
    </div>
  `).join('');
}

function triarPellicula(nom) {
  modalContent.innerHTML = window.__prevFormHtml;
  document.getElementById('f-marca').value = nom;
  onCanviFilmStock(nom);
}

async function saveCarret(id) {
  const isoForcatVal = document.getElementById('f-iso-forcat').value;
  const payload = {
    titol: document.getElementById('f-titol').value.trim() || null,
    marca_model: document.getElementById('f-marca').value.trim(),
    format: document.getElementById('f-format').value,
    tipus_pelicula: document.getElementById('f-tipus-pel').value,
    iso: Number(document.getElementById('f-iso').value) || null,
    iso_forcat: isoForcatVal === '' ? null : Number(isoForcatVal),
    fotogrames: Number(document.getElementById('f-fotogrames').value) || null,
    estat: document.getElementById('f-estat-carret').value,
    camera_id: document.getElementById('f-camera')?.value || null,
    notes: document.getElementById('f-notes-carret').value.trim()
  };
  if (!payload.marca_model) return;
  const saved = await dbUpsert('carrets', id, payload);
  if (!saved) return;
  if (id) {
    closeModal();
    loadCarrets();
  } else {
    await loadCarrets();
    openCarretForm(saved.id);
  }
}

async function deleteCarret(id) {
  if (!await dbRemove('carrets', id)) return;
  closeModal();
  loadCarrets();
}

async function duplicarCarret(id) {
  const original = cache.carrets.find(c => c.id === id);
  if (!original) return;
  const { titol, marca_model, format, tipus_pelicula, iso, fotogrames } = original;
  const { data, error } = await sb.from('carrets').insert({
    titol, marca_model, format, tipus_pelicula, iso, fotogrames,
    estat: 'sense_estrenar', camera_id: null, notes: null
  }).select().single();
  if (error) { console.error(error); return; }
  await loadCarrets();
  openCarretForm(data.id);
}

const ETIQUETA_COLOR = { keeper: '#5fae6b', mistake: '#c65a4a', unsure: '#d3922f' };
const ETIQUETA_LABEL = { keeper: 'Keeper', mistake: 'Error', unsure: 'Dubte' };

function buildFotogramesListHtml(fotogrames, carretId) {
  if (!fotogrames.length) return `<p class="item-meta">Encara cap foto apuntada.</p>`;
  return fotogrames.map(f => {
    const tecnica = [f.diafragma, f.velocitat].filter(Boolean).join(' · ');
    const punt = f.etiqueta && ETIQUETA_COLOR[f.etiqueta] ? `<span class="fotograma-tag-dot" style="background:${ETIQUETA_COLOR[f.etiqueta]}"></span>` : '';
    return `
    <div class="fotograma-card" onclick="obrirFormFotograma('${f.id}')">
      <div class="fotograma-num">${f.numero ? String(f.numero).padStart(2, '0') : '—'}</div>
      <div class="fotograma-body">
        <p class="fotograma-desc">${punt}${escapeHtml(f.descripcio || '(sense descripció)')}</p>
        <p class="fotograma-meta">${formatDayLabel(f.data)}${tecnica ? ' · ' + escapeHtml(tecnica) : ''}${f.lloc ? ' · ' + escapeHtml(f.lloc) : (f.lat ? ` · ${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}` : '')}</p>
      </div>
      <button class="link-btn" onclick="event.stopPropagation(); eliminarFotograma('${f.id}', '${carretId}')">×</button>
    </div>
  `;
  }).join('');
}

function buildMapReservationHtml(fotogrames) {
  const ambUbicacio = fotogrames.filter(f => f.lat && f.lng);
  if (!ambUbicacio.length) return '';
  return `
    <div class="section-title" style="margin-top:26px">Mapa d'exposicions</div>
    <div id="mapa-exposicions" style="width:100%;height:190px;border-radius:var(--radius);overflow:hidden;background:var(--surface-2)"></div>
  `;
}

// Carrega Leaflet un sol cop (deduplica càrregues simultànies) i el reutilitza
// a totes les instàncies de mapa de l'app.
function carregarLeaflet() {
  if (window.L) return Promise.resolve();
  if (window.__leafletLoading) return window.__leafletLoading;
  window.__leafletLoading = new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = resolve;
    document.body.appendChild(script);
  });
  return window.__leafletLoading;
}

function iniciarMapaExposicions(fotogrames) {
  const ambUbicacio = fotogrames.filter(f => f.lat && f.lng);
  if (!ambUbicacio.length) return;
  const el = document.getElementById('mapa-exposicions');
  if (!el) return;

  carregarLeaflet().then(() => {
    // El modal es pot haver tancat mentre carregava la llibreria
    if (!document.getElementById('mapa-exposicions')) return;
    if (window.__mapaExposicionsInstance) {
      window.__mapaExposicionsInstance.remove();
      window.__mapaExposicionsInstance = null;
    }
    const mapa = L.map('mapa-exposicions');
    window.__mapaExposicionsInstance = mapa;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapa);
    const punts = ambUbicacio.map(f => {
      const m = L.marker([f.lat, f.lng]).addTo(mapa);
      m.bindPopup(`#${f.numero || '?'} — ${(f.descripcio || 'Sense descripció').replace(/</g, '')}`);
      return [f.lat, f.lng];
    });
    if (punts.length === 1) mapa.setView(punts[0], 14);
    else mapa.fitBounds(punts, { padding: [24, 24] });
  });
}

function obrirFormFotograma(fotogramaId) {
  const carretId = window.__currentCarretId;
  const existing = fotogramaId ? (window.__fotogramesCache || []).find(f => f.id === fotogramaId) : null;
  openModal(`
    <h2>${existing ? `Fotograma #${existing.numero || '?'}` : 'Apuntar una foto'}</h2>
    <div class="field"><label>Data</label><input id="fg-data" type="date" value="${existing?.data || dateKey(new Date())}"></div>
    <div class="field"><label>Descripció</label><textarea id="fg-desc" rows="2" placeholder="Retrat a contrallum, plaça del poble...">${existing ? escapeHtml(existing.descripcio || '') : ''}</textarea></div>
    <div class="field-row">
      <div class="field">
        <label>Diafragma</label>
        <input id="fg-diafragma" list="diafragmes-list" placeholder="f/5.6" value="${existing?.diafragma ? escapeHtml(existing.diafragma) : ''}">
        <datalist id="diafragmes-list">${['f/1.4','f/2','f/2.8','f/4','f/5.6','f/8','f/11','f/16','f/22'].map(v => `<option value="${v}">`).join('')}</datalist>
      </div>
      <div class="field">
        <label>Velocitat</label>
        <input id="fg-velocitat" list="velocitats-list" placeholder="1/250" value="${existing?.velocitat ? escapeHtml(existing.velocitat) : ''}">
        <datalist id="velocitats-list">${['1/1000','1/500','1/250','1/125','1/60','1/30','1/15','1/8','1/4','1/2','1"'].map(v => `<option value="${v}">`).join('')}</datalist>
      </div>
    </div>
    <div class="field">
      <label>Etiqueta (opcional)</label>
      <div style="display:flex;gap:8px" id="fg-etiqueta-picker">
        ${Object.entries(ETIQUETA_LABEL).map(([v, l]) => `
          <button type="button" class="btn small fg-etiqueta-btn ${existing?.etiqueta === v ? 'primary' : ''}" data-v="${v}" onclick="triarEtiquetaFotograma('${v}')" style="flex:1;display:flex;align-items:center;justify-content:center;gap:5px">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ETIQUETA_COLOR[v]}"></span>${l}
          </button>
        `).join('')}
      </div>
      <input type="hidden" id="fg-etiqueta" value="${existing?.etiqueta || ''}">
    </div>
    <div class="field">
      <label>Ubicació</label>
      <input id="fg-lloc" placeholder="Nom del lloc (opcional)" value="${existing?.lloc ? escapeHtml(existing.lloc) : ''}">
      <div style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="btn small" onclick="usarUbicacioActual()">📍 Ubicació actual</button>
        <button type="button" class="btn small" onclick="triarAlMapa()">🗺 Triar al mapa</button>
      </div>
      <p class="item-meta" id="fg-coords" style="margin-top:6px">${existing?.lat ? `📍 ${Number(existing.lat).toFixed(5)}, ${Number(existing.lng).toFixed(5)}` : ''}</p>
      <input type="hidden" id="fg-lat" value="${existing?.lat ?? ''}">
      <input type="hidden" id="fg-lng" value="${existing?.lng ?? ''}">
    </div>
    <div class="modal-actions">
      ${existing ? `<button class="btn danger" onclick="eliminarFotograma('${existing.id}', '${carretId}')">Eliminar</button>` : ''}
      <button class="btn primary" onclick="desarFotograma('${existing ? existing.id : ''}')">Desar</button>
    </div>
  `);
}

function triarEtiquetaFotograma(valor) {
  const actual = document.getElementById('fg-etiqueta').value;
  const nou = actual === valor ? '' : valor;
  document.getElementById('fg-etiqueta').value = nou;
  document.querySelectorAll('.fg-etiqueta-btn').forEach(b => {
    b.classList.toggle('primary', b.dataset.v === nou);
  });
}

function usarUbicacioActual() {
  if (!navigator.geolocation) { toast('Aquest navegador no permet obtenir la ubicació.'); return; }
  const coordsEl = document.getElementById('fg-coords');
  coordsEl.textContent = 'Obtenint ubicació…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('fg-lat').value = pos.coords.latitude;
      document.getElementById('fg-lng').value = pos.coords.longitude;
      coordsEl.textContent = `📍 ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
    },
    () => { coordsEl.textContent = 'No s\'ha pogut obtenir la ubicació (revisa els permisos).'; },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function triarAlMapa() {
  const contingutPrevi = modalContent.innerHTML;
  openModal(`
    <h2>Tria el punt al mapa</h2>
    <div id="mapa-picker" style="width:100%;height:340px;border-radius:var(--radius);overflow:hidden;background:var(--surface-2)"></div>
    <p class="item-meta" style="margin-top:8px">Toca el mapa per marcar el lloc.</p>
    <div class="modal-actions">
      <button class="btn full ghost" onclick="modalContent.innerHTML = window.__prevFormHtml; reactivarFormFotograma()">Cancel·lar</button>
      <button class="btn primary full" id="btn-confirmar-mapa" style="display:none" onclick="confirmarPuntMapa()">Confirmar aquest punt</button>
    </div>
  `);
  window.__prevFormHtml = contingutPrevi;

  carregarLeaflet().then(() => {
    if (!document.getElementById('mapa-picker')) return;
    if (window.__mapaPickerInstance) {
      window.__mapaPickerInstance.remove();
      window.__mapaPickerInstance = null;
    }
    const centre = [41.3874, 2.1686]; // Barcelona per defecte
    const mapa = L.map('mapa-picker').setView(centre, 13);
    window.__mapaPickerInstance = mapa;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapa);
    let marker = null;
    mapa.on('click', (e) => {
      if (marker) mapa.removeLayer(marker);
      marker = L.marker(e.latlng).addTo(mapa);
      window.__mapaPickerLatLng = e.latlng;
      document.getElementById('btn-confirmar-mapa').style.display = 'block';
    });
  });
}

function reactivarFormFotograma() {
  // Els listeners inline (onclick) ja funcionen perquè són atributs HTML, no cal re-adjuntar res.
}

function confirmarPuntMapa() {
  const ll = window.__mapaPickerLatLng;
  modalContent.innerHTML = window.__prevFormHtml;
  if (ll) {
    document.getElementById('fg-lat').value = ll.lat;
    document.getElementById('fg-lng').value = ll.lng;
    document.getElementById('fg-coords').textContent = `📍 ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
  }
}

async function desarFotograma(fotogramaId) {
  const carretId = window.__currentCarretId;
  const camps = {
    data: document.getElementById('fg-data').value || dateKey(new Date()),
    descripcio: document.getElementById('fg-desc').value.trim(),
    diafragma: document.getElementById('fg-diafragma').value.trim() || null,
    velocitat: document.getElementById('fg-velocitat').value.trim() || null,
    etiqueta: document.getElementById('fg-etiqueta').value || null,
    lloc: document.getElementById('fg-lloc').value.trim() || null,
    lat: document.getElementById('fg-lat').value || null,
    lng: document.getElementById('fg-lng').value || null
  };
  if (fotogramaId) {
    if (!await dbUpsert('fotogrames', fotogramaId, camps)) return;
  } else {
    const { count } = await sb.from('fotogrames').select('*', { count: 'exact', head: true }).eq('carret_id', carretId);
    const payload = { ...camps, carret_id: carretId, numero: (count || 0) + 1 };
    if (!await dbUpsert('fotogrames', null, payload)) return;
  }
  openCarretForm(carretId);
}

async function obrirFormBatchFotogrames() {
  const carretId = window.__currentCarretId;
  const carret = cache.carrets.find(c => c.id === carretId);
  const { count } = await sb.from('fotogrames').select('*', { count: 'exact', head: true }).eq('carret_id', carretId);
  const seguent = (count || 0) + 1;
  const suggerit = carret?.fotogrames ? Math.max(1, carret.fotogrames - (count || 0)) : 12;
  openModal(`
    <h2>Afegir diverses fotos</h2>
    <p class="item-meta" style="margin-bottom:10px">Es crearan del fotograma #${seguent} en endavant, totes amb la mateixa data i ubicació (les pots editar una a una després).</p>
    <div class="field"><label>Quantes fotos</label><input id="fb-quantitat" type="number" min="1" value="${suggerit}"></div>
    <div class="field"><label>Data</label><input id="fb-data" type="date" value="${dateKey(new Date())}"></div>
    <div class="field"><label>Descripció comuna (opcional)</label><input id="fb-desc" placeholder="Sessió al carrer, Barcelona..."></div>
    <div class="field">
      <label>Ubicació comuna (opcional)</label>
      <input id="fb-lloc" placeholder="Nom del lloc">
      <button type="button" class="btn small" style="margin-top:8px" onclick="usarUbicacioActualBatch()">📍 Ubicació actual</button>
      <p class="item-meta" id="fb-coords" style="margin-top:6px"></p>
      <input type="hidden" id="fb-lat">
      <input type="hidden" id="fb-lng">
    </div>
    <div class="modal-actions">
      <button class="btn primary full" onclick="confirmarBatchFotogrames()">Crear-les</button>
    </div>
  `);
}

function usarUbicacioActualBatch() {
  if (!navigator.geolocation) { toast('Aquest navegador no permet obtenir la ubicació.'); return; }
  const coordsEl = document.getElementById('fb-coords');
  coordsEl.textContent = 'Obtenint ubicació…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('fb-lat').value = pos.coords.latitude;
      document.getElementById('fb-lng').value = pos.coords.longitude;
      coordsEl.textContent = `📍 ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
    },
    () => { coordsEl.textContent = 'No s\'ha pogut obtenir la ubicació.'; },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

async function confirmarBatchFotogrames() {
  const carretId = window.__currentCarretId;
  const quantitat = Math.max(1, Number(document.getElementById('fb-quantitat').value) || 1);
  const { count } = await sb.from('fotogrames').select('*', { count: 'exact', head: true }).eq('carret_id', carretId);
  const inici = (count || 0) + 1;
  const base = {
    carret_id: carretId,
    data: document.getElementById('fb-data').value || dateKey(new Date()),
    descripcio: document.getElementById('fb-desc').value.trim(),
    lloc: document.getElementById('fb-lloc').value.trim() || null,
    lat: document.getElementById('fb-lat').value || null,
    lng: document.getElementById('fb-lng').value || null
  };
  const registres = Array.from({ length: quantitat }, (_, i) => ({ ...base, numero: inici + i }));
  await sb.from('fotogrames').insert(registres);
  openCarretForm(carretId);
}

async function eliminarFotograma(id, carretId) {
  if (!await dbRemove('fotogrames', id, 'Segur que vols eliminar aquest fotograma?')) return;
  openCarretForm(carretId);
}

// ============ TARGETES SD ============
async function loadSd() {
  if (!cache.sd.length) mostrarSkeleton('sd-list');
  const { data, error } = await sb.from('targetes_sd').select('*').order('nom');
  if (error) { console.error(error); return; }
  cache.sd = data;
  document.getElementById('sd-count').textContent = data.length;
  const list = document.getElementById('sd-list');
  document.getElementById('sd-empty').style.display = data.length ? 'none' : 'block';
  list.innerHTML = data.map(s => {
    const pct = s.capacitat_gb > 0 ? Math.min(100, Math.round((s.ocupat_gb / s.capacitat_gb) * 100)) : 0;
    return `
    <div class="frame ${s.buidada ? '' : 'warn'}">
      <div class="item-row">
        <div class="item-main" onclick="openSdForm('${s.id}')">
          <p class="item-name">${escapeHtml(s.nom)}</p>
          <p class="item-meta">${s.ocupat_gb} GB / ${s.capacitat_gb} GB${s.usos ? ' · ' + s.usos + ' buidatge' + (s.usos === 1 ? '' : 's') : ''}</p>
        </div>
        <div class="ring-toggle ${s.buidada ? 'on' : ''}" onclick="toggleSdBuidada('${s.id}', ${!s.buidada})">
          <span class="ring-label">${s.buidada ? 'OK' : '·'}</span>
        </div>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

async function toggleSdBuidada(id, nouEstat) {
  const payload = { buidada: nouEstat, actualitzat_el: new Date().toISOString() };
  if (nouEstat) payload.ocupat_gb = 0;
  await sb.from('targetes_sd').update(payload).eq('id', id);
  loadSd();
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
    <div class="field"><label>Usos (opcional, l'ajustes tu quan vulguis)</label><input id="f-usos" type="number" min="0" value="${existing?.usos || 0}"></div>
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
    usos: Number(document.getElementById('f-usos').value) || 0,
    actualitzat_el: new Date().toISOString()
  };
  if (!payload.nom) return;
  if (!await dbUpsert('targetes_sd', id, payload)) return;
  closeModal();
  loadSd();
}

async function deleteSd(id) {
  if (!await dbRemove('targetes_sd', id)) return;
  closeModal();
  loadSd();
}

// ============ PROJECTES ============
let projFiltre = 'tots';
const ESTAT_LABEL = { en_curs: 'En curs', edicio: 'Edició', entregat: 'Entregat', cancelat: 'Cancel·lat' };

function setProjFiltre(estat) {
  projFiltre = estat;
  renderProjectChips();
  renderProjectes();
}

async function loadProjectes() {
  if (!cache.projectes.length) mostrarSkeleton('proj-list');
  const { data, error } = await sb.from('projectes').select('*, esdeveniments(id, dia, titol)').order('data_entrega', { nullsFirst: false });
  if (error) { console.error(error); return; }
  cache.projectes = data;
  renderProjectChips();
  renderProjectes();
}

function renderProjectChips() {
  const chips = document.getElementById('proj-status-chips');
  const opcions = [['tots', 'Tots'], ['en_curs', 'En curs'], ['edicio', 'Edició'], ['entregat', 'Entregat'], ['cancelat', 'Cancel·lat']];
  chips.innerHTML = opcions.map(([val, label]) => `<button class="chip ${projFiltre === val ? 'active' : ''}" data-estat="${val}" onclick="setProjFiltre('${val}')">${label}</button>`).join('');
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
  const [equipamentRes, targetesRes] = await Promise.all([
    cache.equipament.length ? Promise.resolve({ data: cache.equipament }) : sb.from('equipament').select('*').order('nom'),
    cache.sd.length ? Promise.resolve({ data: cache.sd }) : sb.from('targetes_sd').select('*').order('nom')
  ]);
  const equipament = equipamentRes.data || [];
  const targetes = targetesRes.data || [];
  let vinculatsEquip = new Set();
  let vinculatsSd = new Set();
  if (existing) {
    const [{ data: eqData }, { data: sdData }] = await Promise.all([
      sb.from('projecte_equipament').select('equipament_id').eq('projecte_id', existing.id),
      sb.from('projecte_targetes_sd').select('targeta_id').eq('projecte_id', existing.id)
    ]);
    vinculatsEquip = new Set((eqData || []).map(r => r.equipament_id));
    vinculatsSd = new Set((sdData || []).map(r => r.targeta_id));
  }
  const cont = document.getElementById('equip-checklist');
  if (!equipament.length && !targetes.length) {
    cont.innerHTML = `<p class="item-meta">Encara no tens equipament registrat.</p>`;
    return;
  }

  const grupHtml = (titol, items, checkClass, getId, getNom, checkedSet) => {
    if (!items.length) return '';
    return `
      <p style="font-family:var(--mono);font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-faint);margin:12px 0 4px">${titol}</p>
      ${items.map(item => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 0">
          <input type="checkbox" class="${checkClass}" value="${getId(item)}" ${checkedSet.has(getId(item)) ? 'checked' : ''} style="width:auto">
          <span style="font-size:14px">${escapeHtml(getNom(item))}</span>
        </label>
      `).join('')}
    `;
  };

  const cameres = equipament.filter(e => e.tipus === 'camera');
  const objectius = equipament.filter(e => e.tipus === 'objectiu');
  const altres = equipament.filter(e => e.tipus !== 'camera' && e.tipus !== 'objectiu');

  cont.innerHTML =
    grupHtml('Càmeres', cameres, 'equip-check', e => e.id, e => e.nom, vinculatsEquip) +
    grupHtml('Objectius', objectius, 'equip-check', e => e.id, e => e.nom, vinculatsEquip) +
    grupHtml('SD', targetes, 'sd-check', s => s.id, s => s.nom, vinculatsSd) +
    grupHtml('Accessoris', altres, 'equip-check', e => e.id, e => e.nom, vinculatsEquip);
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
  if (!id) { toast('Primer desa el projecte i torna a editar-lo per afegir sessions.'); return; }
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
  const saved = await dbUpsert('projectes', id, payload);
  if (!saved) return;
  await desarEquipamentVinculat(saved.id);
  if (id) {
    closeModal();
    loadProjectes();
  } else {
    await loadProjectes();
    // Reobrim el formulari ja com a edició, amb el botó "Desar" ben vinculat al nou id
    openProjecteForm(saved.id);
  }
}

async function desarEquipamentVinculat(projecteId) {
  const seleccionats = [...document.querySelectorAll('.equip-check:checked')].map(el => el.value);
  const sdSeleccionades = [...document.querySelectorAll('.sd-check:checked')].map(el => el.value);
  await sb.from('projecte_equipament').delete().eq('projecte_id', projecteId);
  await sb.from('projecte_targetes_sd').delete().eq('projecte_id', projecteId);
  if (seleccionats.length) {
    await sb.from('projecte_equipament').insert(seleccionats.map(eqId => ({ projecte_id: projecteId, equipament_id: eqId })));
  }
  if (sdSeleccionades.length) {
    await sb.from('projecte_targetes_sd').insert(sdSeleccionades.map(sdId => ({ projecte_id: projecteId, targeta_id: sdId })));
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
  navigator.clipboard.writeText(url).then(() => toast('Enllaç de només lectura copiat:\n' + url));
}

async function deleteProjecte(id) {
  if (!await dbRemove('projectes', id)) return;
  closeModal();
  loadProjectes();
}

// ============ PRESSUPOSTOS ============
async function loadPressupostos() {
  if (!cache.pressupostos.length) mostrarSkeleton('pres-list');
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
  const saved = await dbUpsert('pressupostos', id, payload);
  if (!saved) return;
  const presId = saved.id;
  if (id) await sb.from('pressupost_linies').delete().eq('pressupost_id', id);
  const linies = currentLinies.filter(l => l.concepte.trim()).map((l, i) => ({
    pressupost_id: presId, concepte: l.concepte.trim(), quantitat: l.quantitat, preu_unitat: l.preu_unitat, ordre: i
  }));
  if (linies.length) await sb.from('pressupost_linies').insert(linies);
  closeModal();
  loadPressupostos();
}

async function deletePressupost(id) {
  if (!await dbRemove('pressupostos', id)) return;
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
  navigator.clipboard.writeText(text).then(() => toast('Resum copiat al porta-retalls'));
}

// ============ TASQUES ============
let taskFiltre = 'pendents';

function setTaskFiltre(val) {
  taskFiltre = val;
  renderTaskChips();
  renderTasques();
}

function renderTaskChips() {
  const chips = document.getElementById('task-status-chips');
  const opcions = [['pendents', 'Pendents'], ['fetes', 'Fetes'], ['totes', 'Totes']];
  chips.innerHTML = opcions.map(([val, label]) => `<button class="chip ${taskFiltre === val ? 'active' : ''}" onclick="setTaskFiltre('${val}')">${label}</button>`).join('');
}

async function loadTasques() {
  if (!cache.tasques.length) mostrarSkeleton('task-list');
  const { data, error } = await sb.from('tasques').select('*, projectes(nom)').order('data_venciment', { nullsFirst: false }).order('creat_el', { ascending: false });
  if (error) { console.error(error); return; }
  cache.tasques = data;
  renderTaskChips();
  renderTasques();
}

function renderTasques() {
  let data = cache.tasques;
  if (taskFiltre === 'pendents') data = data.filter(t => !t.feta);
  else if (taskFiltre === 'fetes') data = data.filter(t => t.feta);
  document.getElementById('task-count').textContent = data.length;
  const list = document.getElementById('task-list');
  document.getElementById('task-empty').style.display = data.length ? 'none' : 'block';
  list.innerHTML = data.map(t => `
    <div class="frame ${!t.feta && t.data_venciment && t.data_venciment < dateKey(new Date()) ? 'warn' : ''}">
      <div class="item-row">
        <div class="item-main" onclick="openTaskForm('${t.id}')">
          <p class="item-name" style="${t.feta ? 'text-decoration:line-through;color:var(--text-faint)' : ''}">${escapeHtml(t.titol)}</p>
          <p class="item-meta">${t.projectes ? escapeHtml(t.projectes.nom) + ' · ' : ''}${t.data_venciment ? formatDate(t.data_venciment) : 'Sense data'}${t.google_task_id ? ' · sincronitzada' : ''}</p>
        </div>
        <div class="ring-toggle ${t.feta ? 'on' : ''}" onclick="toggleTaskFeta('${t.id}', ${!t.feta})">
          <span class="ring-label">${t.feta ? 'OK' : '·'}</span>
        </div>
      </div>
    </div>
  `).join('');
}

async function toggleTaskFeta(id, nouEstat) {
  await sb.from('tasques').update({ feta: nouEstat }).eq('id', id);
  loadTasques();
}

async function openTaskForm(id) {
  const existing = id ? cache.tasques.find(t => t.id === id) : null;
  const projOpts = cache.projectes.length ? cache.projectes : (await sb.from('projectes').select('id,nom')).data || [];
  openModal(`
    <h2>${existing ? 'Editar tasca' : 'Nova tasca'}</h2>
    <div class="field"><label>Títol</label><input id="tk-titol" value="${existing ? escapeHtml(existing.titol) : ''}" placeholder="Enviar pressupost a la Marta"></div>
    <div class="field"><label>Data de venciment (opcional)</label><input id="tk-data" type="date" value="${existing?.data_venciment || ''}"></div>
    <div class="field">
      <label>Projecte vinculat</label>
      <select id="tk-projecte">
        <option value="">— Cap —</option>
        ${projOpts.map(p => `<option value="${p.id}" ${existing?.projecte_id === p.id ? 'selected' : ''}>${escapeHtml(p.nom)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Descripció</label><textarea id="tk-desc" rows="2">${existing ? escapeHtml(existing.descripcio || '') : ''}</textarea></div>
    <div class="modal-actions">
      ${existing ? `<button class="btn danger" onclick="deleteTask('${id}')">Eliminar</button>` : ''}
      <button class="btn primary" onclick="saveTask('${id || ''}')">Desar</button>
    </div>
  `);
}

async function saveTask(id) {
  const payload = {
    titol: document.getElementById('tk-titol').value.trim(),
    data_venciment: document.getElementById('tk-data').value || null,
    projecte_id: document.getElementById('tk-projecte').value || null,
    descripcio: document.getElementById('tk-desc').value.trim()
  };
  if (!payload.titol) return;
  if (!await dbUpsert('tasques', id, payload)) return;
  closeModal();
  loadTasques();
}

async function deleteTask(id) {
  if (!await dbRemove('tasques', id)) return;
  closeModal();
  loadTasques();
}

async function syncAllTasquesGoogle() {
  const pendents = cache.tasques.filter(t => !t.google_task_id);
  if (!pendents.length) {
    toast(cache.tasques.length ? 'Totes les tasques ja estan sincronitzades.' : 'Encara no tens cap tasca creada.');
    return;
  }
  const ok = await confirmDialog(`Sincronitzar ${pendents.length} tasca(ques) amb Google Tasks?`);
  if (!ok) return;
  let fets = 0;
  await executarEnLots(pendents, async (t) => {
    const created = await GCal.pushTask({ title: t.titol, notes: t.descripcio, dueDate: t.data_venciment });
    if (created && created.id) {
      await sb.from('tasques').update({ google_task_id: created.id }).eq('id', t.id);
      fets++;
    }
  });
  toast(`Sincronitzades ${fets} de ${pendents.length} tasques.`);
  loadTasques();
}

async function importTasquesGoogle() {
  openModal(`<h2>Important…</h2><p class="item-meta">Consultant les teves Google Tasks…</p>`);
  const trobades = await GCal.pullTasks();
  if (!trobades.length) {
    openModal(`<h2>Importar de Google Tasks</h2><p class="item-meta">No s'ha trobat cap tasca (o no s'ha pogut connectar).</p><div class="modal-actions"><button class="btn full" onclick="closeModal()">Tancar</button></div>`);
    return;
  }
  const yaImportades = new Set(cache.tasques.filter(t => t.google_task_id).map(t => t.google_task_id));
  const noves = trobades.filter(t => !yaImportades.has(t.googleId));
  if (!noves.length) {
    openModal(`<h2>Importar de Google Tasks</h2><p class="item-meta">Totes les teves tasques de Google ja estan importades.</p><div class="modal-actions"><button class="btn full" onclick="closeModal()">Tancar</button></div>`);
    return;
  }
  window.__importTasquesCandidats = noves;
  openModal(`
    <h2>Tria quines importar</h2>
    <button class="btn primary full" id="btn-importar-tasques" onclick="confirmarImportTasques()" style="margin-bottom:10px" disabled>Importar seleccionades (0)</button>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <button class="btn small ghost" onclick="marcarTotesTasques(true)">Seleccionar totes</button>
      <button class="btn small ghost" onclick="marcarTotesTasques(false)">Cap</button>
    </div>
    <div id="import-tasques-list">
      ${noves.map((t, i) => `
        <div class="event-row">
          <input type="checkbox" class="import-tasca-check" data-i="${i}" onchange="actualitzarComptadorTasques()" style="width:auto">
          <div style="flex:1;min-width:0">
            <p class="event-title">${escapeHtml(t.title)}${t.feta ? ' ✓' : ''}</p>
            <p class="event-time">${t.due ? formatDate(t.due) : 'Sense data'}</p>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="modal-actions"><button class="btn full ghost" onclick="closeModal()">Cancel·lar</button></div>
  `);
}

function marcarTotesTasques(valor) {
  document.querySelectorAll('.import-tasca-check').forEach(el => { el.checked = valor; });
  actualitzarComptadorTasques();
}

function actualitzarComptadorTasques() {
  const n = document.querySelectorAll('.import-tasca-check:checked').length;
  const btn = document.getElementById('btn-importar-tasques');
  if (!btn) return;
  btn.textContent = `Importar seleccionades (${n})`;
  btn.disabled = n === 0;
}

async function confirmarImportTasques() {
  const candidates = window.__importTasquesCandidats || [];
  const seleccionades = new Set([...document.querySelectorAll('.import-tasca-check:checked')].map(el => Number(el.dataset.i)));
  if (!seleccionades.size) return;
  const registres = candidates
    .map((t, i) => ({ t, i }))
    .filter(({ i }) => seleccionades.has(i))
    .map(({ t }) => ({
      titol: t.title,
      descripcio: t.notes || null,
      data_venciment: t.due,
      feta: t.feta,
      google_task_id: t.googleId
    }));
  if (registres.length) await sb.from('tasques').insert(registres);
  closeModal();
  loadTasques();
}

// ---------- Backup ----------
async function descarregarBackup() {
  const taules = ['equipament', 'bateries', 'targetes_sd', 'projectes', 'pressupostos', 'pressupost_linies', 'esdeveniments', 'projecte_equipament', 'carrets', 'fotogrames', 'projecte_targetes_sd', 'tasques'];
  const backup = { generat_el: new Date().toISOString() };
  for (const t of taules) {
    const { data, error } = await sb.from(t).select('*');
    backup[t] = error ? [] : data;
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fotografia-backup-${dateKey(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  switchView('projectes');
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
