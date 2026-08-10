const net = require('net');

function resolvePort(requestedPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const tester = net.createServer();

      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          return tryPort(port + 1);
        }

        reject(err);
      });

      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });

      tester.listen(port);
    };

    tryPort(Number(requestedPort) || 3000);
  });
}

module.exports = { resolvePort };
