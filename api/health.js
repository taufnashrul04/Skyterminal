import { json } from './_response.js';

export const runtime = 'nodejs';

export async function GET() {
  return json({
    name: 'Skyterminal',
    status: 'ok',
    version: '0.6.0',
    marketIntelAssets: ['BTC', 'ETH', 'SOL', 'HYPE'],
    fundingUniverse: 'ALL',
    sources: ['Hyperliquid', 'Variational', 'RISEx', 'Nado', 'TxFlow', 'Arcus', 'PopDEX', 'Lighter'],
  });
}
