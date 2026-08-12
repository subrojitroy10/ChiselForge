const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateConfidence } = require('../extraction/confidence');

test('json-ld tier with full validation scores highest', () => {
    const c = estimateConfidence('json-ld', { totalItems: 2, validItems: 2 });
    assert.equal(c, 0.95);
});

test('text tier scores lower than hydration tier at equal validation', () => {
    const validation = { totalItems: 2, validItems: 2 };
    const text = estimateConfidence('text', validation);
    const hydration = estimateConfidence('hydration', validation);
    assert.ok(text < hydration);
});

test('partial validation lowers confidence proportionally', () => {
    const full = estimateConfidence('hydration', { totalItems: 4, validItems: 4 });
    const half = estimateConfidence('hydration', { totalItems: 4, validItems: 2 });
    assert.ok(half < full);
    assert.equal(half, Math.round(full * 0.5 * 100) / 100);
});

test('zero items scores zero confidence', () => {
    assert.equal(estimateConfidence('json-ld', { totalItems: 0, validItems: 0 }), 0);
});
