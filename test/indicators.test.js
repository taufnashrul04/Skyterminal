import test from 'node:test';
import assert from 'node:assert/strict';
import {
  logReturns,
  realizedVolatility,
  volatilityPercentile,
  volatilityScaledTrend,
  maxDrawdown,
  historicalRisk,
  orderBookMetrics,
  volumeDeltaProxy,
  buildMarketSnapshot,
} from '../lib/indicators.js';

const candles = [
  { t: 1, o: 100, h: 102, l: 99, c: 101, v: 10 },
  { t: 2, o: 101, h: 104, l: 100, c: 103, v: 20 },
  { t: 3, o: 103, h: 104, l: 96, c: 97, v: 30 },
  { t: 4, o: 97, h: 101, l: 96, c: 100, v: 40 },
];

test('logReturns calculates adjacent logarithmic returns', () => {
  const result = logReturns([100, 110, 99]);
  assert.equal(result.length, 2);
  assert.ok(Math.abs(result[0] - Math.log(1.1)) < 1e-12);
  assert.ok(Math.abs(result[1] - Math.log(0.9)) < 1e-12);
});

test('realizedVolatility reports zero for a flat series', () => {
  assert.equal(realizedVolatility([0, 0, 0], 365), 0);
});

test('volatilityPercentile ranks the latest observation', () => {
  assert.equal(volatilityPercentile([1, 2, 3, 4]), 100);
  assert.equal(volatilityPercentile([1, 4, 3, 2]), 50);
});

test('volatilityScaledTrend preserves trend direction', () => {
  assert.ok(volatilityScaledTrend([100, 101, 102, 103, 104]) > 0);
  assert.ok(volatilityScaledTrend([104, 103, 102, 101, 100]) < 0);
});

test('maxDrawdown identifies peak-to-trough loss', () => {
  const result = maxDrawdown([100, 120, 90, 110]);
  assert.equal(result, -0.25);
});

test('historicalRisk returns positive loss VaR and ES', () => {
  const risk = historicalRisk([-0.10, -0.04, -0.02, 0.01, 0.03], 0.8);
  assert.ok(risk.var >= 0.04);
  assert.ok(risk.es >= risk.var);
});

test('orderBookMetrics computes spread and imbalance from weighted depth', () => {
  const result = orderBookMetrics({
    levels: [
      [{ px: '99', sz: '4' }, { px: '98', sz: '6' }],
      [{ px: '101', sz: '2' }, { px: '102', sz: '3' }],
    ],
  });
  assert.equal(result.mid, 100);
  assert.equal(result.spreadBps, 200);
  assert.equal(result.imbalance, 1 / 3);
});

test('volumeDeltaProxy signs candle volume by candle direction', () => {
  assert.deepEqual(volumeDeltaProxy(candles), [10, 20, -30, 40]);
});

test('buildMarketSnapshot returns the canonical dashboard contract', () => {
  const result = buildMarketSnapshot({ coin: 'BTC', interval: '5m', candles, book: { levels: [[{ px: '99', sz: '4' }], [{ px: '101', sz: '2' }]] } });
  assert.equal(result.asset, 'BTC');
  assert.equal(result.timeframe, '5m');
  assert.equal(result.price, 100);
  assert.equal(result.quality.stale, false);
  assert.ok(Number.isFinite(result.metrics.trend));
  assert.ok(Array.isArray(result.series.candles));
});

test('buildMarketSnapshot sorts candles and rejects malformed market data', () => {
  const dirty = [
    { t: 3, o: '103', h: '104', l: '102', c: '103', v: '8' },
    { t: 1, o: '100', h: '101', l: '99', c: '100', v: '5' },
    { t: 2, o: 'bad', h: '102', l: '98', c: '101', v: 'NaN' },
    { t: 2, o: '100', h: '99', l: '98', c: '100', v: '5' },
  ];
  const result = buildMarketSnapshot({
    coin: 'BTC', interval: '5m', candles: dirty,
    book: { levels: [[{ px: '99', sz: '-2' }, { px: '98', sz: '4' }], [{ px: '101', sz: '3' }, { px: 'bad', sz: '4' }]] },
  });
  assert.deepEqual(result.series.candles.map((c) => c.t), [1, 3]);
  assert.ok(Object.values(result.metrics).every(Number.isFinite));
  assert.equal(result.book.bidDepth, 4);
  assert.equal(result.book.askDepth, 3);
  assert.ok(result.quality.flags.includes('MALFORMED_DATA_DROPPED'));
});
