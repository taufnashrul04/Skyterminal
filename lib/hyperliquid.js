const API_URL = 'https://api.hyperliquid.xyz/info';
const COINS = new Set(['BTC', 'ETH', 'SOL', 'HYPE']);
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
  const response = await fetchImpl(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Skyterminal/0.1' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Hyperliquid HTTP ${response.status}`);
  return response.json();
}

export async function fetchMarketData(coinValue, intervalValue, count = 240) {
  const coin = assertCoin(coinValue);
  const interval = assertInterval(intervalValue);
  const { startTime, endTime } = candleWindow(interval, count);
  const [candles, book] = await Promise.all([
    hyperliquidPost({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime } }),
    hyperliquidPost({ type: 'l2Book', coin }),
  ]);
  return { coin, interval, candles, book };
}

export async function fetchAllMids() {
  const all = await hyperliquidPost({ type: 'allMids' });
  return Object.fromEntries([...COINS].map((coin) => [coin, Number(all[coin] ?? 0)]));
}

export const launchAssets = Object.freeze([...COINS]);
export const supportedIntervals = Object.freeze(Object.keys(INTERVAL_MS));
