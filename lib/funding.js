import { hyperliquidPost } from './hyperliquid.js';

const FOCUS_ASSETS = ['BTC', 'ETH', 'SOL', 'HYPE'];
const NADO_IDS = { 2: 'BTC', 4: 'ETH', 8: 'SOL', 16: 'HYPE' };

export function normalizeTicker(ticker) {
  return String(ticker ?? '').toUpperCase().trim()
    .replace(/\/USDC$/i, '')
    .replace(/\/USD$/i, '')
    .replace(/[-_/]PERP$/i, '')
    .replace(/^1000/, '');
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function validMarket(item) {
  return item
    && typeof item.dex === 'string'
    && normalizeTicker(item.ticker)
    && Number.isFinite(item.markPrice) && item.markPrice > 0
    && Number.isFinite(item.fundingRate1h)
    && Number.isFinite(item.volume24h) && item.volume24h >= 0;
}

export function findFundingArbitrage(data, { focusAssets = FOCUS_ASSETS, roundTripCostBps = 12 } = {}) {
  const focus = new Set(focusAssets.map(normalizeTicker));
  const grouped = new Map();
  for (const raw of data) {
    const item = {
      ...raw,
      ticker: normalizeTicker(raw?.ticker),
      markPrice: Number(raw?.markPrice),
      fundingRate1h: Number(raw?.fundingRate1h),
      volume24h: Number(raw?.volume24h),
    };
    if (!validMarket(item) || (focus.size && !focus.has(item.ticker))) continue;
    if (!grouped.has(item.ticker)) grouped.set(item.ticker, []);
    grouped.get(item.ticker).push(item);
  }

  const opportunities = [];
  for (const [pair, markets] of grouped) {
    if (markets.length < 2) continue;
    const sorted = [...markets].sort((a, b) => a.fundingRate1h - b.fundingRate1h);
    const long = sorted[0];
    const short = sorted.at(-1);
    if (long.dex === short.dex) continue;
    const grossRate1h = short.fundingRate1h - long.fundingRate1h;
    if (!(grossRate1h > 0)) continue;
    const grossAnnualizedPct = grossRate1h * 24 * 365 * 100;
    const estimatedDailyPer1000 = grossRate1h * 24 * 1_000;
    const costRate = Math.max(0, roundTripCostBps) / 10_000;
    const breakEvenHours = costRate > 0 ? Number((costRate / grossRate1h).toFixed(4)) : 0;
    const hasComparablePrices = long.priceType !== 'oracle' && short.priceType !== 'oracle';
    const mid = (long.markPrice + short.markPrice) / 2;
    const priceDivergenceBps = hasComparablePrices && mid > 0 ? Math.abs(short.markPrice - long.markPrice) / mid * 10_000 : null;
    const priceRisk = hasComparablePrices ? null : 'ORACLE_PRICE_ONLY';
    const minVolume24h = Math.min(long.volume24h, short.volume24h);
    const confidence = hasComparablePrices && grossAnnualizedPct >= 40 && minVolume24h >= 10_000_000 && priceDivergenceBps <= 40
      ? 'high'
      : hasComparablePrices && grossAnnualizedPct >= 12 && minVolume24h >= 1_000_000 && priceDivergenceBps <= 100
        ? 'medium'
        : 'low';
    opportunities.push({
      pair, longDex: long.dex, shortDex: short.dex,
      longRate1h: long.fundingRate1h, shortRate1h: short.fundingRate1h,
      grossRate1h, grossAnnualizedPct, estimatedDailyPer1000,
      roundTripCostBps, breakEvenHours, priceDivergenceBps, priceRisk, minVolume24h,
      longPrice: long.markPrice, shortPrice: short.markPrice, confidence,
    });
  }
  return opportunities.sort((a, b) => b.grossAnnualizedPct - a.grossAnnualizedPct);
}

async function requestJSON(url, options = {}, timeoutMs = 10_000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function fetchHyperliquidFunding() {
  const data = await hyperliquidPost({ type: 'metaAndAssetCtxs' });
  const universe = data?.[0]?.universe ?? [];
  const contexts = data?.[1] ?? [];
  return universe.map((market, index) => ({
    dex: 'Hyperliquid', ticker: market?.name,
    markPrice: finite(contexts[index]?.markPx), priceType: 'mark',
    fundingRate1h: finite(contexts[index]?.funding),
    volume24h: finite(contexts[index]?.dayNtlVlm),
  })).filter(validMarket);
}

export async function fetchVariationalFunding() {
  const data = await requestJSON('https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats');
  return (data?.listings ?? []).map((market) => {
    const intervalSeconds = finite(market?.funding_interval_s, 28_800);
    // Variational publishes percentage points per interval; convert to decimal per hour.
    const fundingRate1h = intervalSeconds > 0 ? finite(market?.funding_rate) / 100 * (3_600 / intervalSeconds) : 0;
    return {
      dex: 'Variational', ticker: market?.ticker,
      markPrice: finite(market?.mark_price), priceType: 'mark', fundingRate1h,
      volume24h: finite(market?.volume_24h),
    };
  }).filter(validMarket);
}

export async function fetchRISExFunding() {
  const data = await requestJSON('https://api.rise.trade/v1/markets');
  return (data?.data?.markets ?? []).filter((market) => market?.active !== false).map((market) => {
    const intervalNs = finite(market?.funding_interval, 3_600_000_000_000);
    const intervalHours = intervalNs / 3_600_000_000_000;
    return {
      dex: 'RISEx', ticker: market?.display_name || market?.base_asset_symbol,
      markPrice: finite(market?.mark_price), priceType: 'mark',
      fundingRate1h: intervalHours > 0 ? finite(market?.current_funding_rate) / intervalHours : 0,
      volume24h: finite(market?.quote_volume_24h),
    };
  }).filter(validMarket);
}

export async function fetchNadoFunding() {
  const productIds = Object.keys(NADO_IDS).map(Number);
  const post = (body) => requestJSON('https://archive.prod.nado.xyz/v1', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, 8_000);
  const [rates, prices] = await Promise.all([
    post({ funding_rates: { product_ids: productIds, limit: 1 } }),
    post({ oracle_price: { product_ids: productIds } }),
  ]);
  const priceMap = new Map((prices?.prices ?? []).map((item) => [Number(item.product_id), finite(item.oracle_price_x18) / 1e18]));
  return Object.entries(rates ?? {}).map(([id, info]) => ({
    dex: 'Nado', ticker: NADO_IDS[Number(id)],
    markPrice: priceMap.get(Number(id)) ?? 0, priceType: 'oracle',
    fundingRate1h: finite(info?.funding_rate_x18) / 1e18,
    volume24h: 0,
  })).filter(validMarket);
}

export async function fetchDecibelFunding() {
  const token = process.env.DECIBEL_BEARER;
  if (!token) return [];
  const headers = { origin: 'https://app.decibel.trade', authorization: `Bearer ${token}` };
  const base = 'https://api.mainnet.aptoslabs.com/decibel/api/v1';
  const [prices, contexts] = await Promise.all([
    requestJSON(`${base}/prices`, { headers }),
    requestJSON(`${base}/asset_contexts`, { headers }),
  ]);
  return prices.slice(0, contexts.length).map((price, index) => {
    const periodHours = finite(price?.funding_period_s, 3_600) / 3_600;
    const signedBps = (price?.is_funding_positive ? 1 : -1) * finite(price?.funding_rate_bps);
    return {
      dex: 'Decibel', ticker: contexts[index]?.market,
      markPrice: finite(price?.mark_px), priceType: 'mark',
      fundingRate1h: periodHours > 0 ? signedBps / 10_000 / periodHours : 0,
      volume24h: finite(contexts[index]?.volume_24h),
    };
  }).filter(validMarket);
}

export const defaultFundingSources = Object.freeze({
  Hyperliquid: fetchHyperliquidFunding,
  Variational: fetchVariationalFunding,
  RISEx: fetchRISExFunding,
  Nado: fetchNadoFunding,
  Decibel: fetchDecibelFunding,
});

export async function buildFundingSnapshot({ sources = defaultFundingSources, focusAssets = FOCUS_ASSETS, roundTripCostBps = 12 } = {}) {
  const entries = Object.entries(sources);
  const settled = await Promise.allSettled(entries.map(([, loader]) => loader()));
  const sourceHealth = {};
  const markets = [];
  settled.forEach((result, index) => {
    const name = entries[index][0];
    if (result.status === 'fulfilled') {
      const valid = result.value.filter(validMarket);
      markets.push(...valid);
      sourceHealth[name] = { status: valid.length ? 'online' : 'empty', markets: valid.length };
    } else {
      sourceHealth[name] = { status: 'offline', markets: 0, error: result.reason?.message || 'unavailable' };
    }
  });
  const focus = new Set(focusAssets.map(normalizeTicker));
  const focusedMarkets = markets
    .filter((market) => focus.has(normalizeTicker(market.ticker)))
    .map((market) => ({ ...market, ticker: normalizeTicker(market.ticker) }));
  return {
    asOf: new Date().toISOString(), focusAssets: [...focus], roundTripCostBps,
    sources: sourceHealth,
    markets: focusedMarkets.sort((a, b) => normalizeTicker(a.ticker).localeCompare(normalizeTicker(b.ticker)) || a.dex.localeCompare(b.dex)),
    opportunities: findFundingArbitrage(focusedMarkets, { focusAssets, roundTripCostBps }),
  };
}
