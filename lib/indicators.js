const EPS = 1e-12;

export function logReturns(prices) {
  const clean = prices.map(Number).filter(Number.isFinite);
  const out = [];
  for (let i = 1; i < clean.length; i += 1) {
    if (clean[i] > 0 && clean[i - 1] > 0) out.push(Math.log(clean[i] / clean[i - 1]));
  }
  return out;
}

export function standardDeviation(values) {
  const xs = values.map(Number).filter(Number.isFinite);
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

export function realizedVolatility(returns, periodsPerYear = 365) {
  return standardDeviation(returns) * Math.sqrt(periodsPerYear);
}

export function volatilityPercentile(history) {
  const xs = history.map(Number).filter(Number.isFinite);
  if (!xs.length) return 0;
  const latest = xs.at(-1);
  const belowOrEqual = xs.filter((x) => x <= latest).length;
  return (belowOrEqual / xs.length) * 100;
}

export function volatilityScaledTrend(prices, lookback = prices.length - 1) {
  const xs = prices.map(Number).filter((x) => Number.isFinite(x) && x > 0);
  if (xs.length < 2) return 0;
  const n = Math.max(1, Math.min(lookback, xs.length - 1));
  const segment = xs.slice(-(n + 1));
  const ret = Math.log(segment.at(-1) / segment[0]);
  const sigma = standardDeviation(logReturns(segment));
  if (sigma < EPS) return ret === 0 ? 0 : Math.sign(ret) * 3;
  return ret / (sigma * Math.sqrt(n));
}

export function maxDrawdown(prices) {
  const xs = prices.map(Number).filter(Number.isFinite);
  if (!xs.length) return 0;
  let peak = xs[0];
  let worst = 0;
  for (const price of xs) {
    peak = Math.max(peak, price);
    if (peak > 0) worst = Math.min(worst, price / peak - 1);
  }
  return worst;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] === undefined
    ? sorted[base]
    : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

export function historicalRisk(returns, confidence = 0.95) {
  const losses = returns.map((r) => -Number(r)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!losses.length) return { var: 0, es: 0, confidence, tailCount: 0 };
  const valueAtRisk = Math.max(0, quantile(losses, confidence));
  const tail = losses.filter((loss) => loss >= valueAtRisk - EPS);
  const expectedShortfall = Math.max(valueAtRisk, tail.reduce((a, b) => a + b, 0) / Math.max(tail.length, 1));
  return { var: valueAtRisk, es: expectedShortfall, confidence, tailCount: tail.length };
}

export function orderBookMetrics(book, depthLevels = 10) {
  const cleanLevels = (levels) => (levels ?? [])
    .map((x) => ({ px: Number(x?.px), sz: Number(x?.sz) }))
    .filter((x) => Number.isFinite(x.px) && x.px > 0 && Number.isFinite(x.sz) && x.sz >= 0)
    .slice(0, depthLevels);
  const bids = cleanLevels(book?.levels?.[0]);
  const asks = cleanLevels(book?.levels?.[1]);
  const bestBid = bids[0]?.px ?? 0;
  const bestAsk = asks[0]?.px ?? 0;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || 0;
  const spreadBps = mid ? ((bestAsk - bestBid) / mid) * 10_000 : 0;
  const bidDepth = bids.reduce((sum, x) => sum + x.sz, 0);
  const askDepth = asks.reduce((sum, x) => sum + x.sz, 0);
  const imbalance = bidDepth + askDepth ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0;
  return { bestBid, bestAsk, mid, spreadBps, bidDepth, askDepth, imbalance };
}

export function volumeDeltaProxy(candles) {
  return candles.map((c) => {
    const open = Number(c.o);
    const close = Number(c.c);
    const volume = Number(c.v);
    return close >= open ? volume : -volume;
  });
}

export function periodsPerYear(interval) {
  const map = {
    '1m': 365 * 24 * 60,
    '3m': 365 * 24 * 20,
    '5m': 365 * 24 * 12,
    '15m': 365 * 24 * 4,
    '30m': 365 * 24 * 2,
    '1h': 365 * 24,
    '2h': 365 * 12,
    '4h': 365 * 6,
    '8h': 365 * 3,
    '12h': 365 * 2,
    '1d': 365,
    '3d': 365 / 3,
    '1w': 52,
  };
  return map[interval] ?? 365;
}

function rollingVolatility(returns, window, annualization) {
  const result = [];
  for (let i = Math.max(2, window); i <= returns.length; i += 1) {
    result.push(realizedVolatility(returns.slice(i - window, i), annualization));
  }
  return result;
}

export function buildMarketSnapshot({ coin, interval, candles, book, now = Date.now() }) {
  const sourceCandles = Array.isArray(candles) ? candles : [];
  const normalized = sourceCandles.map((c) => ({
    t: Number(c?.t), T: Number(c?.T ?? c?.t),
    o: Number(c?.o), h: Number(c?.h), l: Number(c?.l), c: Number(c?.c),
    v: Number(c?.v), n: Number(c?.n ?? 0),
  })).filter((c) => {
    const finite = [c.t, c.T, c.o, c.h, c.l, c.c, c.v, c.n].every(Number.isFinite);
    const pricesValid = c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0;
    const rangeValid = c.h >= Math.max(c.o, c.c, c.l) && c.l <= Math.min(c.o, c.c, c.h);
    return finite && pricesValid && rangeValid && c.v >= 0 && c.n >= 0;
  }).sort((a, b) => a.t - b.t)
    .filter((c, index, all) => index === 0 || c.t !== all[index - 1].t);
  const prices = normalized.map((c) => c.c);
  const returns = logReturns(prices);
  const annualization = periodsPerYear(interval);
  const volWindow = Math.min(20, Math.max(2, returns.length));
  const volatility = realizedVolatility(returns.slice(-volWindow), annualization);
  const volHistory = rollingVolatility(returns, volWindow, annualization);
  const risk = historicalRisk(returns.slice(-Math.min(250, returns.length)), 0.95);
  const depth = orderBookMetrics(book);
  const delta = volumeDeltaProxy(normalized);
  const cumulativeDelta = [];
  delta.reduce((sum, value) => {
    const next = sum + value;
    cumulativeDelta.push(next);
    return next;
  }, 0);
  const lastTime = normalized.at(-1)?.T ?? 0;
  const intervalMs = normalized.length > 1 ? Math.max(1, normalized.at(-1).t - normalized.at(-2).t) : 60_000;
  const stale = lastTime > 1e12 ? now - lastTime > intervalMs * 3 : false;
  return {
    asset: coin,
    venue: 'HYPERLIQUID',
    marketType: 'perpetual',
    timeframe: interval,
    asOf: new Date(lastTime > 1e12 ? lastTime : now).toISOString(),
    price: prices.at(-1) ?? depth.mid ?? 0,
    change: prices.length > 1 ? prices.at(-1) / prices.at(-2) - 1 : 0,
    metrics: {
      trend: volatilityScaledTrend(prices, Math.min(20, prices.length - 1)),
      trendSlow: volatilityScaledTrend(prices, Math.min(60, prices.length - 1)),
      volatility,
      volatilityPercentile: volatilityPercentile(volHistory),
      drawdown: maxDrawdown(prices),
      var95: risk.var,
      es95: risk.es,
      spreadBps: depth.spreadBps,
      bookImbalance: depth.imbalance,
      bidDepth: depth.bidDepth,
      askDepth: depth.askDepth,
    },
    quality: {
      stale,
      sampleSize: normalized.length,
      tailCount: risk.tailCount,
      flags: [
        ...(normalized.length < 60 ? ['LIMITED_HISTORY'] : []),
        ...(normalized.length < sourceCandles.length ? ['MALFORMED_DATA_DROPPED'] : []),
      ],
      deltaMethod: 'CANDLE_DIRECTION_PROXY',
    },
    series: { candles: normalized, cumulativeDelta },
    book: depth,
  };
}
