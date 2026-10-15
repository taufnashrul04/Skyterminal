import test from 'node:test';
import assert from 'node:assert/strict';
import { GET as healthGET } from '../api/health.js';
import { GET as marketGET } from '../api/market.js';

test('Vercel health function exposes split market universes', async () => {
  const response = await healthGET();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.marketIntelAssets, ['BTC', 'ETH', 'SOL', 'HYPE']);
  assert.equal(body.fundingUniverse, 'ALL');
});

test('Vercel market function rejects assets outside Market Intel universe', async () => {
  const response = await marketGET(new Request('https://skyterminal.test/api/market?coin=DOGE&interval=5m'));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /Unsupported asset/);
});
