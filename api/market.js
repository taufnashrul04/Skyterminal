import { fetchMarketData } from '../lib/hyperliquid.js';
import { buildMarketSnapshot } from '../lib/indicators.js';
import { json, errorResponse } from './_response.js';

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const coin = String(url.searchParams.get('coin') ?? 'BTC').toUpperCase();
    const interval = String(url.searchParams.get('interval') ?? '5m');
    return json(buildMarketSnapshot(await fetchMarketData(coin, interval, 300)));
  } catch (error) {
    return errorResponse(error);
  }
}
