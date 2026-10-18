import { hyperliquidPost } from './hyperliquid.js';

const NADO_IDS = {
  2: 'BTC', 4: 'ETH', 8: 'SOL', 10: 'XRP', 14: 'BNB', 16: 'HYPE', 18: 'ZEC', 20: 'DOGE',
  22: 'PEPE', 24: 'AVAX', 26: 'SOL-PERP2', 28: 'TAO', 32: 'SUI', 34: 'MATIC', 36: 'LINK',
  40: 'WIF', 42: 'BONK', 44: 'FLOKI', 46: 'ENA', 48: 'ARB', 50: 'OP',
};

export function normalizeTicker(ticker) {
  return String(ticker ?? '').toUpperCase().trim()
    .replace(/\/USDC$/i, '')
    .replace(/\/USD$/i, '')
    .replace(/[-_]USD$/i, '')
    .replace(/[-_/]PERP$/i, '')
    .replace(/^1000/, '');
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function netReturnPer1000(grossRate1h, hours, costRate) {
  return Number((grossRate1h * hours * 1_000 - costRate * 1_000).toFixed(4));
}

function validMarket(item) {
  const priceIsUsable = Number.isFinite(item?.markPrice) && item.markPrice > 0;
  const priceIsUnavailable = item?.priceType === 'unavailable' && item.markPrice == null;
  return item
    && typeof item.dex === 'string'
    && normalizeTicker(item.ticker)
    && (priceIsUsable || priceIsUnavailable)
    && Number.isFinite(item.fundingRate1h)
    && Number.isFinite(item.volume24h) && item.volume24h >= 0;
}

export function findFundingArbitrage(data, { focusAssets = null, roundTripCostBps = 12 } = {}) {
  const focus = Array.isArray(focusAssets) && focusAssets.length ? new Set(focusAssets.map(normalizeTicker)) : null;
  const grouped = new Map();
  for (const raw of data) {
    const item = {
      ...raw,
      ticker: normalizeTicker(raw?.ticker),
      markPrice: raw?.markPrice == null ? null : Number(raw.markPrice),
      fundingRate1h: Number(raw?.fundingRate1h),
      volume24h: Number(raw?.volume24h),
    };
    if (!validMarket(item) || (focus && !focus.has(item.ticker))) continue;
    if (!grouped.has(item.ticker)) grouped.set(item.ticker, []);
    if (item.supportsFunding !== false) grouped.get(item.ticker).push(item);
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
    const netReturn4hPer1000 = netReturnPer1000(grossRate1h, 4, costRate);
    const netReturn24hPer1000 = netReturnPer1000(grossRate1h, 24, costRate);
    const hasComparablePrices = long.priceType !== 'oracle'
      && short.priceType !== 'oracle'
      && Number.isFinite(long.markPrice) && long.markPrice > 0
      && Number.isFinite(short.markPrice) && short.markPrice > 0;
    const mid = hasComparablePrices ? (long.markPrice + short.markPrice) / 2 : null;
    const priceDivergenceBps = hasComparablePrices && mid > 0 ? Math.abs(short.markPrice - long.markPrice) / mid * 10_000 : null;
    const priceRisk = hasComparablePrices ? null
      : long.priceType === 'oracle' || short.priceType === 'oracle' ? 'ORACLE_PRICE_ONLY'
        : 'PRICE_UNAVAILABLE';
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
      roundTripCostBps, costModel: 'FEES + ESTIMATED SPREAD', netReturn4hPer1000, netReturn24hPer1000,
      breakEvenHours, priceDivergenceBps, priceRisk, minVolume24h,
      longPrice: long.markPrice, shortPrice: short.markPrice, confidence,
    });
  }
  return opportunities.sort((a, b) => b.grossAnnualizedPct - a.grossAnnualizedPct);
}

