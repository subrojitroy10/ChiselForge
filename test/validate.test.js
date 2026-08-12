const test = require('node:test');
const assert = require('node:assert/strict');
const { validateItems } = require('../extraction/validate');

const schema = { author: 'string', rating: 'number' };

test('all items matching the schema are valid', () => {
    const result = validateItems([{ author: 'A', rating: 5 }, { author: 'B', rating: 4 }], schema);
    assert.equal(result.valid, true);
    assert.equal(result.validItems, 2);
});

test('flags a missing field', () => {
    const result = validateItems([{ author: 'A' }], schema);
    assert.equal(result.valid, false);
    assert.deepEqual(result.results[0].issues, ['missing field "rating"']);
});

test('flags a type mismatch', () => {
    const result = validateItems([{ author: 'A', rating: 'five' }], schema);
    assert.equal(result.valid, false);
    assert.ok(result.results[0].issues[0].includes('expected number'));
});

test('empty items array is not valid (nothing to validate)', () => {
    const result = validateItems([], schema);
    assert.equal(result.valid, false);
    assert.equal(result.totalItems, 0);
});
