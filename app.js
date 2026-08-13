// Replace with your actual VAPID public key after running npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = 'BBQCa2ZFsINX-mg6yzodYZl7fQ2y_J-pXBW7R-xBan9sTGQTk85qQkQ0bCpO6_6gg6-PNzkFXRzWb8tvPYpvndA'

// Shared secret for API auth — must match REMINDERS_SECRET env var on Vercel
const API_SECRET ='103074'

const API_HEADERS = {
  'Content-Type': 'application/json',
  'x-reminders-secret': API_SECRET,
};

// ─── Push subscription ───────────────────────────────────────────────────────

async function registerAndSubscribe() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  await fetch('/api/subscribe', {
    method: 'POST',
    headers: API_HEADERS,
    body: JSON.stringify(sub.toJSON()),
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(path, { headers: API_HEADERS });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, { method: 'POST', headers: API_HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(path, { method: 'PUT', headers: API_HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE', headers: API_HEADERS });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── Next-fire calculation ────────────────────────────────────────────────────

function getIntervalMs(value, unit) {
  const v = Number(value);
  if (unit === 'min')   return v * 60000;
  if (unit === 'hour')  return v * 3600000;
  if (unit === 'day')   return v * 86400000;
  if (unit === 'month') return v * 30 * 86400000;
  return Infinity;
}

function hhmToMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function tzLocalMin(date, tz) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  return Number(p.find(x => x.type === 'hour').value) * 60
       + Number(p.find(x => x.type === 'minute').value);
}

function atTimeInTz(date, hhmm, tz) {
  // Returns a Date whose local time in `tz` is `hhmm` on the same calendar day as `date` in `tz`
  const dfmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
  }).formatToParts(date);
  const ds = `${dfmt.find(p=>p.type==='year').value}-${dfmt.find(p=>p.type==='month').value}-${dfmt.find(p=>p.type==='day').value}`;
  const [h, m] = hhmm.split(':').map(Number);
  const approx = new Date(`${ds}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00Z`);
  // Correct for timezone offset: offset = approx_UTC - local_time_at_approx
  const loc = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(approx);
  const g = t => Number(loc.find(p=>p.type===t).value);
  const localMs = Date.UTC(g('year'), g('month')-1, g('day'), g('hour'), g('minute'), g('second'));
  return new Date(approx.getTime() * 2 - localMs);
}

function computeNextFire(rule) {
  if (!rule.active) return 'Paused';
  const tz = rule.timezone || 'America/Chicago';
  const ims = getIntervalMs(rule.intervalValue, rule.intervalUnit);
  if (!isFinite(ims)) return '—';

  const now = new Date();
  const ref = rule.lastFired ? new Date(rule.lastFired)
            : rule.createdAt ? new Date(rule.createdAt) : now;
  let next = new Date(ref.getTime() + ims);
  if (next < now) next = new Date(now);

  if (rule.windowStart || rule.windowEnd) {
    const ws = rule.windowStart || '00:00';
    const we = rule.windowEnd   || '23:59';
    const sMin = hhmToMin(ws);
    const eMin = hhmToMin(we);
    for (let i = 0; i < 8; i++) {
      const cur = tzLocalMin(next, tz);
      if (cur >= sMin && cur <= eMin) break;
      if (cur < sMin) { next = atTimeInTz(next, ws, tz); break; }
      next = atTimeInTz(new Date(next.getTime() + 86400000), ws, tz);
    }
  }

  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(next);
}

// ─── Render ──────────────────────────────────────────────────────────────────

function intervalLabel(value, unit) {
  const u = Number(value) === 1 ? unit.replace(/s$/, '') : unit + 's';
  return `every ${value} ${u}`;
}

function windowLabel(start, end, timezone) {
  if (!start && !end) return 'all day';
  const tz = timezone ? ` ${timezone}` : '';
  return `${start || '?'} – ${end || '?'}${tz}`;
}

function renderRules(rules) {
  const list = document.getElementById('rules-list');
  if (!rules.length) {
    list.innerHTML = '<p class="empty-state">No reminders yet.</p>';
    return;
  }

  list.innerHTML = rules.map((rule) => {
    const expanded = expandedIds.has(rule.id);
    const summary = `${intervalLabel(rule.intervalValue, rule.intervalUnit)} · ${windowLabel(rule.windowStart, rule.windowEnd, rule.timezone)} · 🔥 ${rule.currentStreak ?? 0}d`;
    const nextFire = computeNextFire(rule);
    const nextLabel = nextFire === 'Paused' ? 'Paused' : `Next: ${nextFire}`;
    return `
    <div class="rule-card ${rule.active ? '' : 'paused'} ${expanded ? 'expanded' : ''}" data-id="${rule.id}">
      <div class="rule-header">
        <div class="rule-summary">
          <div class="rule-message">${escHtml(rule.message)}</div>
          <div class="rule-meta">${summary}</div>
          <div class="rule-next">${nextLabel}</div>
        </div>
        <div class="rule-header-controls">
          <label class="toggle" title="${rule.active ? 'Pause' : 'Resume'}">
            <input type="checkbox" class="toggle-active" data-id="${rule.id}" ${rule.active ? 'checked' : ''} />
            <span class="toggle-track"></span>
          </label>
          <span class="chevron">›</span>
        </div>
      </div>
      <div class="rule-body">
        ${rule.description ? `<div class="rule-description">${escHtml(rule.description)}</div>` : ''}
        <div class="rule-stats">
          <span class="stat">🔥 ${rule.currentStreak ?? 0}d</span>
          <span class="stat">${rule.percentComplete ?? 0}% done</span>
          <span class="stat">Best ${rule.longestStreak ?? 0}d</span>
          <span class="stat">7d ${rule.last7Rate ?? 0}%</span>
          <span class="stat">30d ${rule.last30Rate ?? 0}%</span>
        </div>
        <div class="rule-actions">
          <button class="btn-done btn-ghost" data-id="${rule.id}">Done</button>
          <button class="btn-ghost btn-edit" data-id="${rule.id}">Edit</button>
          <button class="btn-ghost btn-danger btn-delete" data-id="${rule.id}">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── State ───────────────────────────────────────────────────────────────────

let rules = [];
const expandedIds = new Set();

async function loadRules() {
  try {
    rules = await apiGet('/api/rules');
    renderRules(rules);
  } catch (err) {
    console.error('Failed to load rules', err);
  }
}

// ─── Modal ───────────────────────────────────────────────────────────────────

function openModal(rule = null) {
  document.getElementById('modal-title').textContent = rule ? 'Edit Reminder' : 'Add Reminder';
  document.getElementById('field-id').value = rule ? rule.id : '';
  document.getElementById('field-message').value = rule ? rule.message : '';
  document.getElementById('field-interval-value').value = rule ? rule.intervalValue : 1;
  document.getElementById('field-interval-unit').value = rule ? rule.intervalUnit : 'hour';
  document.getElementById('field-description').value = rule ? (rule.description || '') : '';
  document.getElementById('field-window-start').value = rule ? (rule.windowStart || '') : '';
  document.getElementById('field-window-end').value = rule ? (rule.windowEnd || '') : '';
  document.getElementById('field-timezone').value = rule
    ? (rule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('field-message').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('rule-form').reset();
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

document.getElementById('btn-add').addEventListener('click', () => openModal());
document.getElementById('btn-cancel').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

document.getElementById('rule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('field-id').value;
  const payload = {
    message: document.getElementById('field-message').value.trim(),
    description: document.getElementById('field-description').value.trim() || null,
    intervalValue: Number(document.getElementById('field-interval-value').value),
    intervalUnit: document.getElementById('field-interval-unit').value,
    windowStart: document.getElementById('field-window-start').value || null,
    windowEnd: document.getElementById('field-window-end').value || null,
    timezone: document.getElementById('field-timezone').value.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  try {
    if (id) {
      await apiPut(`/api/rules?id=${id}`, payload);
    } else {
      await apiPost('/api/rules', payload);
    }
    closeModal();
    await loadRules();
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
});

document.getElementById('rules-list').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('toggle-active')) return;
  const { id } = e.target.dataset;
  const rule = rules.find((r) => r.id === id);
  if (!rule) return;
  try {
    await apiPut(`/api/rules?id=${id}`, { active: e.target.checked });
    rule.active = e.target.checked;
    document.querySelector(`.rule-card[data-id="${id}"]`).classList.toggle('paused', !e.target.checked);
  } catch (err) {
    e.target.checked = !e.target.checked;
    alert('Failed to update: ' + err.message);
  }
});

document.getElementById('rules-list').addEventListener('click', async (e) => {
  // Collapse/expand on header tap — but not when tapping the toggle switch
  const header = e.target.closest('.rule-header');
  if (header && !e.target.closest('.toggle')) {
    const card = header.closest('.rule-card');
    const id = card.dataset.id;
    if (expandedIds.has(id)) {
      expandedIds.delete(id);
      card.classList.remove('expanded');
    } else {
      expandedIds.add(id);
      card.classList.add('expanded');
    }
    return;
  }

  const doneBtn = e.target.closest('.btn-done');
  const editBtn = e.target.closest('.btn-edit');
  const deleteBtn = e.target.closest('.btn-delete');

  if (doneBtn) {
    doneBtn.textContent = '✓';
    doneBtn.disabled = true;
    try {
      await apiPost('/api/action', { ruleId: doneBtn.dataset.id, action: 'done' });
      await loadRules();
    } catch (err) {
      doneBtn.textContent = 'Done';
      doneBtn.disabled = false;
      alert('Failed: ' + err.message);
    }
  }

  if (editBtn) {
    const rule = rules.find((r) => r.id === editBtn.dataset.id);
    if (rule) openModal(rule);
  }

  if (deleteBtn) {
    if (!confirm('Delete this reminder?')) return;
    try {
      await apiDelete(`/api/rules?id=${deleteBtn.dataset.id}`);
      await loadRules();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  await loadRules();
  await registerAndSubscribe();
})();
