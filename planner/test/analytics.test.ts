import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDB, addHistory } from './helpers.js';
import { capture, usage, recommendations, defaultPeriod, trends, percentiles, periodFor } from '../src/analytics.js';
test('ranking senza storico: priorità sociale esplicita, nessun utilizzo o copertura inventati', () => {
  const db = testDB();
  try {
    const input = capture(db), r = recommendations(input, null);
    assert.equal(r.top.length, 3); assert.equal(r.expansion.length, 0);
    assert.ok(r.top.every(x => x.components.coverage === null && x.components.utilization === null));
    assert.equal(usage(input, null).available, false);
    assert.deepEqual(r, recommendations(input, null));
  } finally { db.close(); }
});
test('giorni abilitati, distinti su finestra, deattivazione e punti non localizzati', () => {
  const db = testDB();
  try {
    const input = addHistory(capture(db)), p = defaultPeriod(input)!;
    const total = usage(input, p), area = usage(input, p, { neighborhoodId: '1' });
    assert.equal(total.depositCount, 3); assert.equal(total.distinctDepositWallets, 1);
    assert.equal(area.enabledPointDays, 15); assert.equal(area.activeMachines, 0);
    assert.equal(area.utilization, 0.2); assert.equal(area.tokensMinted, '30');
    assert.equal(usage({ ...input, locations: [] }, p).unlocatedOperations, 3);
    assert.equal(usage({ ...input, locations: [] }, p, { neighborhoodId: '1' }).depositCount, 0);
    assert.equal((trends(input, 'Crocetta', p) as any).percentChange, null);
  } finally { db.close(); }
});
test('pesi coerenti, soglia 14 giorni, quartieri distinti e IDISE mancante escluso', () => {
  const db = testDB();
  try {
    const input = addHistory(capture(db)), p = defaultPeriod(input)!;
    input.zones.push({ ...input.zones[0], id: '09bis' });
    input.zones[3].idise = null;
    for (const pref of ['balanced', 'social', 'usage'] as const) {
      const r = recommendations(input, p, pref);
      assert.equal(new Set(r.top.map(x => x.neighborhoodId)).size, r.top.length);
      assert.ok(!r.candidates.some(x => x.neighborhoodId === '4'));
      for (const c of r.expansion) assert.equal(c.score, r.weights[0] * c.components.needCoverage + r.weights[1] * c.components.utilization!);
    }
    assert.deepEqual(percentiles([10, 10, 20]), [25, 25, 100]);
    assert.throws(() => periodFor(input, { from: '2090-01-01', to: '2090-01-02' }));
  } finally { db.close(); }
});
