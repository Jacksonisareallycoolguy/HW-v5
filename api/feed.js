// Fetches a calendar feed for a signed-in person.
const { safe, configured, auth, bodyOf, reply } = require('./_lib/common');
const { fetchFeed } = require('./_lib/feed');

module.exports = safe(async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Use POST.' });
  if (!configured()) return reply(res, 503, { error: 'The database is not connected yet.' });
  const me = await auth(req);
  if (!me) return reply(res, 401, { error: 'Please sign in again.' });
  try {
    const text = await fetchFeed(bodyOf(req).url || '');
    reply(res, 200, text, 'text/calendar; charset=utf-8');
  } catch (e) {
    const [code, msg] = Array.isArray(e) ? e : [400, 'Bad request.'];
    reply(res, code, { error: msg });
  }
});
