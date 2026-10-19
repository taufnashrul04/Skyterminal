import { json } from './_response.js';

export const runtime = 'nodejs';
const ASSETS = new Set(['BTC', 'ETH', 'SOL', 'HYPE']);
const LEVEL_WEIGHTS = [0.45, 0.3, 0.15, 0.07, 0.03];

async function getJSON(url, options = {}) {
  const response = await fetch(url, { ...options, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}

function ticker(name) { return String(name ?? '').toUpperCase().split(':').at(-1).replace(/[-_]PERP$/i, '').replace(/[-_]USD[CT]?$/i, ''); }
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }

function fromHyperliquid(response, venue, asset) {
  const universe = response?.[0]?.universe ?? [];
  const contexts = response?.[1] ?? [];
  return universe.flatMap((market, index) => {
    if (ticker(market?.name) !== asset) return [];
    const ctx = contexts[index] ?? {};
    const mark = finite(ctx.markPx);
    const oi = finite(ctx.openInterest) * mark;
    const maxLeverage = Math.max(1, finite(market.maxLeverage, 10));
    return mark > 0 && oi > 0 ? [{ venue, mark, openInterest: oi, maxLeverage }] : [];
  });
}

function fromExtended(response, asset) {
  return (response?.data ?? []).flatMap((market) => {
    if (ticker(market?.name) !== asset || market?.active === false) return [];
    const mark = finite(market?.marketStats?.markPrice);
    const oi = finite(market?.marketStats?.openInterest);
    const maxLeverage = Math.max(1, finite(market?.tradingConfig?.maxLeverage, 10));
    return mark > 0 && oi > 0 ? [{ venue: 'Extended', mark, openInterest: oi, maxLeverage }] : [];
  });
}

function buildLevels(markets) {
  const levels = [];
  for (const market of markets) {
    const maxLev = Math.max(1, market.maxLeverage);
    const sideNotional = market.openInterest / 2;
    LEVEL_WEIGHTS.forEach((weight, index) => {
      const distance = Math.min(0.25, (index + 1) / maxLev);
      if (distance <= 0 || distance >= 0.25) return;
      levels.push({ venue: market.venue, distancePct: -distance * 100, side: 'long', notional: sideNotional * weight, estimated: true });
      levels.push({ venue: market.venue, distancePct: distance * 100, side: 'short', notional: sideNotional * weight, estimated: true });
    });
  }
  return levels;
}

export async function GET(request) {
  const asset = String(new URL(request.url).searchParams.get('asset') || 'BTC').toUpperCase();
  if (!ASSETS.has(asset)) return json({ error: `Unsupported asset: ${asset}` }, 400);
  try {
    const [hl, entropy, extended] = await Promise.all([
      getJSON('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }) }),
      getJSON('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs', dex: 'io' }) }),
      getJSON('https://api.starknet.extended.exchange/api/v1/info/markets'),
    ]);
    const markets = [...fromHyperliquid(hl, 'Hyperliquid', asset), ...fromHyperliquid(entropy, 'Entropy (io)', asset), ...fromExtended(extended, asset)];
    const mark = markets[0]?.mark ?? null;
    return json({ asset, mark, method: 'ESTIMATED_OI_LEVERAGE_LEVELS', disclaimer: 'Estimated levels from public open interest and maximum leverage; not exchange-published liquidation orders.', markets, levels: buildLevels(markets) });
  } catch (error) {
    return json({ asset, mark: null, method: 'ESTIMATED_OI_LEVERAGE_LEVELS', markets: [], levels: [], error: error instanceof Error ? error.message : String(error) }, 200);
  }
}
