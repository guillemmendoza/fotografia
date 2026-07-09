// Connexió amb Google Calendar via OAuth implicit (Google Identity Services)
const GCal = (() => {
  let tokenClient = null;
  let accessToken = null;
  let eventColors = null;
  let allEvents = [];
  let onlyFotografia = false;
  let currentMonth = startOfMonth(new Date());
  let selectedDay = null; // 'YYYY-MM-DD' o null

  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function dateKey(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  function init() {
    if (!CONFIG.googleClientId) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: CONFIG.googleScopes,
      callback: (resp) => {
        if (resp.access_token) {
          accessToken = resp.access_token;
          sessionStorage.setItem('gcal_token', accessToken);
          sessionStorage.setItem('gcal_token_exp', String(Date.now() + 3500 * 1000));
          onConnected();
        }
      }
    });

    const saved = sessionStorage.getItem('gcal_token');
    const exp = Number(sessionStorage.getItem('gcal_token_exp') || 0);
    if (saved && Date.now() < exp) {
      accessToken = saved;
      onConnected();
    }
  }

  function connect() {
    if (!CONFIG.googleClientId) {
      alert('Encara falta configurar el Client ID de Google a config.js');
      return;
    }
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  }

  function isConnected() {
    return !!accessToken;
  }

  function onConnected() {
    document.getElementById('cal-disconnected').style.display = 'none';
    document.getElementById('cal-connected').style.display = 'block';
    loadColors().then(loadEvents);
  }

  async function loadColors() {
    if (eventColors) return;
    try {
      const res = await fetch('https://www.googleapis.com/calendar/v3/colors', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      eventColors = data.event || {};
    } catch (e) {
      eventColors = {};
    }
  }

  function toggleOnlyFotografia(val) {
    onlyFotografia = val;
    render();
  }

  function changeMonth(delta) {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
    selectedDay = null;
    loadEvents();
  }

  function selectDay(key) {
    selectedDay = selectedDay === key ? null : key;
    render();
  }

  async function loadEvents() {
    const start = currentMonth;
    const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=250`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.status === 401) {
        accessToken = null;
        sessionStorage.removeItem('gcal_token');
        document.getElementById('cal-disconnected').style.display = 'block';
        document.getElementById('cal-connected').style.display = 'none';
        return;
      }
      const data = await res.json();
      allEvents = data.items || [];
      render();
    } catch (e) {
      console.error('Error carregant esdeveniments', e);
    }
  }

  function colorHexFor(ev) {
    const id = ev.colorId;
    if (id && eventColors && eventColors[id]) return eventColors[id].background;
    return null;
  }

  function isFotoManual(ev) {
    return !!(ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.fotografia === 'true');
  }

  async function toggleEventFoto(eventId) {
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;
    const nouEstat = !isFotoManual(ev);
    ev.extendedProperties = ev.extendedProperties || { private: {} };
    ev.extendedProperties.private = ev.extendedProperties.private || {};
    ev.extendedProperties.private.fotografia = nouEstat ? 'true' : 'false';
    render();
    try {
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          extendedProperties: { private: { fotografia: nouEstat ? 'true' : 'false' } }
        })
      });
    } catch (e) {
      console.error('Error desant la marca de fotografia', e);
    }
  }

  // ---------- Renderitzat ----------
  function render() {
    renderMonthGrid();
    renderAgenda();
  }

  function renderMonthGrid() {
    const grid = document.getElementById('cal-month-grid');
    const label = document.getElementById('cal-month-label');
    if (!grid) return;
    label.textContent = currentMonth.toLocaleDateString('ca-ES', { month: 'long', year: 'numeric' });

    const fotoDays = new Set(allEvents.filter(isFotoManual).map(ev => dateKey(ev.start.dateTime || ev.start.date)));
    const otherDays = new Set(allEvents.filter(ev => !isFotoManual(ev)).map(ev => dateKey(ev.start.dateTime || ev.start.date)));

    const first = currentMonth;
    const firstWeekday = (first.getDay() + 6) % 7; // dilluns = 0
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const todayKey = dateKey(new Date());

    let cells = '';
    for (let i = 0; i < firstWeekday; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const hasFoto = fotoDays.has(key);
      const hasOther = otherDays.has(key);
      const isToday = key === todayKey;
      const isSel = key === selectedDay;
      cells += `<button class="cal-cell ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''}" onclick="GCal.selectDay('${key}')">
        <span class="cal-cell-num">${d}</span>
        <span class="cal-cell-dots">${hasFoto ? '<i class="dot foto"></i>' : ''}${hasOther ? '<i class="dot other"></i>' : ''}</span>
      </button>`;
    }
    grid.innerHTML = `
      <div class="cal-weekdays">
        <span>DL</span><span>DT</span><span>DC</span><span>DJ</span><span>DV</span><span>DS</span><span>DG</span>
      </div>
      <div class="cal-grid">${cells}</div>
    `;
  }

  function renderAgenda() {
    const container = document.getElementById('cal-events');
    let list = allEvents;
    if (selectedDay) list = list.filter(ev => dateKey(ev.start.dateTime || ev.start.date) === selectedDay);
    if (onlyFotografia) list = list.filter(isFotoManual);
    document.getElementById('cal-count').textContent = list.length;

    const heading = document.getElementById('cal-agenda-heading');
    heading.textContent = selectedDay
      ? new Date(selectedDay).toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long' })
      : 'Tot el mes';

    if (!list.length) {
      container.innerHTML = `<div class="empty"><div class="empty-icon">◻</div><p>${onlyFotografia ? 'Cap sessió de fotografia.' : 'Cap esdeveniment.'}</p></div>`;
      return;
    }
    container.innerHTML = list.map(ev => {
      const start = ev.start.dateTime || ev.start.date;
      const d = new Date(start);
      const day = d.toLocaleDateString('ca-ES', { day: '2-digit', month: 'short' }).toUpperCase();
      const time = ev.start.dateTime ? d.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' }) : 'Tot el dia';
      const hex = colorHexFor(ev);
      const marcat = isFotoManual(ev);
      const dot = hex ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${hex};margin-right:6px;vertical-align:middle"></span>` : '';
      return `<div class="event-row">
        <div class="event-date">${day}</div>
        <div style="flex:1;min-width:0">
          <p class="event-title">${dot}${escapeHtml(ev.summary || '(sense títol)')}</p>
          <p class="event-time">${time}</p>
        </div>
        <button class="foto-toggle ${marcat ? 'on' : ''}" onclick="GCal.toggleEventFoto('${ev.id}')" title="Marcar com a sessió de fotografia">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="7" width="20" height="13" rx="2"/><circle cx="12" cy="13.5" r="4"/><path d="M8 7l1.5-2.5h5L16 7"/></svg>
        </button>
      </div>`;
    }).join('');
  }

  async function createEvent({ title, dateStr, startTime, endTime, allDay, fotografia }) {
    if (!accessToken) return null;
    const body = { summary: title };
    if (allDay) {
      const end = new Date(dateStr);
      end.setDate(end.getDate() + 1);
      body.start = { date: dateStr };
      body.end = { date: dateKey(end) };
    } else {
      body.start = { dateTime: `${dateStr}T${startTime}:00` };
      body.end = { dateTime: `${dateStr}T${endTime}:00` };
    }
    if (fotografia) body.extendedProperties = { private: { fotografia: 'true' } };

    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const created = await res.json();
    if (created.id) loadEvents();
    return created;
  }

  function getSelectedDayOrToday() {
    return selectedDay || dateKey(new Date());
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return {
    init, connect, isConnected, loadEvents, createEvent,
    toggleOnlyFotografia, toggleEventFoto, changeMonth, selectDay,
    getSelectedDayOrToday
  };
})();
