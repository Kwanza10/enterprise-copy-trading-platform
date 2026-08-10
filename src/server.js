const { app, server } = require('./app');
const env = require('./config/env');
const { resolvePort } = require('./config/port');

async function startServer() {
  const PORT = await resolvePort(env.port);

  server.listen(PORT, () => {
    console.log(`Enterprise Copy Trading Platform running on port ${PORT}`);
  });
}

startServer();

module.exports = { app, server };
