// Reads and writes one person's data: settings, custom items, checked-off items.
const { safe, sb, configured, enc, dec, auth, bodyOf, reply, validTz, validTime } = require('./_lib/common');
const { validateFeedUrl } = require('./_lib/feed');

const TYPES = ['assignment', 'task', 'event'];
function cleanItem(x) {
  if (!x || typeof x !== 'object') return null;
  const id = String(x.id || ''), title = String(x.title || '').trim(), course = String(x.course || 'Personal').trim();
  if (!id || id.length > 64 || !title || title.length > 120 || !course || course.length > 40) return null;
  if (!TYPES.includes(x.type) || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.date))) return null;
  const time = x.time ? String(x.time) : null;
  if (time && !validTime(time)) return null;
  return { id, title, type: x.type, date: String(x.date), time, course };
}
const cleanId = id => (typeof id === 'string' && id.length > 0 && id.length <= 300 ? id : null);

module.exports = safe(async function handler(req, res) {
  if (!configured()) return reply(res, 503, { error: 'The database is not connected yet.' });
  const me = await auth(req);
  if (!me) return reply(res, 401, { error: 'Please sign in again.' });
  const pid = me.id;
  try {
    if (req.method === 'GET') {
      const [c, d] = await Promise.all([
        sb('custom_items?profile_id=eq.' + pid + '&select=id,title,type,date,time,course&order=date.asc&limit=2000'),
        sb('done_items?profile_id=eq.' + pid + '&select=id&limit=5000')
      ]);
      if (!c.ok || !d.ok) return reply(res, 502, { error: 'Could not load your data.' });
      return reply(res, 200, {
        profile: { name: me.name, canvas_link: dec(me.canvas_link), apple_link: dec(me.apple_link), timezone: me.timezone, morning_time: me.morning_time, evening_time: me.evening_time },
        custom: await c.json(),
        done: (await d.json()).map(r => r.id)
      });
    }
    if (req.method !== 'POST') return reply(res, 405, { error: 'Use GET or POST.' });
    const b = bodyOf(req);

    if (b.op === 'profile_update') {
      const p = b.fields || {}, row = { updated_at: new Date().toISOString() };
      for (const [field, key] of [['canvas_link', 'canvas_link'], ['apple_link', 'apple_link']]) {
        if (field in p) row[key] = p[field] ? enc(validateFeedUrl(p[field])) : null;
      }
      if ('morning_time' in p) { if (!validTime(p.morning_time)) return reply(res, 400, { error: 'Bad morning time.' }); row.morning_time = p.morning_time; }
      if ('evening_time' in p) { if (!validTime(p.evening_time)) return reply(res, 400, { error: 'Bad evening time.' }); row.evening_time = p.evening_time; }
      if ('timezone' in p) { if (!validTz(p.timezone)) return reply(res, 400, { error: 'Bad time zone.' }); row.timezone = p.timezone; }
      if ('name' in p) row.name = String(p.name || '').trim().slice(0, 40) || null;
      const r = await sb('profiles?id=eq.' + pid, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(row) });
      return r.ok ? reply(res, 200, { ok: true }) : reply(res, 502, { error: 'Could not save your settings.' });
    }
    if (b.op === 'custom_upsert') {
      const it = cleanItem(b.item);
      if (!it) return reply(res, 400, { error: 'That item is not valid.' });
      const r = await sb('custom_items?on_conflict=profile_id,id', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ ...it, profile_id: pid, updated_at: new Date().toISOString() }) });
      return r.ok ? reply(res, 200, { ok: true }) : reply(res, 502, { error: 'Could not save that item.' });
    }
    if (b.op === 'custom_delete') {
      const id = cleanId(b.id); if (!id) return reply(res, 400, { error: 'Bad id.' });
      const q = 'profile_id=eq.' + pid + '&id=eq.' + encodeURIComponent(id);
      await sb('custom_items?' + q, { method: 'DELETE' });
      await sb('done_items?' + q, { method: 'DELETE' });
      return reply(res, 200, { ok: true });
    }
    if (b.op === 'done_set') {
      const id = cleanId(b.id); if (!id) return reply(res, 400, { error: 'Bad id.' });
      const r = b.done
        ? await sb('done_items?on_conflict=profile_id,id', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ profile_id: pid, id }) })
        : await sb('done_items?profile_id=eq.' + pid + '&id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
      return r.ok ? reply(res, 200, { ok: true }) : reply(res, 502, { error: 'Could not save that.' });
    }
    if (b.op === 'import') { // one-time move of data that used to live only on the device
      const items = (Array.isArray(b.custom) ? b.custom : []).slice(0, 500).map(cleanItem).filter(Boolean).map(i => ({ ...i, profile_id: pid }));
      const ids = (Array.isArray(b.done) ? b.done : []).slice(0, 2000).map(cleanId).filter(Boolean).map(id => ({ profile_id: pid, id }));
      if (items.length) await sb('custom_items?on_conflict=profile_id,id', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(items) });
      if (ids.length) await sb('done_items?on_conflict=profile_id,id', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(ids) });
      return reply(res, 200, { ok: true, custom: items.length, done: ids.length });
    }
    reply(res, 400, { error: 'Unknown request.' });
  } catch (e) {
    if (Array.isArray(e)) return reply(res, e[0], { error: e[1] });
    reply(res, 502, { error: 'Something went wrong talking to the database.' });
  }
});
