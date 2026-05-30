const STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'delivered'];
const STATUS_LABELS = { pending:'Pending', confirmed:'Confirmed', preparing:'Preparing', ready:'Ready', delivered:'Delivered' };

function load(key, def) {
  try { const d = localStorage.getItem('ordex_'+key); return d ? JSON.parse(d) : def; } catch(e) { return def; }
}
function save(key, data) {
  localStorage.setItem('ordex_'+key, JSON.stringify(data));
}

let orders = load('orders', []);
let activities = load('activities', []);
let searchTerm = '';
let statusFilter = 'all';
let priorityFilter = 'all';
let soundEnabled = load('sound', true);
let theme = load('theme', 'dark');

const channel = new BroadcastChannel('ordex');

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function fmt(n) { return '$' + Number(n).toFixed(2); }
function ago(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm ago';
}
function fmtItems(items) {
  if (!items || !items.length) return 'No items';
  return items.map(i => `${i.name} \u00d7${i.qty}`).join(', ');
}
function si(s) { return STATUSES.indexOf(s); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function uid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

function timerLabel(o) {
  if (!o.createdAt) return '';
  const elapsed = Date.now() - new Date(o.createdAt).getTime();
  const m = Math.floor(elapsed / 60000);
  if (m < 1) return '<i class="fas fa-stopwatch"></i> <1m';
  if (m < 60) return `<i class="fas fa-stopwatch"></i> ${m}m`;
  const h = Math.floor(m / 60);
  return `<i class="fas fa-stopwatch"></i> ${h}h ${m%60}m`;
}
function timerClass(o) {
  if (!o.createdAt || o.status === 'delivered') return '';
  const elapsed = Date.now() - new Date(o.createdAt).getTime();
  const m = Math.floor(elapsed / 60000);
  if (m > 30) return 'urgent';
  if (m > 15) return 'running';
  return '';
}

function persistOrders() { save('orders', orders); }
function persistActivities() { save('activities', activities); }
function persistSettings() { save('theme', theme); save('sound', soundEnabled); }

function broadcast(type, data) {
  channel.postMessage({ type, data, time: now() });
}
channel.onmessage = (e) => {
  const { type, data } = e.data;
  if (!type) return;
  switch (type) {
    case 'order:created':
      if (!orders.find(o => o.id === data.id)) { orders.push(data); persistOrders(); fullRender(); }
      break;
    case 'order:updated': {
      const idx = orders.findIndex(o => o.id === data.id);
      if (idx !== -1) { orders[idx] = data; persistOrders(); fullRender(); }
      break;
    }
    case 'order:deleted': {
      const len = orders.length;
      orders = orders.filter(o => o.id !== data.id);
      if (orders.length !== len) { persistOrders(); fullRender(); }
      break;
    }
    case 'activity:new':
      if (!activities.find(a => a.id === data.id)) { activities.unshift(data); persistActivities(); if ($('#activity-panel').classList.contains('open')) renderActivity(); }
      break;
  }
};

function addActivity(type, data) {
  const entry = { id: uid(), type, data, time: now() };
  activities.unshift(entry);
  if (activities.length > 200) activities.length = 200;
  persistActivities();
  broadcast('activity:new', entry);
  if ($('#activity-panel').classList.contains('open')) renderActivity();
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  theme = t; persistSettings();
  $('#btn-theme i').className = t === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
}
applyTheme(theme);
$('#btn-theme').addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));

function applySound(enabled) {
  soundEnabled = enabled; persistSettings();
  $('#btn-sound i').className = enabled ? 'fas fa-volume-up' : 'fas fa-volume-mute';
}
applySound(soundEnabled);
$('#btn-sound').addEventListener('click', () => applySound(!soundEnabled));

