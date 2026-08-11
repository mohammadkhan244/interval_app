export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export async function fetchCompletionsForRule(db, ruleId) {
  const keys = await db.keys(`completion:${ruleId}:*`);
  if (!keys.length) return {};
  const values = await db.mget(...keys);
  const out = {};
  keys.forEach((key, i) => {
    // key format: completion:{ruleId}:{YYYY-MM-DD}  (exactly 2 colons, UUID has hyphens)
    const date = key.split(':')[2];
    if (values[i]) out[date] = values[i];
  });
  return out;
}

export function calcStats(completions, rule) {
  const today = todayStr();
  const startStr = rule.createdAt
    ? new Date(rule.createdAt).toISOString().slice(0, 10)
    : today;

  // Build all days from startStr to today (UTC date arithmetic)
  const days = [];
  const cur = new Date(startStr + 'T00:00:00Z');
  const end = new Date(today + 'T00:00:00Z');
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  if (!days.length) {
    return { currentStreak: 0, longestStreak: rule.longestStreak || 0, percentComplete: 0, last7Rate: 0, last30Rate: 0 };
  }

  // % complete — exclude today if no entry yet (notification may not have fired)
  const eligible = days.filter((d) => d < today || completions[d]);
  const doneDays = eligible.filter((d) => completions[d]?.status === 'done').length;
  const percentComplete = eligible.length > 0 ? Math.round((doneDays / eligible.length) * 100) : 0;

  // last 7 / last 30 rates (include today in window; today counts if done, doesn't if pending)
  const last7 = days.slice(-7);
  const last30 = days.slice(-30);
  const last7Done = last7.filter((d) => completions[d]?.status === 'done').length;
  const last30Done = last30.filter((d) => completions[d]?.status === 'done').length;
  const last7Rate = Math.round((last7Done / last7.length) * 100);
  const last30Rate = Math.round((last30Done / last30.length) * 100);

  // currentStreak — walk backward; skip today if no entry (pending, don't break)
  let currentStreak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d === today && !completions[d]) continue;
    if (completions[d]?.status === 'done') {
      currentStreak++;
    } else {
      break;
    }
  }

  // longestStreak — walk forward, same today-pending skip
  let streak = 0;
  let longestStreak = rule.longestStreak || 0;
  for (const d of days) {
    if (d === today && !completions[d]) continue;
    if (completions[d]?.status === 'done') {
      streak++;
      if (streak > longestStreak) longestStreak = streak;
    } else {
      streak = 0;
    }
  }
  longestStreak = Math.max(longestStreak, currentStreak);

  return { currentStreak, longestStreak, percentComplete, last7Rate, last30Rate };
}
