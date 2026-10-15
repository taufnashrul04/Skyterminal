import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCoin, assertInterval, candleWindow, fetchMarketData, hyperliquidPost, HyperliquidError } from '../lib/hyperliquid.js';

test('assertCoin accepts the Skyterminal launch universe', () => {
  for (const coin of ['BTC', 'ETH', 'SOL', 'HYPE']) assert.equal(assertCoin(coin), coin);
});

test('assertCoin rejects unsupported symbols', () => {
  assert.throws(() => assertCoin('DOGE'), /Unsupported asset/);
});

test('assertInterval accepts configured multi-timeframes', () => {
  for (const interval of ['5m', '15m', '1h', '4h', '1d']) assert.equal(assertInterval(interval), interval);
});

test('candleWindow returns a bounded lookback interval', () => {
  const { startTime, endTime } = candleWindow('5m', 100, 1_000_000);
  assert.equal(endTime, 1_000_000);
  assert.equal(startTime, 1_000_000 - 100 * 300_000);
});

test('fetchMarketData includes recent public trades for live order-flow metrics', async () => {
  const payloads = [];
  const fakeFetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    payloads.push(payload);
    const response = payload.type === 'candleSnapshot' ? [] : payload.type === 'l2Book' ? { levels: [[], []] } : [{ side: 'B', px: '100', sz: '2' }];
    return { ok: true, json: async () => response };
  };
  const result = await fetchMarketData('BTC', '5m', 20, fakeFetch);
  assert.deepEqual(payloads.map((payload) => payload.type).sort(), ['candleSnapshot', 'l2Book', 'recentTrades']);
  assert.equal(result.trades[0].side, 'B');
});

test('fetchMarketData degrades when optional recent trades are unavailable', async () => {
  const fakeFetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    if (payload.type === 'recentTrades') return { ok: false, status: 429 };
    return { ok: true, json: async () => payload.type === 'candleSnapshot' ? [] : { levels: [[], []] } };
  };
  const result = await fetchMarketData('BTC', '5m', 20, fakeFetch);
  assert.deepEqual(result.trades, []);
});

test('fetchMarketData can omit recent trades for matrix snapshots', async () => {
  const payloads = [];
  const fakeFetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    payloads.push(payload);
    return { ok: true, json: async () => payload.type === 'candleSnapshot' ? [] : { levels: [[], []] } };
  };
  const result = await fetchMarketData('BTC', '5m', 20, fakeFetch, { includeTrades: false });
  assert.deepEqual(payloads.map((payload) => payload.type).sort(), ['candleSnapshot', 'l2Book']);
  assert.deepEqual(result.trades, []);
});

test('hyperliquidPost is injectable for deterministic tests', async () => {
  let capturedSignal;
  const fakeFetch = async (_url, init) => {
    capturedSignal = init.signal;
    return { ok: true, json: async () => JSON.parse(init.body) };
  };
  const result = await hyperliquidPost({ type: 'allMids' }, fakeFetch);
  assert.deepEqual(result, { type: 'allMids' });
  assert.ok(capturedSignal instanceof AbortSignal);
});

test('hyperliquidPost maps upstream HTTP errors to gateway errors', async () => {
  const fakeFetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(
    hyperliquidPost({ type: 'allMids' }, fakeFetch),
    (error) => error instanceof HyperliquidError && error.statusCode === 502,
  );
});
