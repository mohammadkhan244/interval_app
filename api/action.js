import { createClient } from '@vercel/kv';
import { checkAuth } from './_auth.js';
import { todayStr, fetchCompletionsForRule, calcStats } from './_stats.js';

function tomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
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

  const today = todayStr();
  const now = new Date().toISOString();
  const completionKey = `completion:${ruleId}:${today}`;

  if (action === 'snooze') {
    rule.lastFired = now;
  } else if (action === 'done') {
    const existing = await db.get(completionKey);
    // First Done of the day wins; idempotent on subsequent calls
    if (!existing || existing.status !== 'done') {
      await db.set(completionKey, { status: 'done', firstDoneAt: now });
    }
  } else if (action === 'skip') {
    rule.skippedUntil = tomorrowDate();
    const existing = await db.get(completionKey);
    if (!existing) {
      await db.set(completionKey, { status: 'skipped' });
    }
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }

  // Recalculate streak after any completion event
  if (action === 'done' || action === 'skip') {
    const completions = await fetchCompletionsForRule(db, ruleId);
    const stats = calcStats(completions, rule);
    rule.currentStreak = stats.currentStreak;
    rule.longestStreak = stats.longestStreak;
  }

  await db.set(`rule:${ruleId}`, rule);
  return res.status(200).json({ ok: true });
}
