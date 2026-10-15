const DEFAULT_COLLECTOR_URL = process.env.COLLECTOR_URL || 'http://127.0.0.1:4180';

async function requestJson(fetchImpl, url, timeoutMs = 1500) {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(url, { cache: 'no-store', signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || `Collector HTTP ${response.status}`);
  return body;
}

export async function fetchCollectorSummary(asset, { fetchImpl = fetch, baseUrl = DEFAULT_COLLECTOR_URL, now = Date.now() } = {}) {
  const symbol = String(asset).toUpperCase();
  const to = now;
  const from = now - 15 * 60 * 1000;
  try {
    const root = baseUrl.replace(/\/$/, '');
    const params = `asset=${encodeURIComponent(symbol)}&from=${from}&to=${to}&bucket=1m`;
    const [health, cvd, profile] = await Promise.all([
      requestJson(fetchImpl, `${root}/health`),
      requestJson(fetchImpl, `${root}/v1/cvd?${params}`),
      requestJson(fetchImpl, `${root}/v1/profile/volume?${params}&priceBin=1`),
    ]);
    return {
      available: true,
      health,
      analytics: { asset: symbol, cvd: cvd.data ?? [], profile: profile.data ?? null },
    };
  } catch (error) {
    return { available: false, health: null, analytics: null, error: error instanceof Error ? error.message : String(error) };
  }
}
