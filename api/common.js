// Shared helpers: database access, token handling, link encryption. Files starting with _ are not public endpoints.
const crypto = require('crypto');

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const configured = () => !!(SB_URL && SB_KEY);

function sb(path, opts) {
  opts = opts || {};
  return fetch(SB_URL + '/rest/v1/' + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SB_KEY, authorization: 'Bearer ' + SB_KEY, 'content-type': 'application/json' }, opts.headers)
  }));
}

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Calendar links are secrets, so they are encrypted before they are stored.
function encKey() {
  const k = Buffer.from(process.env.LINK_ENC_KEY || '', 'base64');
  if (k.length !== 32) throw new Error('LINK_ENC_KEY is missing or not 32 bytes');
  return k;
}
function enc(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function dec(s) {
  if (!s || !String(s).startsWith('v1:')) return '';
  const b = Buffer.from(String(s).slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

function bearer(req) {
  const m = String((req.headers && req.headers.authorization) || '').match(/^Bearer (\S{16,200})$/);
  return m ? m[1] : null;
}
// Returns the signed-in person's profile row, or null.
async function auth(req) {
  const t = bearer(req);
  if (!t) return null;
  const r = await sb('profiles?token_hash=eq.' + sha(t) + '&select=*&limit=1');
  if (!r.ok) throw new Error('database unavailable');
  const rows = await r.json();
  return rows[0] || null;
}
// Wraps a handler so an unexpected failure becomes a clear message instead of a crash.
const safe = fn => async (req, res) => {
  try { await fn(req, res); } catch (e) { reply(res, 502, { error: 'The database is unavailable right now. Try again in a moment.' }); }
};

function bodyOf(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}
function reply(res, code, obj, type) {
  res.statusCode = code;
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-type', type || 'application/json; charset=utf-8');
  res.end(type ? obj : JSON.stringify(obj));
}
function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return typeof tz === 'string' && tz.length < 60; } catch { return false; }
}
const validTime = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

module.exports = { safe, sb, configured, sha, newToken, safeEqual, enc, dec, auth, bodyOf, reply, validTz, validTime, bearer };