function playNotification() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; gain.gain.value = 0.08;
    osc.start(); osc.stop(ctx.currentTime + 0.12);
    setTimeout(() => {
      const o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.connect(g2); g2.connect(ctx.destination);
      o2.frequency.value = 1108; g2.gain.value = 0.06;
      o2.start(); o2.stop(ctx.currentTime + 0.1);
    }, 100);
  } catch(e) {}
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success:'fa-check-circle', error:'fa-exclamation-circle', info:'fa-info-circle' };
  el.innerHTML = `<span class="toast-icon"><i class="fas ${icons[type]||icons.info}"></i></span><span>${msg}</span>`;
  const container = $('#toast-container');
  container.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 3000);
}

function updateStats() {
  const total = orders.length;
  const revenue = orders.reduce((s,o) => s + (o.total||0), 0);
  const active = orders.filter(o => o.status !== 'delivered').length;
  const pending = orders.filter(o => o.status === 'pending').length;
  const avg = total ? revenue / total : 0;

  $('#stat-revenue').textContent = fmt(revenue); animEl('#stat-revenue');
  $('#stat-order-count').textContent = total;
  $('#stat-avg-order').textContent = fmt(avg);
  $('#stat-active').textContent = active;
  $('#stat-pending-count').textContent = pending;
  $('#stat-total').textContent = total;
  $('#stat-pending').textContent = pending;
  $('#stat-live').textContent = active;
  $('#live-count').textContent = active;
}
function animEl(id) {
  const el = typeof id === 'string' ? $(id) : id;
  if (el) { el.style.transform = 'scale(1.1)'; setTimeout(() => el.style.transform = '', 200); }
}

function fullRender() { renderDashboard(); renderTracking(); }

function renderDashboard() {
  const term = searchTerm.toLowerCase();
  let filtered = orders;
  if (statusFilter !== 'all') filtered = filtered.filter(o => o.status === statusFilter);
  if (priorityFilter !== 'all') filtered = filtered.filter(o => o.priority === priorityFilter);
  if (term) filtered = filtered.filter(o => o.customerName.toLowerCase().includes(term) || fmtItems(o.items).toLowerCase().includes(term));

  const board = $('#board');
  if (!orders.length) {
    board.innerHTML = `<div class="dashboard-empty">
      <div class="dashboard-empty-icon"><i class="fas fa-clipboard-list"></i></div>
      <h2>No orders yet</h2>
      <p>Create your first order to start tracking it through the workflow. You can drag and drop cards between columns.</p>
      <button class="btn btn-primary" onclick="openModal(null)"><i class="fas fa-plus"></i> Create First Order</button>
    </div>`;
    updateStats();
    return;
  }

  if (board.querySelector('.dashboard-empty')) {
    board.innerHTML = '';
    ['pending','confirmed','preparing','ready','delivered'].forEach(s => {
      const col = document.createElement('div');
      col.className = 'board-col';
      col.dataset.status = s;
      col.innerHTML = `<div class="col-header"><i class="fas fa-${s==='pending'?'clock':s==='confirmed'?'check-circle':s==='preparing'?'fire':s==='ready'?'check-double':'flag-checkered'}"></i> ${STATUS_LABELS[s]} <span class="col-count" id="count-${s}">0</span></div><div class="col-body" id="col-${s}"></div>`;
      board.appendChild(col);
    });
  }

  STATUSES.forEach(s => {
    const col = $(`#col-${s}`);
    if (!col) return;
    col.innerHTML = filtered.filter(o => o.status === s).map(o => cardHTML(o)).join('');
    $(`#count-${s}`).textContent = orders.filter(o => o.status === s).length;
  });
  updateStats();
}

