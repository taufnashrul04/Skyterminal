import { buildFundingSnapshot } from '../lib/funding.js';
import { json, errorResponse } from './_response.js';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  try {
    return json(await buildFundingSnapshot(), 200, { 'cache-control': 'public, s-maxage=20, stale-while-revalidate=40' });
  } catch (error) {
    return errorResponse(error);
  }
}
