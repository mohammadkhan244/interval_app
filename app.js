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

  list.innerHTML = rules
    .map(
      (rule) => `
    <div class="rule-card ${rule.active ? '' : 'paused'}" data-id="${rule.id}">
      <div class="rule-top">
        <div style="flex:1">
          <div class="rule-message">${escHtml(rule.message)}</div>
          ${rule.description ? `<div class="rule-description">${escHtml(rule.description)}</div>` : ''}
          <div class="rule-meta">
            ${intervalLabel(rule.intervalValue, rule.intervalUnit)},
            ${windowLabel(rule.windowStart, rule.windowEnd, rule.timezone)}
          </div>
        </div>
        <label class="toggle" title="${rule.active ? 'Pause' : 'Resume'}">
          <input type="checkbox" class="toggle-active" data-id="${rule.id}" ${rule.active ? 'checked' : ''} />
          <span class="toggle-track"></span>
        </label>
      </div>
      <div class="rule-actions">
        <button class="btn-ghost btn-edit" data-id="${rule.id}">Edit</button>
        <button class="btn-ghost btn-danger btn-delete" data-id="${rule.id}">Delete</button>
      </div>
    </div>
  `
    )
    .join('');
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── State ───────────────────────────────────────────────────────────────────

let rules = [];

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
  const editBtn = e.target.closest('.btn-edit');
  const deleteBtn = e.target.closest('.btn-delete');

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
