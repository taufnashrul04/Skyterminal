import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GET as healthGET } from '../api/health.js';
import { GET as marketGET } from '../api/market.js';

test('Vercel health function exposes split market universes', async () => {
  const response = await healthGET();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.marketIntelAssets, ['BTC', 'ETH', 'SOL', 'HYPE']);
  assert.equal(body.fundingUniverse, 'ALL');
  assert.ok(body.sources.includes('Lighter'));
  assert.ok(!body.sources.includes('Decibel'));
});

test('Vercel rewrites every browser module imported by the app', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rewrites = new Map(config.rewrites.map((item) => [item.source, item.destination]));
  assert.equal(rewrites.get('/app.js'), '/public/app.js');
  assert.equal(rewrites.get('/panel-state.js'), '/public/panel-state.js');
});

test('Vercel market function rejects assets outside Market Intel universe', async () => {
  const response = await marketGET(new Request('https://skyterminal.test/api/market?coin=DOGE&interval=5m'));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /Unsupported asset/);
});
