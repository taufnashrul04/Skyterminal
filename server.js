import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchAllMids, fetchMarketData } from './lib/hyperliquid.js';
import { buildMarketSnapshot } from './lib/indicators.js';
import { buildFundingSnapshot } from './lib/funding.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC = path.join(ROOT, 'public');
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function cached(loader, ttlMs) {
  const store = new Map();
  return async (...args) => {
    const key = JSON.stringify(args);
    const current = store.get(key);
    if (current?.pending) return current.pending;
    if (current && Date.now() - current.at < ttlMs) return current.value;
    const pending = Promise.resolve(loader(...args));
    store.set(key, { at: Date.now(), pending });
    try {
      const value = await pending;
      store.set(key, { at: Date.now(), value });
      return value;
    } catch (error) {
      store.delete(key);
      throw error;
    }
  };
}

async function defaultMarketLoader(coin, interval) {
  return buildMarketSnapshot(await fetchMarketData(coin, interval, 300));
}

async function serveStatic(response, pathname, publicDir) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(publicDir, relative);
  if (!resolved.startsWith(path.resolve(publicDir) + path.sep) && resolved !== path.join(path.resolve(publicDir), 'index.html')) return false;
  try {
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) return false;
    const data = await readFile(resolved);
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': CONTENT_TYPES[path.extname(resolved)] ?? 'application/octet-stream',
      'content-length': data.length,
      'cache-control': path.extname(resolved) === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    response.end(data);
    return true;
  } catch {
    return false;
  }
}

export function createAppServer({ marketLoader = defaultMarketLoader, midsLoader = fetchAllMids, fundingLoader = buildFundingSnapshot, publicDir = DEFAULT_PUBLIC, maxInFlight = 24, requestsPerMinute = 120 } = {}) {
  const getMarket = cached(marketLoader, 4_000);
  const getMids = cached(midsLoader, 2_000);
  const getFunding = cached(fundingLoader, 30_000);
  const clients = new Map();
  let inFlight = 0;
  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const forwarded = request.headers['x-forwarded-for'];
    const client = process.env.TRUST_PROXY === '1' && typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : request.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    if (clients.size > 1_024) {
      for (const [address, entry] of clients) {
        if (now - entry.startedAt >= 60_000) clients.delete(address);
      }
      while (clients.size > 1_024) clients.delete(clients.keys().next().value);
    }
    const record = clients.get(client);
    const bucket = !record || now - record.startedAt >= 60_000 ? { startedAt: now, count: 0 } : record;
    bucket.count += 1;
    clients.set(client, bucket);
    if (bucket.count > requestsPerMinute) return sendJson(response, 429, { error: 'Rate limit exceeded' });
    if (inFlight >= maxInFlight) return sendJson(response, 503, { error: 'Server busy' });
    inFlight += 1;
    try {
      if (url.pathname === '/api/health') {
        return sendJson(response, 200, { name: 'Skyterminal', status: 'ok', version: '0.5.0', marketIntelAssets: ['BTC', 'ETH', 'SOL', 'HYPE'], fundingUniverse: 'ALL', sources: ['Hyperliquid', 'Variational', 'RISEx', 'Nado', 'TxFlow', 'Arcus', 'PopDEX', 'Decibel'] });
      }
      if (url.pathname === '/api/overview') {
        return sendJson(response, 200, { asOf: new Date().toISOString(), mids: await getMids() });
      }
      if (url.pathname === '/api/funding') {
        return sendJson(response, 200, await getFunding());
      }
      if (url.pathname === '/api/market') {
        const coin = String(url.searchParams.get('coin') ?? 'BTC').toUpperCase();
        const interval = String(url.searchParams.get('interval') ?? '5m');
        return sendJson(response, 200, await getMarket(coin, interval));
      }
      if (await serveStatic(response, decodeURIComponent(url.pathname), publicDir)) return;
      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      const isClientError = /^Unsupported (asset|interval):/.test(error?.message ?? '');
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : isClientError ? 400 : 500;
      sendJson(response, statusCode, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      inFlight -= 1;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? '127.0.0.1';
  createAppServer().listen(port, host, () => {
    console.log(`Skyterminal listening on http://${host}:${port}`);
  });
}
