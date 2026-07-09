// Connexió amb Google Calendar via OAuth implicit (Google Identity Services)
const GCal = (() => {
  let tokenClient = null;
  let accessToken = null;

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
    loadEvents();
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
      renderEvents(data.items || []);
    } catch (e) {
      console.error('Error carregant esdeveniments', e);
    }
  }

  function renderEvents(events) {
    const container = document.getElementById('cal-events');
    document.getElementById('cal-count').textContent = events.length;
    if (!events.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">◻</div><p>Cap esdeveniment en els propers 30 dies.</p></div>';
      return;
    }
    container.innerHTML = events.map(ev => {
      const start = ev.start.dateTime || ev.start.date;
      const d = new Date(start);
      const day = d.toLocaleDateString('ca-ES', { day: '2-digit', month: 'short' }).toUpperCase();
      const time = ev.start.dateTime ? d.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' }) : 'Tot el dia';
      return `<div class="event-row">
        <div class="event-date">${day}</div>
        <div>
          <p class="event-title">${escapeHtml(ev.summary || '(sense títol)')}</p>
          <p class="event-time">${time}</p>
        </div>
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

  return { init, connect, isConnected, loadEvents, createEvent };
})();
