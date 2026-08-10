const WebSocket = require('ws');

function createWebSocketServer(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));

    ws.on('message', (data) => {
      try {
        const payload = JSON.parse(data.toString());
        if (payload.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload' }));
      }
    });
  });

  return wss;
}

module.exports = { createWebSocketServer };
