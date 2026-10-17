import { buildFundingSnapshot } from '../lib/funding.js';
import { json, errorResponse } from './_response.js';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  try {
    const roundTripCostBps = Number(process.env.FUNDING_ROUND_TRIP_COST_BPS ?? 20);
    return json({ ...(await buildFundingSnapshot({ roundTripCostBps })), costModel: 'FEES + ESTIMATED SPREAD' }, 200, { 'cache-control': 'public, s-maxage=5, stale-while-revalidate=10' });
  } catch (error) {
    return errorResponse(error);
  }
}
