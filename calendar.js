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

  let eventColors = null;
  async function loadColors() {
    if (eventColors) return eventColors;
    try {
      const res = await fetch('https://www.googleapis.com/calendar/v3/colors', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      eventColors = data.event || {};
    } catch (e) {
      eventColors = {};
    }
    return eventColors;
  }

  async function pullEvents({ startISO, endISO }) {
    const ok = await connect();
    if (!ok) return [];
    await loadColors();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${startISO}&timeMax=${endISO}&singleEvents=true&orderBy=startTime&maxResults=250`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    if (!res.ok) {
      console.error('Error llegint Google Calendar', res.status, data);
      return [];
    }
    return (data.items || []).map(ev => ({
      googleId: ev.id,
      title: ev.summary || '(sense títol)',
      dia: (ev.start.dateTime || ev.start.date || '').slice(0, 10),
      horaInici: ev.start.dateTime ? ev.start.dateTime.slice(11, 16) : null,
      horaFi: ev.end?.dateTime ? ev.end.dateTime.slice(11, 16) : null,
      totDia: !ev.start.dateTime,
      colorId: ev.colorId || null,
      colorHex: ev.colorId && eventColors[ev.colorId] ? eventColors[ev.colorId].background : null
    }));
  }

  async function getColorSwatches() {
    await loadColors();
    return Object.entries(eventColors).map(([id, c]) => ({ id, hex: c.background }));
  }

  return { init, connect, isConnected, pushEvent, pullEvents, getColorSwatches };
})();
