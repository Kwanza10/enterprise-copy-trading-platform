function createMarketTick({ symbol, bid, ask, volume = 0 } = {}) {
  const midPrice = (Number(bid) + Number(ask)) / 2;

  return {
    symbol,
    bid: Number(bid),
    ask: Number(ask),
    midPrice,
    volume: Number(volume),
    timestamp: new Date().toISOString()
  };
}

function buildMarketOverview(items = []) {
  const count = items.length;
  const gainers = items.filter((item) => Number(item.change || 0) > 0).length;
  const losers = items.filter((item) => Number(item.change || 0) < 0).length;
  const totalVolume = items.reduce((sum, item) => sum + Number(item.volume || 0), 0);

  let marketBias = 'mixed';
  if (gainers > losers) marketBias = 'bullish';
  if (losers > gainers) marketBias = 'bearish';

  return {
    count,
    gainers,
    losers,
    totalVolume,
    marketBias
  };
}

module.exports = { createMarketTick, buildMarketOverview };
