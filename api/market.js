import { fetchMarketData } from '../lib/hyperliquid.js';
import { buildMarketSnapshot } from '../lib/indicators.js';
import { json, errorResponse } from './_response.js';

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const coin = String(url.searchParams.get('coin') ?? 'BTC').toUpperCase();
    const interval = String(url.searchParams.get('interval') ?? '5m');
    const includeTrades = url.searchParams.get('flow') === '1';
    return json(buildMarketSnapshot(await fetchMarketData(coin, interval, 300, fetch, { includeTrades })));
  } catch (error) {
    return errorResponse(error);
  }
}
