import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTicker, findFundingArbitrage, buildFundingSnapshot, extractProFundingVenueMarkets } from '../lib/funding.js';

test('normalizeTicker aligns common perpetual symbols', () => {
  assert.equal(normalizeTicker('BTC/USDC'), 'BTC');
  assert.equal(normalizeTicker('eth-perp'), 'ETH');
  assert.equal(normalizeTicker('1000BONK'), 'BONK');
});

test('extractProFundingVenueMarkets derives hourly rates without inventing prices', () => {
  const opportunities = [
    { symbol: 'BTC/USDC', long_exchange: 'TxFlow', long_apr: -8.76, long_volume_24h: 2_000_000, timestamp: '2026-10-15T07:00:00Z', short_exchange: 'Other', short_apr: 1 },
    { symbol: 'BTC/USDC', long_exchange: 'Other', long_apr: 1, short_exchange: 'TxFlow', short_apr: -4.38, short_volume_24h: 3_000_000, timestamp: '2026-10-15T06:00:00Z' },
  ];
  const markets = extractProFundingVenueMarkets(opportunities, 'TxFlow');
  assert.equal(markets.length, 1);
  assert.equal(markets[0].ticker, 'BTC');
  assert.equal(markets[0].markPrice, null);
  assert.equal(markets[0].priceType, 'unavailable');
  assert.ok(Math.abs(markets[0].fundingRate1h - (-8.76 / 100 / 8_760)) < 1e-12);
  assert.equal(markets[0].volume24h, 2_000_000);
});

test('findFundingArbitrage selects low-rate long and high-rate short', () => {
  const opportunities = findFundingArbitrage([
    { dex: 'A', ticker: 'BTC', markPrice: 100, fundingRate1h: -0.0001, volume24h: 2_000_000 },
    { dex: 'B', ticker: 'BTC/USDC', markPrice: 101, fundingRate1h: 0.0002, volume24h: 4_000_000 },
  ], { focusAssets: ['BTC'], roundTripCostBps: 12 });
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].longDex, 'A');
  assert.equal(opportunities[0].shortDex, 'B');
  assert.ok(Math.abs(opportunities[0].grossRate1h - 0.0003) < 1e-12);
  assert.equal(opportunities[0].breakEvenHours, 4);
  assert.ok(opportunities[0].priceDivergenceBps > 99);
});

test('findFundingArbitrage accepts public rates with unavailable venue prices', () => {
  const [opportunity] = findFundingArbitrage([
    { dex: 'TxFlow', ticker: 'BTC', markPrice: null, priceType: 'unavailable', fundingRate1h: -0.0001, volume24h: 5_000_000 },
    { dex: 'Hyperliquid', ticker: 'BTC', markPrice: 80_000, priceType: 'mark', fundingRate1h: 0.0001, volume24h: 50_000_000 },
  ], { focusAssets: ['BTC'] });
  assert.equal(opportunity.longDex, 'TxFlow');
  assert.equal(opportunity.priceDivergenceBps, null);
  assert.equal(opportunity.priceRisk, 'PRICE_UNAVAILABLE');
});

test('findFundingArbitrage does not grade oracle prices as executable basis', () => {
  const [opportunity] = findFundingArbitrage([
    { dex: 'MarkVenue', ticker: 'SOL', markPrice: 100, priceType: 'mark', fundingRate1h: -0.0001, volume24h: 5_000_000 },
    { dex: 'OracleVenue', ticker: 'SOL', markPrice: 100, priceType: 'oracle', fundingRate1h: 0.0002, volume24h: 5_000_000 },
  ], { focusAssets: ['SOL'] });
  assert.equal(opportunity.priceDivergenceBps, null);
  assert.equal(opportunity.priceRisk, 'ORACLE_PRICE_ONLY');
  assert.equal(opportunity.confidence, 'low');
});

test('findFundingArbitrage drops malformed and non-overlapping markets', () => {
  const opportunities = findFundingArbitrage([
    { dex: 'A', ticker: 'ETH', markPrice: 0, fundingRate1h: 1, volume24h: 1 },
    { dex: 'A', ticker: 'SOL', markPrice: 100, fundingRate1h: 0.1, volume24h: 1 },
    { dex: 'B', ticker: 'BTC', markPrice: 100, fundingRate1h: Number.NaN, volume24h: 1 },
  ]);
  assert.deepEqual(opportunities, []);
});

test('buildFundingSnapshot keeps every market when no funding filter is provided', async () => {
  const sources = {
    Alpha: async () => [
      { dex: 'Alpha', ticker: 'BTC', markPrice: 100, fundingRate1h: 0.0001, volume24h: 1_000_000 },
      { dex: 'Alpha', ticker: 'DOGE', markPrice: 0.2, fundingRate1h: -0.0001, volume24h: 2_000_000 },
    ],
    Beta: async () => [{ dex: 'Beta', ticker: 'DOGE', markPrice: 0.2, fundingRate1h: 0.0002, volume24h: 2_000_000 }],
  };
  const snapshot = await buildFundingSnapshot({ sources });
  assert.deepEqual(snapshot.focusAssets, ['ALL']);
  assert.equal(snapshot.markets.length, 3);
  assert.equal(snapshot.opportunities[0].pair, 'DOGE');
});

test('buildFundingSnapshot reports source health and focus assets', async () => {
  const sources = {
    Alpha: async () => [{ dex: 'Alpha', ticker: 'BTC', markPrice: 100, fundingRate1h: -0.0001, volume24h: 1_000_000 }],
    Beta: async () => [{ dex: 'Beta', ticker: 'BTC', markPrice: 100, fundingRate1h: 0.0001, volume24h: 1_000_000 }],
    Broken: async () => { throw new Error('offline'); },
  };
  const snapshot = await buildFundingSnapshot({ sources, focusAssets: ['BTC'] });
  assert.equal(snapshot.markets.length, 2);
  assert.equal(snapshot.opportunities.length, 1);
  assert.equal(snapshot.sources.Alpha.status, 'online');
  assert.equal(snapshot.sources.Broken.status, 'offline');
});
