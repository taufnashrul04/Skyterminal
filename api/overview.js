import { fetchAllMids } from '../lib/hyperliquid.js';
import { json, errorResponse } from './_response.js';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return json({ asOf: new Date().toISOString(), mids: await fetchAllMids() });
  } catch (error) {
    return errorResponse(error);
  }
}