function cardHTML(o) {
  const s = o.status;
  const p = o.priority || 'normal';
  const tc = timerClass(o);
  return `
    <div class="order-card" draggable="true" data-id="${o.id}" data-status="${s}" data-priority="${p}">
      <div class="order-card-header">
        <span class="order-card-name">${esc(o.customerName)}</span>
        <span class="order-card-time">${ago(o.updatedAt || o.createdAt)}</span>
      </div>
      <div class="order-card-meta">
        <span class="priority-badge ${p}"><i class="fas fa-flag"></i> ${p}</span>
        ${o.notes ? `<span style="font-size:.6rem;color:var(--text2)"><i class="fas fa-sticky-note"></i></span>` : ''}
      </div>
      <div class="order-card-items">${esc(fmtItems(o.items))}</div>
      <div class="order-card-footer">
        <span class="order-card-total">${fmt(o.total)}</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="order-card-timer ${tc}">${timerLabel(o)}</span>
          <div class="order-card-actions">
            ${s !== 'delivered' ? `<button class="btn-icon" onclick="advanceStatus('${o.id}')" title="Advance"><i class="fas fa-chevron-right"></i></button>` : ''}
            ${s === 'pending' ? `<button class="btn-icon" onclick="editOrder('${o.id}')" title="Edit"><i class="fas fa-pen"></i></button>` : ''}
            <button class="btn-icon danger" onclick="deleteOrder('${o.id}')" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderTracking() {
  const active = orders.filter(o => o.status !== 'delivered');
  const grid = $('#tracking-grid');
  const empty = $('#tracking-empty');
  if (!active.length) { grid.innerHTML = ''; empty.style.display = 'block'; updateStats(); return; }
  empty.style.display = 'none';
  grid.innerHTML = active.map(o => trackingHTML(o)).join('');
  updateStats();
}

function trackingHTML(o) {
  const idx = si(o.status);
  const p = o.priority || 'normal';
  const tc = timerClass(o);
  const timerClean = timerLabel(o);
  const nextStatus = STATUSES[idx + 1] ? STATUS_LABELS[STATUSES[idx + 1]] : '';
  return `
    <div class="tracking-card" data-id="${o.id}">
      <div class="tracking-card-header">
        <div class="tracking-card-info">
          <span class="tracking-card-name">${esc(o.customerName)}</span>
          <div class="tracking-card-meta">
            <span class="priority-badge ${p}"><i class="fas fa-flag"></i> ${p}</span>
            ${o.notes ? `<span style="font-size:.65rem;color:var(--text2);display:inline-flex;align-items:center;gap:4px"><i class="fas fa-sticky-note"></i> Note</span>` : ''}
          </div>
        </div>
        <span class="status-badge ${o.status}">${STATUS_LABELS[o.status]}</span>
      </div>
      <div class="progress-track">
        ${STATUSES.filter(s => s !== 'delivered').map((s, i) => `
          <div class="progress-step">
            <div class="progress-dot ${i < idx ? 'completed' : i === idx ? 'active' : ''}"></div>
            <span class="progress-step-label ${i < idx ? 'completed' : i === idx ? 'active' : ''}">${STATUS_LABELS[s]}</span>
          </div>
        `).join('')}
      </div>
      <div class="tracking-card-body">
        <div class="tracking-card-items"><strong>Items:</strong> ${esc(fmtItems(o.items))}</div>
        ${o.notes ? `<div class="tracking-card-notes"><i class="fas fa-quote-left" style="opacity:.4;flex-shrink:0;margin-top:2px"></i>${esc(o.notes)}</div>` : ''}
      </div>
      <div class="tracking-card-footer">
        <span class="tracking-total">${fmt(o.total)}</span>
        <span class="tracking-wait ${tc}"><i class="fas fa-stopwatch"></i> ${timerClean.replace(/<[^>]*>/g,'')}</span>
      </div>
      ${o.status !== 'delivered' ? `<button class="btn-advance" onclick="advanceStatus('${o.id}')"><i class="fas fa-chevron-right"></i> Advance to ${nextStatus}</button>` : ''}
    </div>
  `;
}

let timerInterval;
function startTimerLoop() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const activeTab = $('.tab-btn.active');
    if (!activeTab) return;
    if (activeTab.dataset.tab === 'tracking') { renderTracking(); }
    else { $$('.order-card-timer').forEach(el => {
      const card = el.closest('.order-card');
      if (!card) return;
      const o = orders.find(x => x.id === card.dataset.id);
      if (!o) return;
      el.className = 'order-card-timer ' + timerClass(o);
      el.innerHTML = timerLabel(o);
    });}
  }, 10000);
}

document.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.order-card');
  if (!card) return;
  e.dataTransfer.setData('text/plain', card.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
  card.classList.add('dragging');
});
document.addEventListener('dragend', (e) => {
  $$('.order-card.dragging').forEach(c => c.classList.remove('dragging'));
  $$('.board-col.drag-over').forEach(c => c.classList.remove('drag-over'));
});
document.addEventListener('dragover', (e) => {
  const col = e.target.closest('.board-col');
  if (!col) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  col.classList.add('drag-over');
});
document.addEventListener('dragleave', (e) => {
  const col = e.target.closest('.board-col');
  if (!col) return;
  col.classList.remove('drag-over');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  $$('.board-col.drag-over').forEach(c => c.classList.remove('drag-over'));
  const col = e.target.closest('.board-col');
  const id = e.dataTransfer.getData('text/plain');
  if (!col || !id) return;
  const newStatus = col.dataset.status;
  const order = orders.find(o => o.id === id);
  if (!order || order.status === newStatus) return;
  const from = order.status;
  order.status = newStatus;
  order.updatedAt = now();
  order.statusTimestamps = order.statusTimestamps || {};
  order.statusTimestamps[newStatus] = now();
  persistOrders();
  broadcast('order:updated', order);
  addActivity('order:advanced', { id: order.id, customerName: order.customerName, from, to: newStatus });
  playNotification();
  toast(`${order.customerName}: ${from} \u2192 ${newStatus}`, 'info');
  fullRender();
});

// Touch drag-and-drop for mobile
let touchDragCard = null, touchDragGhost = null, touchDragTimer = null, touchMoved = false;
function getColUnderTouch(touch) {
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  return el ? el.closest('.board-col') : null;
}
document.addEventListener('touchstart', (e) => {
  const card = e.target.closest('.order-card');
  if (!card || e.target.closest('.btn-icon, button')) return;
  touchMoved = false;
  touchDragCard = card;
  const touch = e.touches[0];
  touchDragTimer = setTimeout(() => {
    if (!touchDragCard) return;
    touchDragGhost = card.cloneNode(true);
    touchDragGhost.classList.add('dragging');
    touchDragGhost.style.cssText = `position:fixed;z-index:9999;pointer-events:none;width:${card.offsetWidth}px;opacity:.85;transform:scale(1.03) rotate(1.5deg);box-shadow:0 16px 48px rgba(0,0,0,.3);transition:none;`;
    document.body.appendChild(touchDragGhost);
    moveTouchGhost(touch);
    card.classList.add('dragging');
    if (navigator.vibrate) navigator.vibrate(20);
  }, 250);
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!touchDragCard) return;
  touchMoved = true;
  const touch = e.touches[0];
  if (touchDragGhost) {
    e.preventDefault();
    moveTouchGhost(touch);
    $$('.board-col.drag-over').forEach(c => c.classList.remove('drag-over'));
    const col = getColUnderTouch(touch);
    if (col && col.dataset.status !== touchDragCard.dataset.status) col.classList.add('drag-over');
  } else {
    const dx = Math.abs(e.touches[0].clientX - (touchDragCard._startX || 0));
    const dy = Math.abs(e.touches[0].clientY - (touchDragCard._startY || 0));
    if (dx > 10 || dy > 10) { clearTimeout(touchDragTimer); touchDragCard = null; }
  }
}, { passive: false });
document.addEventListener('touchend', (e) => {
  clearTimeout(touchDragTimer);
  if (touchDragGhost) {
    const touch = e.changedTouches[0];
    const col = getColUnderTouch(touch);
    if (col && touchDragCard) {
      const id = touchDragCard.dataset.id;
      const newStatus = col.dataset.status;
      const order = orders.find(o => o.id === id);
      if (order && order.status !== newStatus) {
        const from = order.status;
        order.status = newStatus; order.updatedAt = now();
        order.statusTimestamps = order.statusTimestamps || {};
        order.statusTimestamps[newStatus] = now();
        persistOrders(); broadcast('order:updated', order);
        addActivity('order:advanced', { id: order.id, customerName: order.customerName, from, to: newStatus });
        playNotification();
        toast(`${order.customerName}: ${from} \u2192 ${newStatus}`, 'info');
        fullRender();
      }
    }
    touchDragGhost.remove(); touchDragGhost = null;
    if (touchDragCard) touchDragCard.classList.remove('dragging');
    touchDragCard = null;
    $$('.board-col.drag-over').forEach(c => c.classList.remove('drag-over'));
  } else if (touchDragCard && !touchMoved) {
    touchDragCard = null;
  } else {
    touchDragCard = null;
  }
});
function moveTouchGhost(touch) {
  if (!touchDragGhost) return;
  touchDragGhost.style.left = (touch.clientX - touchDragGhost.offsetWidth / 2) + 'px';
  touchDragGhost.style.top = (touch.clientY - 30) + 'px';
}

// Debounced search
let searchDebounce;
function debouncedSearch(value) {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => { searchTerm = value; renderDashboard(); }, 200);
}

function advanceStatus(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const idx = si(o.status);
  if (idx >= STATUSES.length - 1) return toast('Order already delivered', 'info');
  const from = o.status;
  const next = STATUSES[idx + 1];
  o.status = next;
  o.updatedAt = now();
  o.statusTimestamps = o.statusTimestamps || {};
  o.statusTimestamps[next] = now();
  persistOrders();
  broadcast('order:updated', o);
  addActivity('order:advanced', { id: o.id, customerName: o.customerName, from, to: next });
  playNotification();
  toast(`${o.customerName}: ${from} \u2192 ${next}`, 'success');
  fullRender();
}

function deleteOrder(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  if (!confirm(`Delete order for ${o.customerName}?`)) return;
  orders = orders.filter(x => x.id !== id);
  persistOrders();
  broadcast('order:deleted', { id });
  addActivity('order:deleted', { id: o.id, customerName: o.customerName });
  toast('Order deleted', 'error');
  fullRender();
}

function editOrder(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  if (o.status !== 'pending') {
    toast('Can only edit orders in Pending status', 'error');
    return;
  }
  openModal(o);
}

$('#btn-clear').addEventListener('click', () => {
  const delivered = orders.filter(o => o.status === 'delivered');
  if (!delivered.length) return toast('No delivered orders to clear', 'info');
  if (!confirm(`Clear ${delivered.length} delivered order${delivered.length > 1 ? 's' : ''}?`)) return;
  delivered.forEach(o => addActivity('order:deleted', { id: o.id, customerName: o.customerName }));
  orders = orders.filter(o => o.status !== 'delivered');
  persistOrders();
  broadcast('order:deleted', { bulk: true });
  toast(`${delivered.length} delivered order${delivered.length > 1 ? 's' : ''} cleared`, 'success');
  fullRender();
});

function toggleActivity() {
  const p = $('#activity-panel'), o = $('#activity-overlay');
  const open = p.classList.toggle('open');
  o.classList.toggle('open', open);
  if (open) renderActivity();
}
function renderActivity() {
  const body = $('#activity-body');
  const countEl = $('#activity-count');
  if (countEl) countEl.textContent = activities.length;
  if (!activities.length) {
    body.innerHTML = '<div class="activity-empty"><i class="fas fa-stream"></i><h2>No activity yet</h2><p>Actions like creating, editing, and advancing orders will appear here.</p></div>';
    return;
  }
  body.innerHTML = activities.map(a => activityHTML(a)).join('');
}
function activityHTML(a) {
  const icons = { 'order:created':'fa-plus-circle','order:advanced':'fa-arrow-right','order:edited':'fa-pen','order:updated':'fa-sync','order:deleted':'fa-trash' };
  const names = { 'order:created':'created','order:advanced':'advanced','order:edited':'edited','order:updated':'updated','order:deleted':'deleted' };
  const ic = names[a.type] || 'created';
  let msg = '';
  switch (a.type) {
    case 'order:created': msg = `<strong>${esc(a.data.customerName)}</strong> — ${fmt(a.data.total)}`; break;
    case 'order:advanced': msg = `<strong>${esc(a.data.customerName)}</strong> ${esc(a.data.from)} \u2192 ${esc(a.data.to)}`; break;
    case 'order:edited': msg = `<strong>${esc(a.data.customerName)}</strong> updated ${esc(a.data.changed)}`; break;
    case 'order:updated': msg = `<strong>${esc(a.data.customerName)}</strong> ${esc(a.data.from)} \u2192 ${esc(a.data.to)}`; break;
    case 'order:deleted': msg = `<strong>${esc(a.data.customerName)}</strong> removed`; break;
    default: msg = esc(JSON.stringify(a.data));
  }
  return `<div class="activity-item"><div class="activity-icon ${ic}"><i class="fas ${icons[a.type] || 'fa-circle'}"></i></div><div class="activity-content"><div class="activity-msg">${msg}</div><div class="activity-time"><i class="far fa-clock"></i> ${ago(a.time)}</div></div></div>`;
}

$('#btn-activity').addEventListener('click', toggleActivity);
$('#activity-close').addEventListener('click', toggleActivity);
$('#activity-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) toggleActivity(); });

function openModal(order) {
  const isEdit = !!order;
  $('#modal-title').textContent = isEdit ? 'Edit Order' : 'New Order';
  $('#form-submit').innerHTML = isEdit ? '<i class="fas fa-save"></i> Update Order' : '<i class="fas fa-plus"></i> Create Order';
  $('#form-id').value = isEdit ? order.id : '';
  $('#form-name').value = isEdit ? order.customerName : '';
  $('#form-priority').value = isEdit ? (order.priority || 'normal') : 'normal';
  $('#form-order-num').value = isEdit ? '#' + order.id.slice(0, 6).toUpperCase() : '#' + (orders.length + 1).toString().padStart(4, '0');
  $('#form-notes').value = isEdit ? (order.notes || '') : '';

  const container = $('#items-container');
  container.innerHTML = '';
  const items = isEdit ? order.items : [];
  if (items.length) items.forEach((item, i) => addItemRow(item, i === 0));
  else addItemRow(null, true);
  updateTotal();
  $('#modal-overlay').classList.add('open');
  setTimeout(() => $('#form-name').focus(), 100);
}

function addItemRow(data, isFirst) {
  const container = $('#items-container');
  const row = document.createElement('div');
  row.className = 'item-row';
  const name = data ? data.name : '';
  const qty = data ? data.qty : 1;
  const price = data ? data.price : '';
  row.innerHTML = `
    <input type="text" class="item-name" placeholder="Item name" value="${esc(name)}" required />
    <input type="number" class="item-qty" placeholder="Qty" value="${qty}" min="1" required />
    <input type="number" class="item-price" placeholder="Price" step="0.01" min="0" value="${price}" required />
    <button type="button" class="btn-icon item-remove" ${isFirst && !data ? 'disabled' : ''}><i class="fas fa-trash"></i></button>
  `;
  row.querySelector('.item-remove').addEventListener('click', () => {
    if (container.children.length <= 1) return;
    row.remove(); updateTotal();
  });
  row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateTotal));
  container.appendChild(row);
}

function updateTotal() {
  let total = 0;
  $$('.item-row').forEach(row => {
    const qty = parseFloat(row.querySelector('.item-qty')?.value) || 0;
    const price = parseFloat(row.querySelector('.item-price')?.value) || 0;
    total += qty * price;
  });
  $('#form-total').textContent = fmt(total);
}

function closeModal() { $('#modal-overlay').classList.remove('open'); }

$('#order-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = $('#form-id').value;
  const isEdit = !!id;
  const customerName = $('#form-name').value.trim();
  const priority = $('#form-priority').value;
  const notes = $('#form-notes').value.trim();
  const items = [];
  let total = 0;
  $$('.item-row').forEach(row => {
    const name = row.querySelector('.item-name').value.trim();
    const qty = parseInt(row.querySelector('.item-qty').value) || 0;
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    if (name && qty > 0) { items.push({ name, qty, price }); total += qty * price; }
  });
  if (!customerName || !items.length) return toast('Enter a name and at least one item', 'error');

  if (isEdit) {
    const o = orders.find(x => x.id === id);
    if (!o) return;
    if (o.status !== 'pending') { toast('Can only edit orders in Pending status', 'error'); closeModal(); return; }
    const changed = [];
    if (customerName !== o.customerName) changed.push('name');
    if (priority !== o.priority) changed.push('priority');
    if (JSON.stringify(items) !== JSON.stringify(o.items)) changed.push('items');
    if (notes !== (o.notes || '')) changed.push('notes');
    Object.assign(o, { customerName, items, total, notes, priority, updatedAt: now() });
    persistOrders();
    broadcast('order:updated', o);
    if (changed.length) addActivity('order:edited', { id: o.id, customerName, changed: changed.join(', ') });
    toast('Order updated', 'success');
    playNotification();
  } else {
    const timestamps = {}; timestamps.pending = now();
    const order = {
      id: uid(), customerName, items, status: 'pending', total, notes,
      priority, statusTimestamps: timestamps, createdAt: now(), updatedAt: now(),
    };
    orders.push(order);
    persistOrders();
    broadcast('order:created', order);
    addActivity('order:created', { id: order.id, customerName, total });
    toast('Order created', 'success');
    playNotification();
  }
  closeModal();
  fullRender();
});

$('#form-cancel').addEventListener('click', closeModal);
$('#modal-close').addEventListener('click', closeModal);
$('#modal-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); if ($('#activity-panel').classList.contains('open')) toggleActivity(); }
  if ((e.key === 'n' || e.key === 'N') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openModal(null); }
});

$('#btn-add-item').addEventListener('click', () => addItemRow(null, false));
$('#btn-add-order').addEventListener('click', () => openModal(null));

$('#search-input').addEventListener('input', (e) => { debouncedSearch(e.target.value); });

$$('.chip:not(.priority-chip)').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('.chip:not(.priority-chip)').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    statusFilter = chip.dataset.filter;
    renderDashboard();
  });
});
$$('.priority-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('.priority-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    priorityFilter = chip.dataset.priority;
    renderDashboard();
  });
});

$('#btn-export').addEventListener('click', () => {
  if (!orders.length) return toast('No orders to export', 'info');
  const headers = ['ID','Customer','Items','Total','Status','Priority','Notes','Created','Updated'];
  const rows = orders.map(o => [
    o.id, o.customerName,
    o.items.map(i => `${i.name} x${i.qty} ($${i.price})`).join('; '),
    o.total, o.status, o.priority || 'normal', o.notes || '', o.createdAt, o.updatedAt
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `ordex-orders-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Orders exported', 'success');
});

// Mobile hamburger toggle
$('#nav-hamburger').addEventListener('click', (e) => {
  e.stopPropagation();
  const nav = document.querySelector('.navbar');
  const icon = $('#nav-hamburger i');
  nav.classList.toggle('mobile-open');
  icon.className = nav.classList.contains('mobile-open') ? 'fas fa-times' : 'fas fa-bars';
});
document.addEventListener('click', (e) => {
  const nav = document.querySelector('.navbar');
  if (nav.classList.contains('mobile-open') && !nav.contains(e.target)) {
    nav.classList.remove('mobile-open');
    $('#nav-hamburger i').className = 'fas fa-bars';
  }
});

$$('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`#panel-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'tracking') renderTracking();
    else renderDashboard();
    // Close mobile menu on tab switch
    const nav = document.querySelector('.navbar');
    if (nav.classList.contains('mobile-open')) {
      nav.classList.remove('mobile-open');
      $('#nav-hamburger i').className = 'fas fa-bars';
    }
  });
});

fullRender();
startTimerLoop();