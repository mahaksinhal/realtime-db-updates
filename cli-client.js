import WebSocket from 'ws';

const WS_URL = process.env.WS_URL || 'ws://localhost:3000';

console.log('\x1b[35m%s\x1b[0m', '==================================================================');
console.log('\x1b[35m%s\x1b[0m', '🛡️  ApexSync Live Terminal Client - Real-Time Update Stream');
console.log('\x1b[35m%s\x1b[0m', `🔌 Connecting to WebSockets at: ${WS_URL}`);
console.log('\x1b[35m%s\x1b[0m', '==================================================================\n');

let ws = null;
let reconnectTimer = null;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('\x1b[32m%s\x1b[0m', `[CONNECTED] Active session established at ${new Date().toLocaleTimeString()}`);
    console.log('\x1b[37m%s\x1b[0m', 'Streaming transaction updates from the database... (Press Ctrl+C to exit)\n');
    
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  });

  ws.on('message', (data) => {
    try {
      const packet = JSON.parse(data);
      handlePacket(packet);
    } catch (err) {
      console.error('\x1b[31m%s\x1b[0m', `[ERROR] Failed to decode WS payload: ${err.message}`);
    }
  });

  ws.on('close', (code, reason) => {
    console.log('\x1b[31m%s\x1b[0m', `[DISCONNECTED] Link severed. Code: ${code}. Reconnecting in 3s...`);
    
    if (!reconnectTimer) {
      reconnectTimer = setInterval(connect, 3000);
    }
  });

  ws.on('error', (err) => {
    console.error('\x1b[31m%s\x1b[0m', `[SOCKET ERROR] ${err.message}`);
  });
}

function handlePacket(packet) {
  if (packet.type === 'SYSTEM') {
    console.log('\x1b[36m%s\x1b[0m', `[SYSTEM] ${packet.message} (Connected Clients: ${packet.connectedClients})`);
    return;
  }

  const { action, data, timestamp } = packet;
  const time = new Date(timestamp).toLocaleTimeString([], { hour12: false });

  // Terminal colorized print
  switch (action) {
    case 'INSERT':
      console.log(
        '\x1b[42m\x1b[30m%s\x1b[0m \x1b[32m%s\x1b[0m',
        `  INSERT  `,
        `[${time}] ID: #${data.id} | Product: "${data.product_name}" | Customer: "${data.customer_name}" | Status: "${data.status}"`
      );
      break;

    case 'UPDATE':
      console.log(
        '\x1b[44m\x1b[30m%s\x1b[0m \x1b[36m%s\x1b[0m',
        `  UPDATE  `,
        `[${time}] ID: #${data.id} | Product: "${data.product_name}" | Customer: "${data.customer_name}" | Status: "${data.status}"`
      );
      break;

    case 'DELETE':
      console.log(
        '\x1b[41m\x1b[30m%s\x1b[0m \x1b[31m%s\x1b[0m',
        `  DELETE  `,
        `[${time}] ID: #${data.id} | Product: "${data.product_name}" was deleted.`
      );
      break;
  }
}

// Start connection
connect();
