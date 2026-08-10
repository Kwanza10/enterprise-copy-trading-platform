const providers = [
  { id: 'mt5', name: 'MetaTrader 5', type: 'forex', status: 'connected' },
  { id: 'ctrader', name: 'cTrader', type: 'forex', status: 'connected' },
  { id: 'binance', name: 'Binance', type: 'crypto', status: 'maintenance' },
  { id: 'interactive-brokers', name: 'Interactive Brokers', type: 'multi-asset', status: 'connected' }
];

function registerBrokerAdapter(adapter = {}) {
  const provider = {
    id: adapter.id,
    name: adapter.name,
    type: adapter.type || 'multi-asset',
    status: adapter.status || 'connected',
    apiVersion: adapter.apiVersion || 'v1',
    createdAt: new Date().toISOString()
  };

  const existingIndex = providers.findIndex((item) => item.id === provider.id);
  if (existingIndex >= 0) {
    providers[existingIndex] = provider;
    return provider;
  }

  providers.push(provider);
  return provider;
}

function getBrokerAdapter(brokerId) {
  return providers.find((provider) => provider.id === brokerId) || null;
}

function listBrokerProviders() {
  return providers;
}

function createBrokerConnection({ userId, brokerName, brokerType, accountName }) {
  return {
    id: `broker-${Date.now()}`,
    userId,
    brokerName,
    brokerType,
    accountName,
    status: 'connected',
    createdAt: new Date().toISOString()
  };
}

function getBrokerStatus(brokerId) {
  return providers.find((provider) => provider.id === brokerId) || null;
}

function getBrokerIntegrationSummary() {
  const connectedCount = providers.filter((provider) => provider.status === 'connected').length;
  const maintenanceCount = providers.filter((provider) => provider.status === 'maintenance').length;
  const disconnectedCount = providers.filter((provider) => provider.status === 'disconnected').length;

  return {
    totalProviders: providers.length,
    connectedCount,
    maintenanceCount,
    disconnectedCount,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  registerBrokerAdapter,
  getBrokerAdapter,
  listBrokerProviders,
  createBrokerConnection,
  getBrokerStatus,
  getBrokerIntegrationSummary
};
