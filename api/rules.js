import { createClient } from '@vercel/kv';
import { checkAuth } from './_auth.js';
import { randomUUID } from 'crypto';

function kv() {
  return createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
}

async function listRules(db) {
  const keys = await db.keys('rule:*');
  if (!keys.length) return [];
  const values = await db.mget(...keys);
  return values.filter(Boolean);
}

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;
  const db = kv();

  // GET — list all rules
  if (req.method === 'GET') {
    const rules = await listRules(db);
    return res.status(200).json(rules);
  }

  // POST — create rule
  if (req.method === 'POST') {
    const { message, intervalValue, intervalUnit, windowStart, windowEnd } = req.body;
    if (!message || !intervalValue || !intervalUnit) {
      return res.status(400).json({ error: 'message, intervalValue, intervalUnit required' });
    }
    const rule = {
      id: randomUUID(),
      message,
      intervalValue: Number(intervalValue),
      intervalUnit,
      windowStart: windowStart || null,
      windowEnd: windowEnd || null,
      active: true,
      lastFired: null,
      skippedUntil: null,
    };
    await db.set(`rule:${rule.id}`, rule);
    return res.status(201).json(rule);
  }

  // PUT — update rule
  if (req.method === 'PUT') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const existing = await db.get(`rule:${id}`);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const updated = { ...existing, ...req.body, id };
    await db.set(`rule:${id}`, updated);
    return res.status(200).json(updated);
  }

  // DELETE — remove rule
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db.del(`rule:${id}`);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
