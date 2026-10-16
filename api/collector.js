import { json } from './_response.js';

export const runtime = 'nodejs';
const ASSETS = new Set(['BTC', 'ETH', 'SOL', 'HYPE']);
const COLLECTOR_TIMEOUT_MS = Number(process.env.COLLECTOR_TIMEOUT_MS ?? 12_000);

async function get(fetchImpl, url) {
  const response = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(COLLECTOR_TIMEOUT_MS) });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || `Collector HTTP ${response.status}`);
  return body;
}

async function getOptional(fetchImpl, url) {
  try { return await get(fetchImpl, url); } catch (error) {
    if (String(error?.message ?? '').includes('404') || String(error?.message ?? '').includes('route not found')) return null;
    throw error;
  }
}

export async function GET(request, options = {}) {
  const asset = String(new URL(request.url).searchParams.get('asset') || 'BTC').toUpperCase();
  if (!ASSETS.has(asset)) return json({ error: `Unsupported asset: ${asset}` }, 400);
  const baseUrl = options.baseUrl ?? process.env.COLLECTOR_URL;
  if (!baseUrl) return json({ available: false, health: null, analytics: null, error: 'Collector URL is not configured on Vercel' });
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = Date.now();
  const params = `asset=${encodeURIComponent(asset)}&from=${now - 15 * 60 * 1000}&to=${now}&bucket=1m`;
  try {
    const root = baseUrl.replace(/\/$/, '');
    const [health, cvd, profile, tpo, footprint, liquidations, heatmap] = await Promise.all([
      get(fetchImpl, `${root}/health`),
      get(fetchImpl, `${root}/v1/cvd?${params}`),
      get(fetchImpl, `${root}/v1/profile/volume?${params}&priceBin=1`),
      get(fetchImpl, `${root}/v1/profile/tpo?${params}&priceBin=1&tpoMinutes=30&ibMinutes=60`),
      get(fetchImpl, `${root}/v1/footprint?${params}&timeBucket=30m&priceBin=1`),
      get(fetchImpl, `${root}/v1/liquidations?${params}&bucket=30m`),
      getOptional(fetchImpl, `${root}/v1/liquidations/heatmap?${params}&timeBucket=5m&priceBin=10`),
    ]);
    return json({ available: true, health, analytics: { asset, cvd: cvd.data ?? [], profile: profile.data ?? null, tpo: tpo.data ?? null, footprint: footprint.data ?? null, liquidations: { ...(liquidations.data ?? {}), heatmap: heatmap?.data ?? null } } });
  } catch (error) {
    return json({ available: false, health: null, analytics: null, error: error instanceof Error ? error.message : String(error) });
  }
}
