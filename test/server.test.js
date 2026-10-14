import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

async function withServer(run) {
  const server = createAppServer({
    marketLoader: async (coin, interval) => ({ asset: coin, timeframe: interval, price: 123 }),
    midsLoader: async () => ({ BTC: 1, ETH: 2, SOL: 3, HYPE: 4 }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('health endpoint identifies Skyterminal', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.name, 'Skyterminal');
    assert.equal(body.status, 'ok');
  });
});

test('market endpoint passes normalized query values to loader', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/market?coin=eth&interval=1h`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.asset, 'ETH');
    assert.equal(body.timeframe, '1h');
  });
});

test('overview endpoint returns launch-universe mids', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/overview`);
    const body = await response.json();
    assert.deepEqual(Object.keys(body.mids), ['BTC', 'ETH', 'SOL', 'HYPE']);
  });
});
