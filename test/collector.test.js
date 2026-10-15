import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

async function withServer(run, collectorLoader) {
  const server = createAppServer({
    marketLoader: async () => ({ asset: 'BTC', timeframe: '5m' }),
    midsLoader: async () => ({ BTC: 1 }),
    fundingLoader: async () => ({ opportunities: [], markets: [], sources: {} }),
    collectorLoader,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('collector endpoint returns local collector health and analytics summary', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/collector?asset=BTC`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.available, true);
    assert.equal(body.health.data.status, 'ok');
    assert.equal(body.analytics.asset, 'BTC');
    assert.equal(body.analytics.cvd.length, 1);
    assert.equal(body.analytics.tpo.poc, '102');
    assert.equal(body.analytics.footprint.bars.length, 1);
    assert.equal(body.analytics.liquidations.totals.long, '0');
  }, async () => ({
    available: true,
    health: { data: { status: 'ok' } },
    analytics: { asset: 'BTC', cvd: [{ close: '4' }], profile: { poc: '102' }, tpo: { poc: '102' }, footprint: { bars: [{}] }, liquidations: { totals: { long: '0' } } },
  }));
});

test('collector endpoint degrades when collector is unavailable', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/collector?asset=BTC`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.available, false);
    assert.equal(body.analytics, null);
  }, async () => ({ available: false, health: null, analytics: null, error: 'collector unavailable' }));
});
