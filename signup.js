// Creates a person (profile) when given the invite code. Returns their private token once.
const { sb, configured, sha, newToken, safeEqual, bodyOf, reply, validTz } = require('./_lib/common');
const MAX_PEOPLE = +(process.env.MAX_PROFILES || 30);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Use POST.' });
  if (!configured()) return reply(res, 503, { error: 'The database is not connected yet.' });
  const invite = process.env.PASSCODE || '';
  if (!invite) return reply(res, 503, { error: 'Sign-ups are closed: no invite code is configured.' });
  const b = bodyOf(req);
  if (!safeEqual(b.code || '', invite)) return reply(res, 401, { error: 'That invite code is not right.' });
  try {
    const cr = await sb('profiles?select=id&limit=' + (MAX_PEOPLE + 1));
    const existing = cr.ok ? await cr.json() : [];
    if (existing.length >= MAX_PEOPLE) return reply(res, 403, { error: 'This app is full right now.' });
    const token = newToken();
    const row = { name: String(b.name || '').trim().slice(0, 40) || null, token_hash: sha(token), timezone: validTz(b.timezone) ? b.timezone : 'UTC' };
    const r = await sb('profiles', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify(row) });
    if (!r.ok) return reply(res, 502, { error: 'Could not create your account (database error ' + r.status + ').' });
    reply(res, 200, { token });
  } catch (e) {
    reply(res, 502, { error: 'Could not reach the database.' });
  }
};
