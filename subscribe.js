// Saves or removes this device's notification address for the signed-in person.
const { safe, sb, configured, auth, bodyOf, reply, validTz } = require('./_lib/common');
// Only real browser push services are accepted as destinations.
const PUSH_HOST = /(^|\.)(push\.apple\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/i;
function validEndpoint(ep) {
  try { const u = new URL(ep); return u.protocol === 'https:' && PUSH_HOST.test(u.hostname) && ep.length < 1000; } catch { return false; }
}

module.exports = safe(async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return reply(res, 405, { error: 'Use POST or DELETE.' });
  if (!configured()) return reply(res, 503, { error: 'The database is not connected yet.' });
  const me = await auth(req);
  if (!me) return reply(res, 401, { error: 'Please sign in again.' });
  const b = bodyOf(req);
  try {
    if (req.method === 'DELETE') {
      if (!validEndpoint(b.endpoint)) return reply(res, 400, { error: 'Bad endpoint.' });
      const r = await sb('push_subscriptions?profile_id=eq.' + me.id + '&endpoint=eq.' + encodeURIComponent(b.endpoint), { method: 'DELETE' });
      return r.ok ? reply(res, 200, { ok: true }) : reply(res, 502, { error: 'Could not remove this device.' });
    }
    const s = b.subscription || {}, k = s.keys || {};
    if (!validEndpoint(s.endpoint) || !k.p256dh || !k.auth) return reply(res, 400, { error: 'That notification address is not valid.' });
    const r = await sb('push_subscriptions?on_conflict=endpoint', {
      method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ profile_id: me.id, endpoint: s.endpoint, p256dh: String(k.p256dh), auth: String(k.auth), user_agent: String(req.headers['user-agent'] || '').slice(0, 200) })
    });
    if (!r.ok) return reply(res, 502, { error: 'Could not save this device (database error ' + r.status + ').' });
    if (validTz(b.timezone)) await sb('profiles?id=eq.' + me.id, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ timezone: b.timezone, updated_at: new Date().toISOString() }) });
    reply(res, 200, { ok: true });
  } catch (e) {
    reply(res, 502, { error: 'Could not reach the database.' });
  }
});
