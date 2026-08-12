const test = require('node:test');
const assert = require('node:assert/strict');
const { DedupTracker, hashItems, isRepeatedPage } = require('../core/pagination');

test('DedupTracker signals zero new items when a page is fully duplicate', () => {
    const tracker = new DedupTracker();
    assert.equal(tracker.addPage([{ id: 1 }, { id: 2 }], x => x.id), 2);
    assert.equal(tracker.addPage([{ id: 2 }, { id: 3 }], x => x.id), 1); // 1 overlap
    assert.equal(tracker.addPage([{ id: 1 }, { id: 3 }], x => x.id), 0); // all seen -> stop signal
});

test('content-hash termination detects a repeated page', () => {
    const serialize = x => x.text;
    const page1 = [{ text: 'a' }, { text: 'b' }];
    const page2 = [{ text: 'a' }, { text: 'b' }]; // identical content
    const { hash: hash1 } = isRepeatedPage(page1, serialize, null);
    const { isDuplicate, hash: hash2 } = isRepeatedPage(page2, serialize, hash1);
    assert.equal(isDuplicate, true);
    assert.equal(hash1, hash2);
});

test('content-hash termination does not false-positive on different content', () => {
    const serialize = x => x.text;
    const page1 = [{ text: 'a' }];
    const { hash: hash1 } = isRepeatedPage(page1, serialize, null);
    const page2 = [{ text: 'different' }];
    const { isDuplicate } = isRepeatedPage(page2, serialize, hash1);
    assert.equal(isDuplicate, false);
});
