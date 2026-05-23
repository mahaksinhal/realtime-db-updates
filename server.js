import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { orderRepository } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());

// Serve Static Files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Define REST API Endpoints for CRUD
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await orderRepository.getAll();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  const { customer_name, product_name, status } = req.body;
  if (!customer_name || !product_name || !status) {
    return res.status(400).json({ error: 'customer_name, product_name, and status are required fields.' });
  }
  
  try {
    const newOrder = await orderRepository.create({ customer_name, product_name, status });
    res.status(201).json(newOrder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { customer_name, product_name, status } = req.body;
  
  try {
    const updated = await orderRepository.update(parseInt(id, 10), { customer_name, product_name, status });
    res.json(updated);
  } catch (err) {
    if (err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const deleted = await orderRepository.delete(parseInt(id, 10));
    res.json({ message: 'Order successfully deleted.', order: deleted });
  } catch (err) {
    if (err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Setup HTTP Server
const server = http.createServer(app);

// Setup WebSocket Server (WS)
const wss = new WebSocketServer({ noServer: true });

// Attach WS server upgrade handling manually to standard HTTP server
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Broadcast helper function to push updates to all active clients
const broadcast = (payload) => {
  const serialized = JSON.stringify(payload);
  let activeClients = 0;
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(serialized);
      activeClients++;
    }
  });
  
  console.log(`[WebSocket Broadcast] Sent [${payload.action}] event for order ID ${payload.data.id} to ${activeClients} active clients.`);
};

// Listen for Repository Change Events and Broadcast
orderRepository.on('change', (changePayload) => {
  // Format the WebSocket packet
  const wsPacket = {
    timestamp: new Date().toISOString(),
    ...changePayload
  };
  
  broadcast(wsPacket);
});

// Manage connections and implement heartbeat keep-alive
wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  const ip = req.socket.remoteAddress;
  console.log(`[WebSocket Connection] Client connected from IP: ${ip}. Total clients: ${wss.clients.size}`);
  
  // Send immediate welcome packet and confirmation
  ws.send(JSON.stringify({
    type: 'SYSTEM',
    message: 'Successfully connected to the real-time database update stream.',
    connectedClients: wss.clients.size
  }));

  // Handle client-side heartbeat pong responses
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Log client errors safely
  ws.on('error', (err) => {
    console.error('[WebSocket Error] Client connection error:', err.message);
  });

  // Log clean closures
  ws.on('close', () => {
    console.log(`[WebSocket Connection] Client disconnected. Active clients: ${wss.clients.size}`);
  });
});

// Ping interval to verify active connections and clean up dead clients
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('[WebSocket Cleaner] Terminating inactive client connection.');
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping();
  });
}, 30000); // 30 seconds interval

wss.on('close', () => {
  clearInterval(interval);
});

// Start Server
server.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`🚀 Real-Time Update Backend Service is running on port ${PORT}`);
  console.log(`📁 Web Dashboard available at: http://localhost:${PORT}`);
  console.log(`🔌 WebSockets listening at: ws://localhost:${PORT}`);
  console.log(`================================================================`);
});
