import { createClient } from '@vercel/kv';
import { checkAuth } from './_auth.js';

function tomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!checkAuth(req, res)) return;

  const { ruleId, action } = req.body || {};
  if (!ruleId || !action) return res.status(400).json({ error: 'ruleId and action required' });

  const db = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  const rule = await db.get(`rule:${ruleId}`);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });

  if (action === 'snooze') {
    rule.lastFired = new Date().toISOString();
  } else if (action === 'skip') {
    rule.skippedUntil = tomorrowDate();
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }

  await db.set(`rule:${ruleId}`, rule);
  return res.status(200).json({ ok: true });
}
