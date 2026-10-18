import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEntropyMarkets, extractExtendedMarkets, extractQFEXMarkets } from '../lib/funding.js';

test('extractQFEXMarkets normalizes perpetual contracts from QFEX', () => {
  const markets = extractQFEXMarkets({ data: [
    { ticker_id: 'BTC-USD', product_type: 'Perpetual', last_price: '100000', target_volume: '25000000', funding_rate: '0.0006', funding_interval_minutes: 60 },
    { ticker_id: 'ETH-USD', product_type: 'Spot', last_price: '3000', target_volume: '1000000', funding_rate: '0.2', funding_interval_minutes: 60 },
  ] });
  assert.equal(markets.length, 1);
  assert.equal(markets[0].dex, 'QFEX');
  assert.equal(markets[0].ticker, 'BTC');
  assert.equal(markets[0].markPrice, 100000);
  assert.equal(markets[0].volume24h, 25000000);
  assert.equal(markets[0].fundingRate1h, 0.0006);
  assert.equal(markets[0].dataSource, 'QFEX');
});

test('extractExtendedMarkets normalizes active perpetual markets', () => {
  const markets = extractExtendedMarkets({ data: [{
    name: 'BTC-USD', type: 'PERPETUAL', active: true, status: 'ACTIVE',
    marketStats: { markPrice: '100000', fundingRate: '0.0001', dailyVolume: '25000000' },
  }] });
  assert.deepEqual(markets.map((market) => market.dex), ['Extended']);
  assert.equal(markets[0].ticker, 'BTC');
  assert.equal(markets[0].fundingRate1h, 0.0001);
  assert.equal(markets[0].markPrice, 100000);
});

test('extractEntropyMarkets reads the Hyperliquid HIP-3 io namespace', () => {
  const markets = extractEntropyMarkets([
    { universe: [{ name: 'io:OAI' }, { name: 'io:ANTH' }] },
    [{ markPx: '1500', funding: '0.0002', dayNtlVlm: '1000000' }, { markPx: '2000', funding: '-0.0001', dayNtlVlm: '2000000' }],
  ]);
  assert.deepEqual(markets.map((market) => market.ticker), ['OAI', 'ANTH']);
  assert.equal(markets[0].dex, 'Entropy (io)');
  assert.equal(markets[0].fundingRate1h, 0.0002);
});
