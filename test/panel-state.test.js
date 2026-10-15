import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePanelState, setPanelCollapsed } from '../public/panel-state.js';

test('normalizePanelState keeps only boolean panel states', () => {
  assert.deepEqual(normalizePanelState({ market: true, flow: false, bad: 'yes', other: 1 }), {
    market: true,
    flow: false,
  });
});

test('setPanelCollapsed updates one panel without mutating prior state', () => {
  const before = { market: false };
  const after = setPanelCollapsed(before, 'market', true);
  assert.deepEqual(before, { market: false });
  assert.deepEqual(after, { market: true });
});
