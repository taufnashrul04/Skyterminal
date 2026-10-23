const DEFAULT_COLLECTOR_URL = process.env.COLLECTOR_URL || 'http://127.0.0.1:4180';
const COLLECTOR_TIMEOUT_MS = Number(process.env.COLLECTOR_TIMEOUT_MS ?? 12_000);
const COLLECTOR_API_TOKEN = process.env.COLLECTOR_API_TOKEN ?? '';

async function requestJson(fetchImpl, url, timeoutMs = COLLECTOR_TIMEOUT_MS) {
  const signal = AbortSignal.timeout(timeoutMs);
  const headers = COLLECTOR_API_TOKEN ? { authorization: `Bearer ${COLLECTOR_API_TOKEN}` } : undefined;
  const response = await fetchImpl(url, { cache: 'no-store', headers, signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || `Collector HTTP ${response.status}`);
  return body;
}

async function requestOptional(fetchImpl, url) {
  try { return await requestJson(fetchImpl, url); } catch (error) {
    if (String(error?.message ?? '').includes('404') || String(error?.message ?? '').includes('route not found')) return null;
    throw error;
  }
}

const ASSET_PRICE_BIN = { BTC: '100', ETH: '5', SOL: '0.5', HYPE: '0.2' };

export async function fetchLiquidationHeatmapForWindow(asset, windowMs, { fetchImpl = fetch, baseUrl = DEFAULT_COLLECTOR_URL, now = Date.now() } = {}) {
  const symbol = String(asset).toUpperCase();
  const to = now;
  const from = now - windowMs;
  let timeBucket;
  if (windowMs <= 900_000)        timeBucket = '1m';
  else if (windowMs <= 3_600_000)  timeBucket = '5m';
  else if (windowMs <= 14_400_000) timeBucket = '15m';
  else                              timeBucket = '1h';
  const priceBin = ASSET_PRICE_BIN[symbol] ?? '10';
  const root = baseUrl.replace(/\/$/, '');
  const params = `asset=${encodeURIComponent(symbol)}&from=${from}&to=${to}&timeBucket=${timeBucket}&priceBin=${priceBin}`;
  try {
    const result = await requestJson(fetchImpl, `${root}/v1/liquidations/heatmap?${params}`);
    return result?.data ?? null;
  } catch {
    return null;
  }
}

export async function fetchCollectorSummary(asset, { fetchImpl = fetch, baseUrl = DEFAULT_COLLECTOR_URL, now = Date.now() } = {}) {
  const symbol = String(asset).toUpperCase();
  const to = now;
  const from = now - 15 * 60 * 1000;
  try {
    const root = baseUrl.replace(/\/$/, '');
    const params = `asset=${encodeURIComponent(symbol)}&from=${from}&to=${to}&bucket=1m`;
    const [health, cvd, profile, tpo, footprint, liquidations, heatmap] = await Promise.all([
      requestJson(fetchImpl, `${root}/health`),
      requestJson(fetchImpl, `${root}/v1/cvd?${params}`),
      requestJson(fetchImpl, `${root}/v1/profile/volume?${params}&priceBin=1`),
      requestJson(fetchImpl, `${root}/v1/profile/tpo?${params}&priceBin=1&tpoMinutes=30&ibMinutes=60`),
      requestJson(fetchImpl, `${root}/v1/footprint?${params}&timeBucket=30m&priceBin=1`),
      requestJson(fetchImpl, `${root}/v1/liquidations?${params}&bucket=30m`),
      requestOptional(fetchImpl, `${root}/v1/liquidations/heatmap?${params}&timeBucket=5m&priceBin=10`),
    ]);
    return {
      available: true,
      health,
      analytics: {
        asset: symbol,
        cvd: cvd.data ?? [],
        profile: profile.data ?? null,
        tpo: tpo.data ?? null,
        footprint: footprint.data ?? null,
        liquidations: { ...(liquidations.data ?? {}), heatmap: heatmap?.data ?? null },
      },
    };
  } catch (error) {
    return { available: false, health: null, analytics: null, error: error instanceof Error ? error.message : String(error) };
  }
}

const LEVEL_PRICE_BIN = { BTC: 50, ETH: 5, SOL: 0.5, HYPE: 0.2 };

// Projected liquidation levels: where leveraged positions would be wiped out, modelled
// from open-interest growth. Distinct from the liquidations that actually fired.
export async function fetchLiquidationLevels(asset, windowMs, mark = 0, { fetchImpl = fetch, baseUrl = DEFAULT_COLLECTOR_URL, now = Date.now() } = {}) {
  const symbol = String(asset).toUpperCase();
  const to = now;
  const from = now - windowMs;
  let timeBucket;
  if (windowMs <= 900_000) timeBucket = '1m';
  else if (windowMs <= 3_600_000) timeBucket = '5m';
  else if (windowMs <= 14_400_000) timeBucket = '15m';
  else timeBucket = '30m';
  const priceBin = LEVEL_PRICE_BIN[symbol] ?? 10;
  const root = baseUrl.replace(/\/$/, '');
  const params = `asset=${encodeURIComponent(symbol)}&from=${from}&to=${to}&timeBucket=${timeBucket}&priceBin=${priceBin}`;
  try {
    const [levels, map] = await Promise.all([
      requestJson(fetchImpl, `${root}/v1/liquidations/levels?${params}`),
      requestJson(fetchImpl, `${root}/v1/liquidations/map?${params}&mark=${mark}`),
    ]);
    return { levels: levels?.data ?? null, map: map?.data ?? null };
  } catch {
    return { levels: null, map: null };
  }
}
