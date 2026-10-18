# Canvas due (v5: accounts, sync and reminders)

Top level: index.html, sw.js, manifest.webmanifest, three icon PNGs, package.json, vercel.json
Folder api/: feed.js, push-key.js, send.js, signup.js, subscribe.js, sync.js
Folder api/_lib/: common.js, feed.js, ics.js (helpers, not public endpoints)

Vercel environment variables: PASSCODE (now the invite code), SUPABASE_URL, SUPABASE_SERVICE_KEY,
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, LINK_ENC_KEY, CRON_SECRET.
A schedule in Supabase calls /api/send every 10 minutes; reminders go out at each person's own times.
