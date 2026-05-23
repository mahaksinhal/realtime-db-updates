// Real-time Client Application Logic
const API_URL = `${window.location.protocol}//${window.location.host}/api/orders`;
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

let orders = [];
let ws = null;
let reconnectTimer = null;

// DOM Elements
const connectionStatus = document.getElementById('connection-status');
const connectionText = document.getElementById('connection-text');
const activeClientsCount = document.getElementById('active-clients-count');
const ordersGrid = document.getElementById('orders-grid');
const orderForm = document.getElementById('order-form');
const logsContainer = document.getElementById('logs-container');
const clearLogsBtn = document.getElementById('clear-logs');
const refreshIndicator = document.getElementById('refresh-indicator');

// Stats DOM Elements
const statTotal = document.getElementById('stat-total');
const statPending = document.getElementById('stat-pending');
const statShipped = document.getElementById('stat-shipped');
const statDelivered = document.getElementById('stat-delivered');

// Fetch Initial State from the Database via REST
async function fetchOrders() {
  showSyncing(true);
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error('HTTP error fetching orders.');
    orders = await response.json();
    renderOrders();
    updateStats();
  } catch (err) {
    console.error('Error loading initial orders:', err);
    addLogEntry('SYSTEM', 'ERROR', `Failed to load initial state: ${err.message}`);
  } finally {
    showSyncing(false);
  }
}

// Establish Real-time WebSocket connection
function connectWebSocket() {
  if (ws) {
    ws.close();
  }

  setConnectionState('connecting', 'Connecting...');
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[WebSocket] Connection established.');
    setConnectionState('connected', 'Live Connected');
    addLogEntry('SYSTEM', 'INFO', 'Real-time WebSocket link established.');
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
    // Re-fetch orders on reconnection to ensure no lost updates during downtime
    fetchOrders();
  };

  ws.onmessage = (event) => {
    try {
      const packet = JSON.parse(event.data);
      handleRealtimeUpdate(packet);
    } catch (err) {
      console.error('[WebSocket] Failed to parse socket message:', err);
    }
  };

  ws.onclose = (event) => {
    console.log('[WebSocket] Connection closed. Code:', event.code);
    setConnectionState('disconnected', 'Offline');
    addLogEntry('SYSTEM', 'WARN', 'WebSocket link severed. Reconnecting in 3s...');
    
    if (!reconnectTimer) {
      reconnectTimer = setInterval(connectWebSocket, 3000);
    }
  };

  ws.onerror = (err) => {
    console.error('[WebSocket] Error detected:', err);
  };
}

// Set visual state of Connection status badge
function setConnectionState(state, text) {
  connectionStatus.className = 'connection-status';
  connectionStatus.classList.add(state);
  connectionText.textContent = text;
}

// Handle Real-time CDC changes received via WebSocket
function handleRealtimeUpdate(packet) {
  // Check if it's a system broadcast
  if (packet.type === 'SYSTEM') {
    activeClientsCount.textContent = packet.connectedClients || 1;
    return;
  }

  const { action, data, timestamp } = packet;
  const orderId = data.id;

  // Visual Sync feedback
  triggerSyncIndicator();

  // Route depending on operation action
  switch (action) {
    case 'INSERT':
      orders.unshift(data);
      insertOrderDOM(data);
      addLogEntry(timestamp, 'INSERT', `Order ID #${orderId} created by ${data.customer_name}`);
      break;

    case 'UPDATE':
      const updateIdx = orders.findIndex(o => o.id === orderId);
      if (updateIdx !== -1) {
        orders[updateIdx] = data;
      } else {
        orders.unshift(data);
      }
      updateOrderDOM(data);
      addLogEntry(timestamp, 'UPDATE', `Order ID #${orderId} updated to [${data.status}]`);
      break;

    case 'DELETE':
      orders = orders.filter(o => o.id !== orderId);
      deleteOrderDOM(orderId);
      addLogEntry(timestamp, 'DELETE', `Order ID #${orderId} removed from database`);
      break;
  }

  updateStats();
}

