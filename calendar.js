// Sincronització opcional amb Google Calendar — només s'activa quan l'usuari ho demana explícitament.
// El calendari de l'app viu a Supabase (app.js); això és només per exportar-hi esdeveniments si es vol.
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
          localStorage.setItem('gcal_token', accessToken);
          localStorage.setItem('gcal_token_exp', String(Date.now() + 3500 * 1000));
          localStorage.setItem('gcal_authorized', 'true');
          if (pendingResolve) { pendingResolve(true); pendingResolve = null; }
        } else if (pendingResolve) {
          pendingResolve(false); pendingResolve = null;
        }
      }
    });
    const saved = localStorage.getItem('gcal_token');
    const exp = Number(localStorage.getItem('gcal_token_exp') || 0);
    if (saved && Date.now() < exp) accessToken = saved;
  }

  let pendingResolve = null;
  function connect() {
    return new Promise((resolve) => {
      if (!CONFIG.googleClientId) { resolve(false); return; }
      if (accessToken) { resolve(true); return; }
      pendingResolve = resolve;
      tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  function isConnected() {
    return !!accessToken;
  }

  async function pushEvent({ title, dateStr, startTime, endTime, allDay }) {
    const ok = await connect();
    if (!ok) return null;
    const body = { summary: title };
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';
    if (allDay) {
      const end = new Date(dateStr);
      end.setDate(end.getDate() + 1);
      body.start = { date: dateStr };
      body.end = { date: end.toISOString().slice(0, 10) };
    } else {
      body.start = { dateTime: `${dateStr}T${startTime || '10:00'}:00`, timeZone: tz };
      body.end = { dateTime: `${dateStr}T${endTime || '11:00'}:00`, timeZone: tz };
    }
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Error de Google Calendar API', res.status, data);
      return null;
    }
    return data;
  }

  return { init, connect, isConnected, pushEvent };
})();
