import http from 'http';

const PORT = 3000;
const API_URL = `http://localhost:${PORT}/api/orders`;

// Mock Dataset for realistic data generation
const CUSTOMERS = [
  'Liam Neeson', 'Olivia Dunham', 'Noah Bennet', 'Emma Watson', 'Oliver Queen',
  'Sophia Loren', 'Elijah Wood', 'Charlotte Bronte', 'James Bond', 'Amelia Earhart',
  'Benjamin Franklin', 'Mia Farrow', 'Lucas Hood', 'Harper Lee', 'Mason Mount'
];

const PRODUCTS = [
  'MacBook Pro M4', 'Sony WH-1000XM5', 'Logitech MX Master 3S', 'Dell UltraSharp 34"',
  'iPhone 16 Pro', 'Keychron Q1 Mechanical Keyboard', 'Elgato Stream Deck', 'AirPods Pro 2',
  'Kindle Paperwhite', 'iPad Pro 11"', 'Bose QuietComfort Ultra', 'Nintendo Switch OLED'
];

const STATUSES = ['pending', 'shipped', 'delivered'];

console.log('\x1b[33m%s\x1b[0m', '==================================================================');
console.log('\x1b[33m%s\x1b[0m', '🔄 ApexSync Concurrent Transaction Simulator');
console.log('\x1b[33m%s\x1b[0m', 'Generating live SQLite transactions to test real-time update propagation...');
console.log('\x1b[33m%s\x1b[0m', '==================================================================\n');

// API Request Wrapper using native http module to avoid external dependencies
function apiRequest(method, path = '', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: `/api/orders${path}`,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch (err) {
          reject(new Error(`Failed to parse API response: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Random Helper utilities
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

async function startSimulation() {
  // Clear any existing database state so simulation starts fresh
  try {
    const existingOrders = await apiRequest('GET');
    console.log(`[Simulator Init] Found ${existingOrders.length} existing orders. Clearing database...`);
    for (const order of existingOrders) {
      await apiRequest('DELETE', `/${order.id}`);
    }
    console.log('[Simulator Init] Database cleared successfully.\n');
  } catch (err) {
    console.error('\x1b[31m%s\x1b[0m', `[Simulator Init ERROR] Could not clear database: ${err.message}`);
    console.log('Proceeding with current database state...\n');
  }

  // Transaction Loop
  while (true) {
    try {
      // 1. Fetch current database state
      const orders = await apiRequest('GET');
      
      // Determine what action to take:
      // - If db is empty, force INSERT
      // - Otherwise, random choice:
      //   - 50% chance to INSERT new order
      //   - 35% chance to UPDATE an existing order status
      //   - 15% chance to DELETE an order (keep database bounded)
      let action = 'INSERT';
      if (orders.length > 0) {
        const rand = Math.random();
        if (orders.length > 12) {
          // Bounded threshold: if database is getting crowded, increase delete probability
          action = rand < 0.3 ? 'INSERT' : rand < 0.75 ? 'UPDATE' : 'DELETE';
        } else {
          action = rand < 0.5 ? 'INSERT' : rand < 0.85 ? 'UPDATE' : 'DELETE';
        }
      }

      if (action === 'INSERT') {
        const customer = pickRandom(CUSTOMERS);
        const product = pickRandom(PRODUCTS);
        const status = pickRandom(['pending', 'shipped']); // Start pending or shipped
        
        console.log(`[SIMULATING] Executing INSERT command...`);
        const newOrder = await apiRequest('POST', '', {
          customer_name: customer,
          product_name: product,
          status: status
        });
        console.log('\x1b[32m%s\x1b[0m', `  => SUCCESS: Created Order ID #${newOrder.id} for ${newOrder.customer_name}\n`);

      } else if (action === 'UPDATE') {
        const targetOrder = pickRandom(orders);
        let nextStatus = 'shipped';
        
        if (targetOrder.status === 'pending') nextStatus = 'shipped';
        else if (targetOrder.status === 'shipped') nextStatus = 'delivered';
        else nextStatus = 'pending'; // Recycle status

        console.log(`[SIMULATING] Executing UPDATE command on Order ID #${targetOrder.id}...`);
        const updatedOrder = await apiRequest('PUT', `/${targetOrder.id}`, {
          status: nextStatus
        });
        console.log('\x1b[36m%s\x1b[0m', `  => SUCCESS: Order #${updatedOrder.id} changed status from '${targetOrder.status}' to '${updatedOrder.status}'\n`);

      } else if (action === 'DELETE') {
        const targetOrder = pickRandom(orders);
        console.log(`[SIMULATING] Executing DELETE command on Order ID #${targetOrder.id}...`);
        await apiRequest('DELETE', `/${targetOrder.id}`);
        console.log('\x1b[31m%s\x1b[0m', `  => SUCCESS: Deleted Order ID #${targetOrder.id}\n`);
      }

    } catch (err) {
      console.error('\x1b[31m%s\x1b[0m', `[SIMULATOR ERROR] Loop iteration failed: ${err.message}`);
    }

    // Wait random interval before next transaction
    const delay = randomDelay(2000, 3500); // 2 to 3.5 seconds
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

// Delay starting simulator briefly to ensure the server is fully booted up first
setTimeout(() => {
  startSimulation();
}, 2000);
