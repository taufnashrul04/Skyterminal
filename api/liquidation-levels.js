import { fetchAllMids } from '../lib/hyperliquid.js';
import { json } from './_response.js';

export const runtime = 'nodejs';

const ASSETS = new Set(['BTC', 'ETH', 'SOL', 'HYPE']);
const WINDOWS = { '15m': 15, '1h': 60, '4h': 240, '24h': 1440 };
// Levels spread out to +/-10% at 10x, so the bin is coarser than the event heatmap's.
const PRICE_BIN = { BTC: 50, ETH: 5, SOL: 0.5, HYPE: 0.2 };
const TIMEOUT_MS = Number(process.env.COLLECTOR_TIMEOUT_MS ?? 12_000);

// Keep the column count steady as the window grows.
function timeBucketFor(minutes) {
  if (minutes <= 15) return '1m';
  if (minutes <= 60) return '5m';
  if (minutes <= 240) return '15m';
  return '30m';
}

export async function GET(request, options = {}) {
  const url = new URL(request.url);
  const asset = String(url.searchParams.get('asset') || 'BTC').toUpperCase();
  if (!ASSETS.has(asset)) return json({ error: `Unsupported asset: ${asset}` }, 400);

  const baseUrl = options.baseUrl ?? process.env.COLLECTOR_URL;
  if (!baseUrl) {
    return json({ available: false, asset, mark: null, levels: null, map: null, error: 'Collector URL is not configured on Vercel' });
  }

  const minutes = WINDOWS[url.searchParams.get('window')] ?? WINDOWS['24h'];
  const now = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.apiToken ?? process.env.COLLECTOR_API_TOKEN ?? '';
  const headers = token ? { authorization: `Bearer ${token}` } : undefined;

  // The map states each level as a distance from the mark, so it needs one. A missing
  // mark costs the map its distances but leaves the heatmap intact, so it is not fatal.
  let mark = 0;
  try {
    mark = Number((await (options.midsImpl ?? fetchAllMids)())[asset]) || 0;
  } catch {
    mark = 0;
  }

  const params = new URLSearchParams({
    asset,
    from: String(now - minutes * 60 * 1000),
    to: String(now),
    timeBucket: timeBucketFor(minutes),
    priceBin: String(PRICE_BIN[asset] ?? 10),
  });
  const root = baseUrl.replace(/\/$/, '');
  const get = async (path, extra = '') => {
    const response = await fetchImpl(`${root}${path}?${params}${extra}`, {
      cache: 'no-store',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || body?.error || `Collector HTTP ${response.status}`);
    return body.data ?? null;
  };

  try {
    const [levels, map] = await Promise.all([
      get('/v1/liquidations/levels'),
      get('/v1/liquidations/map', `&mark=${mark}`),
    ]);
    return json({ available: true, asset, mark, levels, map, source: 'collector' });
  } catch (error) {
    // A collector without these routes answers 404. Reporting that as unavailable lets
    // the page fall back to the actual-events view instead of sitting on an empty chart.
    return json({ available: false, asset, mark, levels: null, map: null, error: error instanceof Error ? error.message : String(error) });
  }
}
