const test = require('node:test');
const assert = require('node:assert/strict');
const {
  registerBrokerAdapter,
  getBrokerAdapter,
  getBrokerIntegrationSummary,
  listBrokerProviders
} = require('../src/services/brokerService');

test('registerBrokerAdapter adds a broker adapter to the registry', () => {
  const adapter = {
    id: 'alpaca',
    name: 'Alpaca',
    type: 'stocks',
    status: 'connected',
    apiVersion: 'v1'
  };

  registerBrokerAdapter(adapter);

  assert.equal(getBrokerAdapter('alpaca').name, 'Alpaca');
  assert.equal(listBrokerProviders().some((provider) => provider.id === 'alpaca'), true);
});

test('getBrokerIntegrationSummary counts providers by connection state', () => {
  const summary = getBrokerIntegrationSummary();

  assert.ok(typeof summary.totalProviders === 'number');
  assert.ok(typeof summary.connectedCount === 'number');
  assert.ok(typeof summary.maintenanceCount === 'number');
  assert.ok(summary.connectedCount >= 1);
});