export function findFundingRoutes(data, { focusAssets = null, roundTripCostBps = 12 } = {}) {
  const focus = Array.isArray(focusAssets) && focusAssets.length ? new Set(focusAssets.map(normalizeTicker)) : null;
  const grouped = new Map();
  for (const raw of data) {
    const item = {
      ...raw,
      ticker: normalizeTicker(raw?.ticker),
      markPrice: raw?.markPrice == null ? null : Number(raw.markPrice),
      fundingRate1h: Number(raw?.fundingRate1h),
      volume24h: Number(raw?.volume24h),
    };
    if (!validMarket(item) || (focus && !focus.has(item.ticker))) continue;
    if (!grouped.has(item.ticker)) grouped.set(item.ticker, []);
    if (item.supportsFunding !== false) grouped.get(item.ticker).push(item);
  }

  const routes = [];
  for (const [pair, markets] of grouped) {
    for (let left = 0; left < markets.length; left += 1) {
      for (let right = left + 1; right < markets.length; right += 1) {
        if (markets[left].dex === markets[right].dex) continue;
        const long = markets[left].fundingRate1h <= markets[right].fundingRate1h ? markets[left] : markets[right];
        const short = long === markets[left] ? markets[right] : markets[left];
        const grossRate1h = short.fundingRate1h - long.fundingRate1h;
        if (!(grossRate1h > 0)) continue;
        const grossAnnualizedPct = grossRate1h * 24 * 365 * 100;
        const estimatedDailyPer1000 = grossRate1h * 24 * 1_000;
        const costRate = Math.max(0, roundTripCostBps) / 10_000;
        const breakEvenHours = costRate > 0 ? Number((costRate / grossRate1h).toFixed(4)) : 0;
    const netReturn4hPer1000 = netReturnPer1000(grossRate1h, 4, costRate);
    const netReturn24hPer1000 = netReturnPer1000(grossRate1h, 24, costRate);
        const hasComparablePrices = long.priceType !== 'oracle'
          && short.priceType !== 'oracle'
          && Number.isFinite(long.markPrice) && long.markPrice > 0
          && Number.isFinite(short.markPrice) && short.markPrice > 0;
        const mid = hasComparablePrices ? (long.markPrice + short.markPrice) / 2 : null;
        const priceDivergenceBps = hasComparablePrices && mid > 0 ? Math.abs(short.markPrice - long.markPrice) / mid * 10_000 : null;
        const priceRisk = hasComparablePrices ? null
          : long.priceType === 'oracle' || short.priceType === 'oracle' ? 'ORACLE_PRICE_ONLY'
            : 'PRICE_UNAVAILABLE';
        const minVolume24h = Math.min(long.volume24h, short.volume24h);
        const confidence = hasComparablePrices && grossAnnualizedPct >= 40 && minVolume24h >= 10_000_000 && priceDivergenceBps <= 40
          ? 'high'
          : hasComparablePrices && grossAnnualizedPct >= 12 && minVolume24h >= 1_000_000 && priceDivergenceBps <= 100
            ? 'medium'
            : 'low';
        routes.push({
          pair, longDex: long.dex, shortDex: short.dex,
          longRate1h: long.fundingRate1h, shortRate1h: short.fundingRate1h,
          grossRate1h, grossAnnualizedPct, estimatedDailyPer1000,
          roundTripCostBps, costModel: 'FEES + ESTIMATED SPREAD', netReturn4hPer1000, netReturn24hPer1000,
      breakEvenHours, priceDivergenceBps, priceRisk, minVolume24h,
          longPrice: long.markPrice, shortPrice: short.markPrice, confidence,
        });
      }
    }
  }
  return routes.sort((a, b) => b.grossAnnualizedPct - a.grossAnnualizedPct || a.pair.localeCompare(b.pair));
}

