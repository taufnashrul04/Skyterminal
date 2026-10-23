import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GET as healthGET } from '../api/health.js';
import { GET as marketGET } from '../api/market.js';
import { GET as collectorGET } from '../api/collector.js';
import { GET as liquidationHeatmapGET } from '../api/liquidation-heatmap.js';
import { GET as liquidationLevelsGET } from '../api/liquidation-levels.js';

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

test('Vercel liquidation heatmap proxies collector event buckets', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ data: { buckets: [{ levels: [{ price: '100', total: '1' }] }], method: 'ACTUAL_LIQUIDATION_EVENTS' } }) };
  };
  const response = await liquidationHeatmapGET(
    new Request('https://skyterminal.test/api/liquidation-heatmap?asset=BTC&window=24h'),
    { baseUrl: 'https://collector.test', fetchImpl },
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.heatmap.method, 'ACTUAL_LIQUIDATION_EVENTS');
  assert.equal(body.heatmap.buckets.length, 1);
  assert.match(calls[0].url, /\/v1\/liquidations\/heatmap\?/);
});

test('Vercel market function rejects assets outside Market Intel universe', async () => {
  const response = await marketGET(new Request('https://skyterminal.test/api/market?coin=DOGE&interval=5m'));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /Unsupported asset/);
});

test('Vercel liquidation levels proxies both model routes and passes the mark through', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const path = new URL(url).pathname;
    const data = path.endsWith('/levels')
      ? { buckets: [{ startMs: 1, endMs: 2, source: 'oi', levels: [{ price: 100, long: 5, short: 0, total: 5 }] }], priceBin: 50 }
      : { mark: 81000, levels: [{ price: 72900, long: 5, short: 0, total: 5, distancePct: -10 }] };
    return { ok: true, json: async () => ({ data }) };
  };
  const response = await liquidationLevelsGET(
    new Request('https://skyterminal.test/api/liquidation-levels?asset=BTC&window=24h'),
    { baseUrl: 'https://collector.test', fetchImpl, midsImpl: async () => ({ BTC: 81000 }) },
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.available, true);
  assert.equal(body.mark, 81000);
  assert.equal(body.levels.buckets.length, 1);
  assert.equal(body.map.levels[0].distancePct, -10);
  assert.ok(calls.some((u) => u.includes('/v1/liquidations/levels?')));
  assert.ok(calls.some((u) => u.includes('/v1/liquidations/map?') && u.includes('mark=81000')));
});

test('Vercel liquidation levels reports unavailable when the collector lacks the route', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'route not found' } }) });
  const response = await liquidationLevelsGET(
    new Request('https://skyterminal.test/api/liquidation-levels?asset=BTC&window=24h'),
    { baseUrl: 'https://collector.test', fetchImpl, midsImpl: async () => ({ BTC: 81000 }) },
  );
  const body = await response.json();
  // Unavailable rather than a 404, so the page can fall back instead of showing nothing.
  assert.equal(response.status, 200);
  assert.equal(body.available, false);
  assert.equal(body.levels, null);
  assert.match(body.error, /route not found/);
});

test('Vercel liquidation levels survives a mark lookup that fails', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => ({ data: new URL(url).pathname.endsWith('/levels') ? { buckets: [] } : { levels: [] } }),
  });
  const response = await liquidationLevelsGET(
    new Request('https://skyterminal.test/api/liquidation-levels?asset=BTC&window=4h'),
    { baseUrl: 'https://collector.test', fetchImpl, midsImpl: async () => { throw new Error('mids down'); } },
  );
  const body = await response.json();
  assert.equal(body.available, true, 'a missing mark costs the map its distances, not the whole response');
  assert.equal(body.mark, 0);
});

test('Vercel liquidation levels rejects assets outside the universe', async () => {
  const response = await liquidationLevelsGET(new Request('https://skyterminal.test/api/liquidation-levels?asset=DOGE'));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Unsupported asset/);
});
