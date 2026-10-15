import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCoin, assertInterval, candleWindow, hyperliquidPost, HyperliquidError } from '../lib/hyperliquid.js';

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
