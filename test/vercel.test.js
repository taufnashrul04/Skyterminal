import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GET as healthGET } from '../api/health.js';
import { GET as marketGET } from '../api/market.js';
import { GET as collectorGET } from '../api/collector.js';

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

test('Vercel collector function returns explicit unavailable state without a configured URL', async () => {
  const response = await collectorGET(new Request('https://skyterminal.test/api/collector?asset=BTC'), { baseUrl: '' });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.available, false);
  assert.match(body.error, /Collector URL/);
});

test('Vercel collector function tolerates concurrent analytics queries over two seconds', async () => {
  const delayedFetch = async (url, options = {}) => {
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const path = new URL(url).pathname;
    const data = path === '/health'
      ? { data: { status: 'ok' } }
      : { data: path === '/v1/cvd' ? [] : {} };
    return { ok: true, json: async () => data };
  };
  const response = await collectorGET(
    new Request('https://skyterminal.test/api/collector?asset=BTC'),
    { baseUrl: 'http://collector.test', fetchImpl: delayedFetch },
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.available, true);
  assert.equal(body.health.data.status, 'ok');
});

test('Vercel collector keeps legacy analytics live when heatmap route is not deployed yet', async () => {
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/v1/liquidations/heatmap') return { ok: false, status: 404, json: async () => ({ error: 'route not found' }) };
    return { ok: true, json: async () => (path === '/health' ? { data: { status: 'ok' } } : { data: {} }) };
  };
  const response = await collectorGET(new Request('https://skyterminal.test/api/collector?asset=BTC'), { baseUrl: 'http://collector.test', fetchImpl });
  const body = await response.json();
  assert.equal(body.available, true);
  assert.equal(body.analytics.liquidations.heatmap, null);
});

test('Vercel market function rejects assets outside Market Intel universe', async () => {
  const response = await marketGET(new Request('https://skyterminal.test/api/market?coin=DOGE&interval=5m'));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /Unsupported asset/);
});
