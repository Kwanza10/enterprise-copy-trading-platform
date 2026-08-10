const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { resolvePort } = require('../src/config/port');

test('resolvePort prefers the next free port when requested port is taken', async () => {
  const reserve = net.createServer();
  await new Promise((resolve) => reserve.listen(0, resolve));
  const requestedPort = reserve.address().port;

  try {
    const port = await resolvePort(requestedPort);
    assert.notStrictEqual(port, requestedPort);
    assert.ok(port > requestedPort);
  } finally {
    await new Promise((resolve, reject) => reserve.close((err) => (err ? reject(err) : resolve())));
  }
});
