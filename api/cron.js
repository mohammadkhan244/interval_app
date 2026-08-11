import { createClient } from '@vercel/kv';
import webpush from 'web-push';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function intervalMs(value, unit) {
  const v = Number(value);
  switch (unit) {
    case 'min':   return v * 60 * 1000;
    case 'hour':  return v * 60 * 60 * 1000;
    case 'day':   return v * 24 * 60 * 60 * 1000;
    case 'month': return v * 30 * 24 * 60 * 60 * 1000;
    default:      return Infinity;
  }
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function isWithinWindow(windowStart, windowEnd, timezone) {
  if (!windowStart && !windowEnd) return true;
  const tz = timezone || 'America/Chicago';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  const current = h * 60 + m;
  const start = windowStart ? timeToMinutes(windowStart) : 0;
  const end = windowEnd ? timeToMinutes(windowEnd) : 24 * 60;
  return current >= start && current <= end;
}

export default async function handler(req, res) {
  // Vercel cron sends GET; guard against unexpected callers
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  const keys = await db.keys('rule:*');
  if (!keys.length) return res.status(200).json({ fired: 0 });

  const rules = (await db.mget(...keys)).filter(Boolean);
  const sub = await db.get('pushSubscription');
  if (!sub) return res.status(200).json({ fired: 0, note: 'No subscriber' });

  const now = Date.now();
  const today = todayDate();
  let fired = 0;

  for (const rule of rules) {
    if (!rule.active) continue;

    // Skip today check
    if (rule.skippedUntil && rule.skippedUntil >= today) continue;

    // Window check
    if (!isWithinWindow(rule.windowStart, rule.windowEnd, rule.timezone)) continue;

    // Interval check
    const interval = intervalMs(rule.intervalValue, rule.intervalUnit);
    if (rule.lastFired && now - new Date(rule.lastFired).getTime() < interval) continue;

    // Fire push
    try {
      await webpush.sendNotification(
        sub,
        JSON.stringify({ title: 'Reminder', body: rule.message, ruleId: rule.id })
      );
      rule.lastFired = new Date().toISOString();
      // Clear expired skippedUntil
      if (rule.skippedUntil && rule.skippedUntil < today) {
        rule.skippedUntil = null;
      }
      await db.set(`rule:${rule.id}`, rule);
      fired++;
    } catch (err) {
      console.error(`Push failed for rule ${rule.id}:`, err.message);
    }
  }

  return res.status(200).json({ fired });
}