// UI State utilities
function showSyncing(show) {
  if (show) refreshIndicator.classList.add('active');
  else refreshIndicator.classList.remove('active');
}

function triggerSyncIndicator() {
  refreshIndicator.classList.add('active');
  setTimeout(() => refreshIndicator.classList.remove('active'), 800);
}

// Render entire grid (typically on initial fetch)
function renderOrders() {
  ordersGrid.innerHTML = '';
  
  if (orders.length === 0) {
    ordersGrid.innerHTML = `
      <div class="empty-orders-msg">
        <span class="material-symbols-outlined empty-icon">inventory_2</span>
        <p>No orders currently in the database.</p>
        <p class="sub-msg">Create one using the form or run the background simulator script.</p>
      </div>
    `;
    return;
  }

  orders.forEach(order => {
    const card = createOrderCard(order);
    ordersGrid.appendChild(card);
  });
}

// HTML Card Generator
function createOrderCard(order) {
  const card = document.createElement('div');
  card.className = `order-card`;
  card.id = `order-${order.id}`;

  const timeString = new Date(order.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  card.innerHTML = `
    <div class="order-card-header">
      <span class="order-id">ID: #${order.id}</span>
      <span class="order-status-badge status-badge-${order.status}" id="status-badge-${order.id}">
        ${order.status}
      </span>
    </div>
    <div class="order-details">
      <h3 class="order-product">${order.product_name}</h3>
      <p class="order-customer">
        <span class="material-symbols-outlined">person</span>
        ${order.customer_name}
      </p>
    </div>
    <div class="order-footer">
      <div class="order-time">
        <span class="material-symbols-outlined">schedule</span>
        <span id="time-${order.id}">${timeString}</span>
      </div>
      <div class="order-actions">
        ${order.status !== 'delivered' ? `
          <button class="btn-icon btn-icon-advance" onclick="advanceOrderStatus(${order.id}, '${order.status}')" title="Advance status">
            <span class="material-symbols-outlined">arrow_forward</span>
          </button>
        ` : ''}
        <button class="btn-icon btn-icon-delete" onclick="deleteOrder(${order.id})" title="Delete order">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>
  `;

  return card;
}

// DOM Manipulations for Real-time events
function insertOrderDOM(order) {
  // Remove empty message if it exists
  const emptyMsg = ordersGrid.querySelector('.empty-orders-msg');
  if (emptyMsg) emptyMsg.remove();

  const card = createOrderCard(order);
  card.classList.add('order-card-new');
  ordersGrid.insertBefore(card, ordersGrid.firstChild);

  // Clean animation class after execution to support hover transforms
  setTimeout(() => {
    card.classList.remove('order-card-new');
  }, 1500);
}

function updateOrderDOM(order) {
  const card = document.getElementById(`order-${order.id}`);
  
  if (!card) {
    // If not found in DOM, insert it (fail-safety)
    insertOrderDOM(order);
    return;
  }

  // Update specific fields
  const timeString = new Date(order.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  // Update status badge
  const badge = document.getElementById(`status-badge-${order.id}`);
  badge.className = `order-status-badge status-badge-${order.status}`;
  badge.textContent = order.status;

  // Update values
  card.querySelector('.order-product').textContent = order.product_name;
  card.querySelector('.order-customer').innerHTML = `
    <span class="material-symbols-outlined">person</span>
    ${order.customer_name}
  `;
  document.getElementById(`time-${order.id}`).textContent = timeString;

  // Re-generate action buttons based on status
  const actionsContainer = card.querySelector('.order-actions');
  actionsContainer.innerHTML = `
    ${order.status !== 'delivered' ? `
      <button class="btn-icon btn-icon-advance" onclick="advanceOrderStatus(${order.id}, '${order.status}')" title="Advance status">
        <span class="material-symbols-outlined">arrow_forward</span>
      </button>
    ` : ''}
    <button class="btn-icon btn-icon-delete" onclick="deleteOrder(${order.id})" title="Delete order">
      <span class="material-symbols-outlined">delete</span>
    </button>
  `;

  // Flash update animation
  card.classList.add('order-card-changed');
  setTimeout(() => {
    card.classList.remove('order-card-changed');
  }, 1500);
}

function deleteOrderDOM(id) {
  const card = document.getElementById(`order-${id}`);
  if (!card) return;

  // Run beautiful fade out shrink animation
  card.classList.add('order-card-removed');
  setTimeout(() => {
    card.remove();
    // Render empty state if grid is now empty
    if (ordersGrid.children.length === 0) {
      renderOrders();
    }
  }, 600);
}

// Calculate and render Live Analytics widgets
function updateStats() {
  const total = orders.length;
  const pending = orders.filter(o => o.status === 'pending').length;
  const shipped = orders.filter(o => o.status === 'shipped').length;
  const delivered = orders.filter(o => o.status === 'delivered').length;

  animateStatChange(statTotal, total);
  animateStatChange(statPending, pending);
  animateStatChange(statShipped, shipped);
  animateStatChange(statDelivered, delivered);
}

// Stat animation utility
function animateStatChange(element, newValue) {
  const currentValue = parseInt(element.textContent, 10) || 0;
  if (currentValue === newValue) return;

  element.style.transform = 'scale(1.2)';
  element.style.transition = 'transform 0.15s ease-out';
  element.textContent = newValue;
  
  setTimeout(() => {
    element.style.transform = 'scale(1)';
  }, 150);
}

// Append CDC Event Logs
function addLogEntry(timestamp, action, message) {
  const logItem = document.createElement('div');
  logItem.className = `log-item log-${action.toLowerCase()}`;
  
  let formattedTime = '';
  if (timestamp === 'SYSTEM') {
    formattedTime = new Date().toLocaleTimeString([], { hour12: false });
  } else {
    formattedTime = new Date(timestamp).toLocaleTimeString([], { hour12: false });
  }

  logItem.innerHTML = `
    <span class="log-time">[${formattedTime}]</span>
    <span class="log-action">${action}</span>
    <span class="log-msg">${message}</span>
  `;

  // Remove empty label
  const emptyLabel = logsContainer.querySelector('.log-empty-msg');
  if (emptyLabel) emptyLabel.remove();

  logsContainer.appendChild(logItem);
  logsContainer.scrollTop = logsContainer.scrollHeight;
}

// REST Action Triggers (Invoked from UI elements)
async function deleteOrder(id) {
  try {
    const response = await fetch(`${API_URL}/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete order.');
  } catch (err) {
    console.error('Error deleting order:', err);
    addLogEntry('SYSTEM', 'ERROR', `Failed to delete order: ${err.message}`);
  }
}

async function advanceOrderStatus(id, currentStatus) {
  let nextStatus = 'pending';
  if (currentStatus === 'pending') nextStatus = 'shipped';
  else if (currentStatus === 'shipped') nextStatus = 'delivered';

  try {
    const response = await fetch(`${API_URL}/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: nextStatus })
    });
    if (!response.ok) throw new Error('Failed to update status.');
  } catch (err) {
    console.error('Error updating order:', err);
    addLogEntry('SYSTEM', 'ERROR', `Failed to update order status: ${err.message}`);
  }
}

// Event Listeners
orderForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const customer_name = document.getElementById('customer_name').value.trim();
  const product_name = document.getElementById('product_name').value.trim();
  const status = document.getElementById('status').value;

  if (!customer_name || !product_name || !status) return;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ customer_name, product_name, status })
    });

    if (!response.ok) throw new Error('Failed to create order.');

    // Clear form
    orderForm.reset();
  } catch (err) {
    console.error('Error submitting order:', err);
    addLogEntry('SYSTEM', 'ERROR', `Form submit failed: ${err.message}`);
  }
});

clearLogsBtn.addEventListener('click', () => {
  logsContainer.innerHTML = '<div class="log-empty-msg">Waiting for database events...</div>';
});

// Initialize on Load
window.addEventListener('DOMContentLoaded', () => {
  fetchOrders();
  connectWebSocket();
});
