// Connexió amb Google Calendar via OAuth implicit (Google Identity Services)
const GCal = (() => {
  let tokenClient = null;
  let accessToken = null;
  let eventColors = null; // { "1": {background:"#..."}, ... }
  let allEvents = [];
  let onlyFotografia = false;

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
    renderEvents(allEvents);
  }

  async function loadEvents() {
    const now = new Date().toISOString();
    const in30 = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&timeMax=${in30}&singleEvents=true&orderBy=startTime&maxResults=20`;
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
      renderEvents(allEvents);
    } catch (e) {
      console.error('Error carregant esdeveniments', e);
    }
  }

  function colorHexFor(ev) {
    const id = ev.colorId;
    if (id && eventColors && eventColors[id]) return eventColors[id].background;
    return null; // color per defecte del calendari — no el podem saber via API amb prou fiabilitat
  }

  function isFotoManual(ev) {
    return !!(ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.fotografia === 'true');
  }

  async function toggleEventFoto(eventId) {
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;
    const nouEstat = !isFotoManual(ev);
    // Optimista: actualitzem localment de seguida
    ev.extendedProperties = ev.extendedProperties || { private: {} };
    ev.extendedProperties.private = ev.extendedProperties.private || {};
    ev.extendedProperties.private.fotografia = nouEstat ? 'true' : 'false';
    renderEvents(allEvents);
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

  function renderEvents(events) {
    const container = document.getElementById('cal-events');
    const list = onlyFotografia ? events.filter(ev => isFotoManual(ev)) : events;
    document.getElementById('cal-count').textContent = list.length;

    if (!list.length) {
      container.innerHTML = `<div class="empty"><div class="empty-icon">◻</div><p>${onlyFotografia ? 'Cap sessió de fotografia marcada.' : 'Cap esdeveniment en els propers 30 dies.'}</p></div>`;
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

  async function createEvent({ title, startISO, endISO, description }) {
    if (!accessToken) return null;
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary: title,
        description: description || '',
        start: { dateTime: startISO },
        end: { dateTime: endISO }
      })
    });
    return res.json();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return {
    init, connect, isConnected, loadEvents, createEvent,
    toggleOnlyFotografia, toggleEventFoto,
    renderEvents: () => renderEvents(allEvents)
  };
})();