async function requestJSON(url, options = {}, timeoutMs = 10_000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const PROFUNDING_URL = 'https://profunding.pro/api/api/opportunities';
let proFundingCache = { at: 0, pending: null, value: null };

async function fetchProFundingOpportunities() {
  const now = Date.now();
  if (proFundingCache.value && now - proFundingCache.at < 20_000) return proFundingCache.value;
  if (proFundingCache.pending) return proFundingCache.pending;
  const pending = requestJSON(PROFUNDING_URL, {}, 20_000);
  proFundingCache = { ...proFundingCache, pending };
  try {
    const value = await pending;
    proFundingCache = { at: Date.now(), pending: null, value };
    return value;
  } catch (error) {
    proFundingCache = { at: 0, pending: null, value: null };
    throw error;
  }
}

export function extractProFundingVenueMarkets(opportunities, venue) {
  const target = String(venue).toLowerCase();
  const latest = new Map();
  for (const opportunity of Array.isArray(opportunities) ? opportunities : []) {
    const longMatch = String(opportunity?.long_exchange ?? '').toLowerCase() === target;
    const shortMatch = String(opportunity?.short_exchange ?? '').toLowerCase() === target;
    if (!longMatch && !shortMatch) continue;
    const ticker = normalizeTicker(opportunity?.symbol);
    if (!ticker) continue;
    const timestamp = Date.parse(opportunity?.timestamp ?? '') || 0;
    const existing = latest.get(ticker);
    if (existing && existing.timestamp > timestamp) continue;
    const annualizedPct = finite(longMatch ? opportunity?.long_apr : opportunity?.short_apr, Number.NaN);
    const volume24h = finite(longMatch ? opportunity?.long_volume_24h : opportunity?.short_volume_24h);
    if (!Number.isFinite(annualizedPct)) continue;
    latest.set(ticker, {
      dex: venue,
      ticker,
      markPrice: null,
      priceType: 'unavailable',
      fundingRate1h: annualizedPct / 100 / (365 * 24),
      volume24h,
      timestamp,
      dataSource: 'ProFunding public API',
    });
  }
  return [...latest.values()].map(({ timestamp, ...market }) => market).filter(validMarket);
}

export async function fetchProFundingVenueFunding(venue) {
  return extractProFundingVenueMarkets(await fetchProFundingOpportunities(), venue);
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

export function normalizeVariationalFundingRate(rawAnnualRate) {
  return finite(rawAnnualRate, 0) / (365 * 24);
}

export async function fetchVariationalFunding() {
  const data = await requestJSON('https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats');
  return (data?.listings ?? []).map((market) => {
    // Variational's funding_rate is an annualized decimal rate (e.g. -8.18 = -818% APR).
    const fundingRate1h = normalizeVariationalFundingRate(market?.funding_rate);
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

export function extractLighterMarkets(fundingData, detailsData) {
  const detailsById = new Map(
    (detailsData?.order_book_details ?? [])
      .filter((market) => market?.market_type === 'perp' && market?.status === 'active')
      .map((market) => [Number(market.market_id), market]),
  );
  return (fundingData?.funding_rates ?? [])
    .filter((rate) => String(rate?.exchange ?? '').toLowerCase() === 'lighter')
    .map((rate) => {
      const details = detailsById.get(Number(rate?.market_id));
      if (!details) return null;
      return {
        dex: 'Lighter',
        ticker: details?.symbol || rate?.symbol,
        markPrice: finite(details?.mark_price),
        priceType: 'mark',
        // Lighter publishes the 8-hour-equivalent rate and settles one eighth each hour.
        fundingRate1h: finite(rate?.rate, Number.NaN) / 8,
        volume24h: finite(details?.daily_quote_token_volume),
      };
    })
    .filter(validMarket);
}

export async function fetchLighterFunding() {
  const base = 'https://mainnet.zklighter.elliot.ai/api/v1';
  const [fundingData, detailsData] = await Promise.all([
    requestJSON(`${base}/funding-rates`),
    requestJSON(`${base}/orderBookDetails`),
  ]);
  return extractLighterMarkets(fundingData, detailsData);
}

export function extractQFEXMarkets(response) {
  return (response?.data ?? [])
    .filter((market) => String(market?.product_type ?? '').toLowerCase() === 'perpetual')
    .map((market) => {
      const intervalMinutes = finite(market?.funding_interval_minutes, 60);
      const intervalHours = intervalMinutes / 60;
      return {
        dex: 'QFEX',
        ticker: normalizeTicker(market?.ticker_id),
        markPrice: finite(market?.last_price),
        priceType: 'mark',
        fundingRate1h: intervalHours > 0 ? finite(market?.funding_rate) / intervalHours : 0,
        volume24h: finite(market?.target_volume),
        dataSource: 'QFEX',
      };
    })
    .filter(validMarket);
}

export async function fetchQFEXFunding() {
  const data = await requestJSON('https://api.qfex.com/md/contracts', {}, 10_000);
  return extractQFEXMarkets(data);
}

export function extractPapertradeMarkets(response) {
  return (response?.instruments ?? [])
    .filter((instrument) => instrument?.[4] === true && instrument?.[5] !== true)
    .map((instrument) => ({
      dex: 'papertrade.xyz', ticker: normalizeTicker(instrument?.[1]), markPrice: null, priceType: 'unavailable',
      fundingRate1h: 0, volume24h: 0, supportsFunding: false, dataSource: 'Papertrade API · no funding rate',
    }))
    .filter(validMarket);
}

export async function fetchPapertradeFunding() {
  const data = await requestJSON('https://exchange.papertrade.xyz/state/trading', { headers: { accept: 'application/json', 'user-agent': 'Skyterminal/1.0' } }, 10_000);
  return extractPapertradeMarkets(data);
}

export const defaultFundingSources = Object.freeze({
  Hyperliquid: fetchHyperliquidFunding,
  Variational: fetchVariationalFunding,
  RISEx: fetchRISExFunding,
  Nado: fetchNadoFunding,
  TxFlow: () => fetchProFundingVenueFunding('TxFlow'),
  Arcus: () => fetchProFundingVenueFunding('Arcus'),
  PopDEX: () => fetchProFundingVenueFunding('PopDEX'),
  Lighter: fetchLighterFunding,
  QFEX: fetchQFEXFunding,
  'papertrade.xyz': fetchPapertradeFunding,
});

export async function buildFundingSnapshot({ sources = defaultFundingSources, focusAssets = null, roundTripCostBps = 12 } = {}) {
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
  const focus = Array.isArray(focusAssets) && focusAssets.length ? new Set(focusAssets.map(normalizeTicker)) : null;
  const focusedMarkets = markets
    .filter((market) => !focus || focus.has(normalizeTicker(market.ticker)))
    .map((market) => ({ ...market, ticker: normalizeTicker(market.ticker) }));
  return {
    asOf: new Date().toISOString(), focusAssets: focus ? [...focus] : ['ALL'], roundTripCostBps,
    sources: sourceHealth,
    markets: focusedMarkets.sort((a, b) => normalizeTicker(a.ticker).localeCompare(normalizeTicker(b.ticker)) || a.dex.localeCompare(b.dex)),
    opportunities: findFundingArbitrage(focusedMarkets, { focusAssets, roundTripCostBps }),
    routes: findFundingRoutes(focusedMarkets, { focusAssets, roundTripCostBps }),
  };
}
