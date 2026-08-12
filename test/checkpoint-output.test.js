const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadCompletedKeys, markCompleted } = require('../core/checkpoint');
const { appendToWorkerFile, mergeWorkerFiles } = require('../core/output');

function tmpDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('checkpoint: marks and reloads completed keys', () => {
    const dir = tmpDir('harness-checkpoint-');
    markCompleted(dir, 'a');
    markCompleted(dir, 'b');
    const keys = loadCompletedKeys(dir);
    assert.deepEqual([...keys].sort(), ['a', 'b']);
});

test('checkpoint: missing state dir returns an empty set, not an error', () => {
    const dir = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());
    const keys = loadCompletedKeys(dir);
    assert.equal(keys.size, 0);
});

test('output: merges per-worker files and dedupes nested items', () => {
    const dir = tmpDir('harness-output-');
    appendToWorkerFile(path.join(dir, 'w1.json'), { venue: 'X', reviews: ['a', 'a', 'b'] });
    appendToWorkerFile(path.join(dir, 'w2.json'), { venue: 'X', reviews: ['b', 'c'] });

    const { mergedCount, outputPath } = mergeWorkerFiles(dir, 2, {
        workerFileName: i => `w${i}.json`,
        getGroupKey: r => r.venue,
        getItems: r => r.reviews,
        hashItem: item => item,
        baseFields: r => ({ venue: r.venue }),
        itemsFieldName: 'reviews',
        outputFileName: 'merged.json',
    });

    assert.equal(mergedCount, 1);
    const merged = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0].reviews.sort(), ['a', 'b', 'c']);

    // worker files should be cleaned up after merge
    assert.equal(fs.existsSync(path.join(dir, 'w1.json')), false);
    assert.equal(fs.existsSync(path.join(dir, 'w2.json')), false);
});
