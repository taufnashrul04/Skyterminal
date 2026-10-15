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

export function volumeProfile(candles, binCount = 24, valueAreaFraction = 0.7) {
  const clean = (candles ?? []).map((c) => ({
    high: Number(c?.h), low: Number(c?.l), close: Number(c?.c), volume: Number(c?.v),
  })).filter((c) => [c.high, c.low, c.close, c.volume].every(Number.isFinite) && c.high >= c.low && c.volume >= 0);
  if (!clean.length) return { available: false, bins: [], poc: null, vah: null, val: null, totalVolume: 0, method: 'CANDLE_TYPICAL_PRICE_PROXY' };
  const low = Math.min(...clean.map((c) => c.low));
  const high = Math.max(...clean.map((c) => c.high));
  const count = Math.max(4, Math.min(100, Math.floor(Number(binCount) || 24)));
  const step = Math.max((high - low) / count, Math.max(Math.abs(high), 1) * EPS);
  const volumes = Array(count).fill(0);
  for (const candle of clean) {
    const typical = (candle.high + candle.low + candle.close) / 3;
    const index = Math.max(0, Math.min(count - 1, Math.floor((typical - low) / step)));
    volumes[index] += candle.volume;
  }
  const totalVolume = volumes.reduce((sum, volume) => sum + volume, 0);
  const bins = volumes.map((volume, index) => ({
    low: low + index * step,
    high: low + (index + 1) * step,
    price: low + (index + 0.5) * step,
    volume,
  }));
  if (!(totalVolume > 0)) {
    return { available: false, bins, poc: null, vah: null, val: null, totalVolume: 0, method: 'CANDLE_TYPICAL_PRICE_PROXY' };
  }
  const pocIndex = volumes.reduce((best, volume, index) => volume > volumes[best] ? index : best, 0);
  const target = totalVolume * Math.max(0.5, Math.min(0.95, Number(valueAreaFraction) || 0.7));
  let included = volumes[pocIndex];
  let left = pocIndex;
  let right = pocIndex;
  while (included < target && (left > 0 || right < count - 1)) {
    const leftVolume = left > 0 ? volumes[left - 1] : -1;
    const rightVolume = right < count - 1 ? volumes[right + 1] : -1;
    if (rightVolume > leftVolume) {
      right += 1;
      included += volumes[right];
    } else {
      left -= 1;
      included += volumes[left];
    }
  }
  const priceAt = (index) => low + (index + 0.5) * step;
  return {
    available: true,
    bins,
    poc: priceAt(pocIndex),
    vah: low + (right + 1) * step,
    val: low + left * step,
    totalVolume,
    method: 'CANDLE_TYPICAL_PRICE_PROXY',
  };
}

export function recentTradeFlow(trades) {
  let buyNotional = 0;
  let sellNotional = 0;
  let count = 0;
  for (const trade of Array.isArray(trades) ? trades : []) {
    const price = Number(trade?.px);
    const size = Number(trade?.sz);
    if (!Number.isFinite(price) || !Number.isFinite(size) || !(price > 0) || !(size >= 0) || !['A', 'B'].includes(trade?.side)) continue;
    const notional = price * size;
    if (!Number.isFinite(notional)) continue;
    if (trade.side === 'B') buyNotional += notional;
    else sellNotional += notional;
    count += 1;
  }
  const totalNotional = buyNotional + sellNotional;
  return {
    count, buyNotional, sellNotional, totalNotional,
    deltaNotional: buyNotional - sellNotional,
    imbalance: totalNotional > 0 ? (buyNotional - sellNotional) / totalNotional : 0,
    method: 'RECENT_AGGRESSOR_TRADES',
  };
}

export function sessionLevels(candles) {
  const clean = (candles ?? []).map((c) => ({
    high: Number(c?.h), low: Number(c?.l), close: Number(c?.c), volume: Number(c?.v),
  })).filter((c) => [c.high, c.low, c.close, c.volume].every(Number.isFinite) && c.high >= c.low && c.volume >= 0);
  if (!clean.length) return { high: 0, low: 0, vwap: 0, rangePct: 0 };
  const high = Math.max(...clean.map((c) => c.high));
  const low = Math.min(...clean.map((c) => c.low));
  const totalVolume = clean.reduce((sum, c) => sum + c.volume, 0);
  const weighted = clean.reduce((sum, c) => sum + ((c.high + c.low + c.close) / 3) * c.volume, 0);
  const vwap = totalVolume > 0 ? weighted / totalVolume : clean.at(-1).close;
  return { high, low, vwap, rangePct: low > 0 ? high / low - 1 : 0 };
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

export function buildMarketSnapshot({ coin, interval, candles, book, trades = [], now = Date.now() }) {
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
  const profile = volumeProfile(normalized);
  const recentFlow = recentTradeFlow(trades);
  const levels = sessionLevels(normalized);
  const latestChange = prices.length > 1 ? prices.at(-1) / prices.at(-2) - 1 : 0;
  const absorptionProxy = recentFlow.deltaNotional > 0 && latestChange <= 0
    ? 'BUY_ABSORPTION_PROXY'
    : recentFlow.deltaNotional < 0 && latestChange >= 0
      ? 'SELL_ABSORPTION_PROXY'
      : 'FLOW_PRICE_ALIGNED';
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
    change: latestChange,
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
    exo: {
      profile,
      session: levels,
      recentFlow,
      absorptionProxy,
    },
    series: { candles: normalized, cumulativeDelta },
    book: depth,
  };
}
