import { createClient } from '@vercel/kv';
import { checkAuth } from './_auth.js';
import { calcStats } from './_stats.js';
import { randomUUID } from 'crypto';

function kv() {
  return createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
}

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  const db = kv();

  // GET — list all rules with computed stats
  if (req.method === 'GET') {
    const ruleKeys = await db.keys('rule:*');
    if (!ruleKeys.length) return res.status(200).json([]);

    let rules = (await db.mget(...ruleKeys)).filter(Boolean);
    const now = new Date().toISOString();

    // Backfill createdAt on old rules; persist changes
    const backfills = [];
    rules = rules.map((rule) => {
      if (!rule.createdAt) {
        rule.createdAt = now;
        backfills.push(db.set(`rule:${rule.id}`, rule));
      }
      return rule;
    });
    if (backfills.length) await Promise.all(backfills);

    // Fetch all completion keys in one shot, then group by ruleId
    const allCompletionKeys = await db.keys('completion:*');
    const completionsByRule = {};
    if (allCompletionKeys.length) {
      const allValues = await db.mget(...allCompletionKeys);
      allCompletionKeys.forEach((key, i) => {
        // key: completion:{ruleId}:{YYYY-MM-DD}
        const parts = key.split(':');
        const ruleId = parts[1];
        const date = parts[2];
        if (allValues[i]) {
          if (!completionsByRule[ruleId]) completionsByRule[ruleId] = {};
          completionsByRule[ruleId][date] = allValues[i];
        }
      });
    }

    const enriched = rules.map((rule) => {
      const completions = completionsByRule[rule.id] || {};
      const stats = calcStats(completions, rule);
      return { ...rule, ...stats };
    });

    return res.status(200).json(enriched);
  }

  // POST — create rule
  if (req.method === 'POST') {
    const { message, intervalValue, intervalUnit, windowStart, windowEnd, timezone, description } = req.body;
    if (!message || !intervalValue || !intervalUnit) {
      return res.status(400).json({ error: 'message, intervalValue, intervalUnit required' });
    }
    const rule = {
      id: randomUUID(),
      message,
      description: description || null,
      intervalValue: Number(intervalValue),
      intervalUnit,
      windowStart: windowStart || null,
      windowEnd: windowEnd || null,
      timezone: timezone || null,
      active: true,
      lastFired: null,
      skippedUntil: null,
      createdAt: new Date().toISOString(),
      currentStreak: 0,
      longestStreak: 0,
    };
    await db.set(`rule:${rule.id}`, rule);
    return res.status(201).json(rule);
  }

  // PUT — update rule (guard createdAt and streak fields from being overwritten)
  if (req.method === 'PUT') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const existing = await db.get(`rule:${id}`);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { createdAt, currentStreak, longestStreak, ...patch } = req.body;
    const updated = { ...existing, ...patch, id };
    await db.set(`rule:${id}`, updated);
    return res.status(200).json(updated);
  }

  // DELETE — remove rule and its completions
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db.del(`rule:${id}`);
    // Clean up completion log entries
    const completionKeys = await db.keys(`completion:${id}:*`);
    if (completionKeys.length) await Promise.all(completionKeys.map((k) => db.del(k)));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
