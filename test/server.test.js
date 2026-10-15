import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

async function withServer(run, overrides = {}) {
  const server = createAppServer({
    marketLoader: async (coin, interval) => ({ asset: coin, timeframe: interval, price: 123 }),
    midsLoader: async () => ({ BTC: 1, ETH: 2, SOL: 3, HYPE: 4 }),
    fundingLoader: async () => ({ opportunities: [{ pair: 'BTC' }], markets: [], sources: {} }),
    ...overrides,
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

test('market endpoint passes normalized query values and flow mode to loader', async () => {
  let received;
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/market?coin=eth&interval=1h&flow=1`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.asset, 'ETH');
    assert.equal(body.timeframe, '1h');
    assert.deepEqual(received, ['ETH', '1h', true]);
  }, { marketLoader: async (...args) => {
    received = args;
    return { asset: args[0], timeframe: args[1], price: 123 };
  } });
});

test('market cache coalesces concurrent requests for the same key', async () => {
  let calls = 0;
  await withServer(async (base) => {
    const [first, second] = await Promise.all([
      fetch(`${base}/api/market?coin=BTC&interval=5m`),
      fetch(`${base}/api/market?coin=BTC&interval=5m`),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls, 1);
  }, { marketLoader: async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { asset: 'BTC', timeframe: '5m', price: 123 };
  } });
});

test('overview endpoint returns launch-universe mids', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/overview`);
    const body = await response.json();
    assert.deepEqual(Object.keys(body.mids), ['BTC', 'ETH', 'SOL', 'HYPE']);
  });
});

test('funding endpoint returns arbitrage snapshot', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/funding`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.opportunities[0].pair, 'BTC');
  });
});

test('responses include browser security headers', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  });
});

test('upstream failures preserve gateway status codes', async () => {
  const failure = Object.assign(new Error('upstream unavailable'), { statusCode: 502 });
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/market?coin=BTC&interval=5m`);
    assert.equal(response.status, 502);
  }, { marketLoader: async () => { throw failure; } });
});

test('unexpected loader failures return internal server error', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/market?coin=BTC&interval=5m`);
    assert.equal(response.status, 500);
  }, { marketLoader: async () => { throw new Error('boom'); } });
});
