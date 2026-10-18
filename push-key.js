// Returns the public push key (safe to share) so the app can subscribe this device.
module.exports = function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'Push is not set up on the server yet (missing VAPID_PUBLIC_KEY).' })); }
  res.statusCode = 200;
  res.end(JSON.stringify({ key: key.trim() }));
};
