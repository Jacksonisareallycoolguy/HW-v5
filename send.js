// Sends reminders. The scheduler calls this every few minutes with the CRON_SECRET.
// A signed-in person can also call it with { "test": true } to send themselves a real test push.
const webpush = require('web-push');
const { sb, configured, auth, bearer, safeEqual, bodyOf, reply, dec } = require('./_lib/common');
const { fetchFeed } = require('./_lib/feed');
const { parseICS } = require('./_lib/ics');

const WINDOW_MIN = 90; // a reminder can go out up to 90 minutes after its set time, in case a run is missed
const pad = n => String(n).padStart(2, '0');

function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return { date: p.year + '-' + p.month + '-' + p.day, minutes: +p.hour * 60 + +p.minute };
}
function addDay(ymd, n) { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function eventDay(e, tz) {
  if (e.allDay || !e.z) { const d = e.due; return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  return localParts(e.due, tz).date;
}
function fmt12(h, m) { return ((h + 11) % 12 + 1) + ':' + pad(m) + ' ' + (h < 12 ? 'AM' : 'PM'); }
function eventTime(e, tz) {
  if (e.allDay) return '';
  if (!e.z) return fmt12(e.due.getHours(), e.due.getMinutes());
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(e.due);
}
const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);

async function itemsFor(profile, target, tz) {
  const now = Date.now(), wS = new Date(now - 3 * 864e5), wE = new Date(now + 4 * 864e5);
  const one = async (encLink, opts) => {
    if (!encLink) return [];
    try { return parseICS(await fetchFeed(dec(encLink)), Object.assign({ wS, wE }, opts)); } catch { return []; }
  };
  const [canvas, apple] = await Promise.all([
    one(profile.canvas_link, { src: 'canvas', kind: 'assignment', bracket: true, defaultCourse: 'Other' }),
    one(profile.apple_link, { src: 'apple', kind: 'event', bracket: false })
  ]);
  const dr = await sb('done_items?profile_id=eq.' + profile.id + '&select=id&limit=5000');
  const done = new Set(dr.ok ? (await dr.json()).map(r => r.id) : []);
  const cr = await sb('custom_items?profile_id=eq.' + profile.id + '&date=eq.' + target + '&select=id,title,type,time,course');
  const custom = cr.ok ? await cr.json() : [];
  const out = [];
  for (const e of [...canvas, ...apple]) {
    if (done.has(e.id) || eventDay(e, tz) !== target) continue;
    out.push({ title: e.title, course: e.course, time: eventTime(e, tz), sort: e.allDay ? -1 : e.due.getTime() });
  }
  for (const c of custom) {
    if (done.has(c.id)) continue;
    out.push({ title: c.title, course: c.course, time: c.time ? fmt12(+c.time.slice(0, 2), +c.time.slice(3, 5)) : '', sort: c.time ? toMin(c.time) : -1 });
  }
  return out.sort((a, b) => a.sort - b.sort);
}

function message(kind, items) {
  const n = items.length;
  const lines = items.slice(0, 5).map(i => i.title + (i.course && i.course !== 'Other' ? ' \u00b7 ' + i.course : '') + (i.time ? ' (' + i.time + ')' : ''));
  if (n > 5) lines.push('+' + (n - 5) + ' more');
  return { title: n + (n === 1 ? ' thing' : ' things') + (kind === 'morning' ? ' due today' : ' due tomorrow'), body: lines.join('\n') };
}

async function pushTo(subs, payload) {
  let ok = 0, failed = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: 'normal' });
      ok++;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await sb('push_subscriptions?endpoint=eq.' + encodeURIComponent(s.endpoint), { method: 'DELETE' }).catch(() => {});
      else failed++;
    }
  }));
  return { ok, failed };
}
async function subsOf(pid) {
  const r = await sb('push_subscriptions?profile_id=eq.' + pid + '&select=endpoint,p256dh,auth');
  return r.ok ? r.json() : [];
}

async function runAll() {
  const pr = await sb('profiles?select=id,timezone,morning_time,evening_time,canvas_link,apple_link&limit=500');
  const profiles = pr.ok ? await pr.json() : [];
  const now = new Date(), summary = { checked: profiles.length, sent: 0, skipped: 0 };
  for (const p of profiles) {
    let lp; try { lp = localParts(now, p.timezone); } catch { continue; }
    for (const kind of ['morning', 'evening']) {
      const at = toMin(kind === 'morning' ? p.morning_time : p.evening_time);
      if (lp.minutes < at || lp.minutes >= at + WINDOW_MIN) continue;
      const claim = await sb('reminder_log?on_conflict=profile_id,kind,day', { method: 'POST', headers: { prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ profile_id: p.id, kind, day: lp.date }) });
      const rows = claim.ok ? await claim.json() : [];
      if (!rows.length) continue; // already handled today
      const subs = await subsOf(p.id);
      if (!subs.length) { await sb('reminder_log?profile_id=eq.' + p.id + '&kind=eq.' + kind + '&day=eq.' + lp.date, { method: 'DELETE' }); continue; }
      const target = kind === 'morning' ? lp.date : addDay(lp.date, 1);
      const items = await itemsFor(p, target, p.timezone);
      if (!items.length) { summary.skipped++; continue; }
      const m = message(kind, items);
      const res = await pushTo(subs, { title: m.title, body: m.body, tag: kind + '-' + lp.date, url: '/' });
      if (res.ok) summary.sent++;
      else await sb('reminder_log?profile_id=eq.' + p.id + '&kind=eq.' + kind + '&day=eq.' + lp.date, { method: 'DELETE' }); // try again next run
    }
  }
  return summary;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Use POST.' });
  if (!configured()) return reply(res, 503, { error: 'The database is not connected yet.' });
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) return reply(res, 503, { error: 'Push keys are not set up.' });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY.trim(), process.env.VAPID_PRIVATE_KEY.trim());
  const token = bearer(req), secret = process.env.CRON_SECRET || '';
  try {
    if (token && secret && safeEqual(token, secret)) return reply(res, 200, await runAll());
    const me = await auth(req);
    if (!me) return reply(res, 401, { error: 'Not allowed.' });
    if (!bodyOf(req).test) return reply(res, 400, { error: 'Nothing to do.' });
    const subs = await subsOf(me.id);
    if (!subs.length) return reply(res, 404, { error: 'No devices are saved for you yet. Turn on notifications first.' });
    const r = await pushTo(subs, { title: "What's due", body: 'This reminder came from the server. Your 8:00 am and 7:00 pm reminders will look like this.', tag: 'test', url: '/' });
    reply(res, r.ok ? 200 : 502, r.ok ? { ok: true, sent: r.ok } : { error: 'The push service did not accept the message.' });
  } catch (e) {
    reply(res, 500, { error: 'Sending failed.' });
  }
};
