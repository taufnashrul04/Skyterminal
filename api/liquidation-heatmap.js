import { json } from './_response.js';

export const runtime = 'nodejs';

const ASSETS = new Set(['BTC', 'ETH', 'SOL', 'HYPE']);
const WINDOWS = { '1m': 1, '15m': 15, '1h': 60, '4h': 240, '24h': 1440 };
const TIME_BUCKET = '5m';
const PRICE_BIN = '10';
const TIMEOUT_MS = Number(process.env.COLLECTOR_TIMEOUT_MS ?? 12_000);

export async function GET(request, options = {}) {
  const url = new URL(request.url);
  const asset = String(url.searchParams.get('asset') || 'BTC').toUpperCase();
  if (!ASSETS.has(asset)) return json({ error: `Unsupported asset: ${asset}` }, 400);

  const baseUrl = options.baseUrl ?? process.env.COLLECTOR_URL;
  if (!baseUrl) return json({ available: false, heatmap: null, error: 'Collector URL is not configured on Vercel' });

  const windowKey = url.searchParams.get('window') || '15m';
  const minutes = WINDOWS[windowKey] || WINDOWS['15m'];
  const now = Date.now();
  const root = baseUrl.replace(/\/$/, '');
  const params = new URLSearchParams({
    asset,
    from: String(now - minutes * 60 * 1000),
    to: String(now),
    timeBucket: TIME_BUCKET,
    priceBin: PRICE_BIN,
  });
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.apiToken ?? process.env.COLLECTOR_API_TOKEN ?? '';
  const headers = token ? { authorization: `Bearer ${token}` } : undefined;

  try {
    const response = await fetchImpl(`${root}/v1/liquidations/heatmap?${params}`, {
      cache: 'no-store',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || body?.error || `Collector HTTP ${response.status}`);
    return json({ available: true, asset, mark: null, heatmap: body.data ?? null, source: 'collector' });
  } catch (error) {
    return json({ available: false, asset, mark: null, heatmap: null, error: error instanceof Error ? error.message : String(error) });
  }
}
