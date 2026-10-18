import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaperTrade, projectPaperTrade } from '../public/paper-trade.js';

const route = { pair: 'BTC', longDex: 'binance', shortDex: 'bybit', longRate1h: -0.0001, shortRate1h: 0.0004, grossRate1h: 0.0005 };

test('projectPaperTrade calculates funding, cost, and net projection', () => {
  assert.deepEqual(projectPaperTrade(route, { capital: 1000, hours: 4, costBps: 20 }), {
    grossFunding: 2,
    estimatedCost: 2,
    projectedNet: 0,
  });
});

test('createPaperTrade stores a monitor-only paper position', () => {
  const trade = createPaperTrade(route, { capital: 2500, hours: 8, costBps: 20, id: 'paper-test', createdAt: '2026-10-18T00:00:00.000Z' });
  assert.equal(trade.id, 'paper-test');
  assert.equal(trade.status, 'OPEN');
  assert.equal(trade.pair, 'BTC');
  assert.equal(trade.projectedNet, 5);
  assert.equal(trade.estimatedCost, 5);
});
