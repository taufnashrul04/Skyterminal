const API_URL = 'https://api.hyperliquid.xyz/info';
const COINS = new Set(['BTC', 'ETH', 'SOL', 'HYPE']);
const REQUEST_TIMEOUT_MS = 10_000;
const RECENT_TRADES_TTL_MS = 2_000;
const recentTradesCache = new Map();

export class HyperliquidError extends Error {
  constructor(message, statusCode = 502, cause) {
    super(message, { cause });
    this.name = 'HyperliquidError';
    this.statusCode = statusCode;
  }
}
const INTERVAL_MS = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '3d': 259_200_000,
  '1w': 604_800_000,
};

export function assertCoin(value) {
  const coin = String(value ?? '').toUpperCase();
  if (!COINS.has(coin)) throw new Error(`Unsupported asset: ${coin || 'empty'}`);
  return coin;
}

export function assertInterval(value) {
  const interval = String(value ?? '5m');
  if (!(interval in INTERVAL_MS)) throw new Error(`Unsupported interval: ${interval}`);
  return interval;
}

export function candleWindow(interval, count = 240, endTime = Date.now()) {
  const valid = assertInterval(interval);
  const boundedCount = Math.max(20, Math.min(Number(count) || 240, 500));
  return { startTime: endTime - INTERVAL_MS[valid] * boundedCount, endTime };
}

export async function hyperliquidPost(payload, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Skyterminal/0.1' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new HyperliquidError(`Hyperliquid HTTP ${response.status}`, 502);
    return await response.json();
  } catch (error) {
    if (error instanceof HyperliquidError) throw error;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new HyperliquidError('Hyperliquid request timed out', 504, error);
    }
    throw new HyperliquidError('Hyperliquid request failed', 502, error);
  }
}

async function fetchRecentTrades(coin, fetchImpl) {
  if (fetchImpl !== fetch) return hyperliquidPost({ type: 'recentTrades', coin }, fetchImpl);
  const now = Date.now();
  const current = recentTradesCache.get(coin);
  if (current?.pending) return current.pending;
  if (current?.value && now - current.at < RECENT_TRADES_TTL_MS) return current.value;
  const pending = hyperliquidPost({ type: 'recentTrades', coin }, fetchImpl);
  recentTradesCache.set(coin, { at: now, pending });
  try {
    const value = await pending;
    recentTradesCache.set(coin, { at: Date.now(), value });
    return value;
  } catch (error) {
    recentTradesCache.delete(coin);
    throw error;
  }
}

export async function fetchMarketData(coinValue, intervalValue, count = 240, fetchImpl = fetch, { includeTrades = true } = {}) {
  const coin = assertCoin(coinValue);
  const interval = assertInterval(intervalValue);
  const { startTime, endTime } = candleWindow(interval, count);
  const tradesPromise = includeTrades ? fetchRecentTrades(coin, fetchImpl).catch(() => []) : Promise.resolve([]);
  const [candles, book, trades] = await Promise.all([
    hyperliquidPost({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime } }, fetchImpl),
    hyperliquidPost({ type: 'l2Book', coin }, fetchImpl),
    tradesPromise,
  ]);
  return { coin, interval, candles, book, trades };
}

export async function fetchAllMids() {
  const all = await hyperliquidPost({ type: 'allMids' });
  return Object.fromEntries([...COINS].map((coin) => [coin, Number(all[coin] ?? 0)]));
}

export const launchAssets = Object.freeze([...COINS]);
export const supportedIntervals = Object.freeze(Object.keys(INTERVAL_MS));
