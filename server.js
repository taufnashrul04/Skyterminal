import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchAllMids, fetchMarketData } from './lib/hyperliquid.js';
import { buildMarketSnapshot } from './lib/indicators.js';

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

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
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
    if (current && Date.now() - current.at < ttlMs) return current.value;
    const value = await loader(...args);
    store.set(key, { at: Date.now(), value });
    return value;
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

export function createAppServer({ marketLoader = defaultMarketLoader, midsLoader = fetchAllMids, publicDir = DEFAULT_PUBLIC } = {}) {
  const getMarket = cached(marketLoader, 4_000);
  const getMids = cached(midsLoader, 2_000);
  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/health') {
        return sendJson(response, 200, { name: 'Skyterminal', status: 'ok', version: '0.1.0', source: 'Hyperliquid public API' });
      }
      if (url.pathname === '/api/overview') {
        return sendJson(response, 200, { asOf: new Date().toISOString(), mids: await getMids() });
      }
      if (url.pathname === '/api/market') {
        const coin = String(url.searchParams.get('coin') ?? 'BTC').toUpperCase();
        const interval = String(url.searchParams.get('interval') ?? '5m');
        return sendJson(response, 200, await getMarket(coin, interval));
      }
      if (await serveStatic(response, decodeURIComponent(url.pathname), publicDir)) return;
      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? '0.0.0.0';
  createAppServer().listen(port, host, () => {
    console.log(`Skyterminal listening on http://${host}:${port}`);
  });
}
