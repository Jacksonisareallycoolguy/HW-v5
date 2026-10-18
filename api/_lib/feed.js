// Fetches a calendar feed safely. Allowed: Canvas feed links and Apple/iCloud published calendars.
const dns = require('dns').promises;
const net = require('net');
const MAX_BYTES = 5 * 1024 * 1024;

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:');
}
function notAllowed(u) {
  if (u.protocol !== 'https:') return 'The link must use https.';
  const canvas = /\/feeds\/calendars\/[^/]+\.ics$/i.test(u.pathname);
  const apple = /^p\d+-caldav\.icloud\.com$/i.test(u.hostname) && /^\/published\//i.test(u.pathname);
  if (!canvas && !apple) return 'That is not a Canvas calendar feed link or an Apple published calendar link.';
  return null;
}
// Returns a clean https link or throws [status, message].
function validateFeedUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim().replace(/^webcal:/i, 'https:')); } catch { throw [400, 'That does not look like a link.']; }
  const bad = notAllowed(u);
  if (bad) throw [400, bad];
  return u.toString();
}

async function fetchFeed(raw) {
  let u = new URL(validateFeedUrl(raw));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    for (let hop = 0; hop < 4; hop++) {
      const bad = notAllowed(u);
      if (bad) throw [400, hop ? 'The calendar link redirected somewhere that is not allowed.' : bad];
      const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => { throw [502, 'Could not find that website.']; });
      if (!addrs.length || addrs.some(a => isPrivate(a.address))) throw [400, 'That address is not allowed.'];
      const r = await fetch(u, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'canvas-due/1.0', accept: 'text/calendar,*/*' } });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location');
        if (!loc) throw [502, 'The calendar link redirected without a destination.'];
        u = new URL(loc, u);
        continue;
      }
      if (!r.ok) throw [502, 'The calendar service returned an error (' + r.status + '). The link may have been reset or unpublished.'];
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES) throw [502, 'The calendar is too large.'];
      const text = buf.toString('utf8');
      if (!text.includes('BEGIN:VCALENDAR')) throw [502, 'That link did not return a calendar.'];
      return text;
    }
    throw [502, 'The calendar link redirected too many times.'];
  } catch (e) {
    if (Array.isArray(e)) throw e;
    throw [502, e.name === 'AbortError' ? 'The calendar service took too long to respond.' : 'Could not reach the calendar service.'];
  } finally { clearTimeout(timer); }
}

module.exports = { fetchFeed, validateFeedUrl };
