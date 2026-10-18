import test from 'node:test';
import assert from 'node:assert/strict';
import { extractQFEXMarkets } from '../lib/funding.js';

test('extractQFEXMarkets normalizes perpetual contracts from QFEX', () => {
  const markets = extractQFEXMarkets({ data: [
    { ticker_id: 'BTC-USD', product_type: 'Perpetual', last_price: '100000', target_volume: '25000000', funding_rate: '0.0006', funding_interval_minutes: 60 },
    { ticker_id: 'ETH-USD', product_type: 'Spot', last_price: '3000', target_volume: '1000000', funding_rate: '0.2', funding_interval_minutes: 60 },
  ] });
  assert.equal(markets.length, 1);
  assert.equal(markets[0].dex, 'papertrade.xyz');
  assert.equal(markets[0].ticker, 'BTC');
  assert.equal(markets[0].markPrice, 100000);
  assert.equal(markets[0].volume24h, 25000000);
  assert.equal(markets[0].fundingRate1h, 0.0006);
  assert.equal(markets[0].dataSource, 'QFEX / papertrade.xyz');
});
