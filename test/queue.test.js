const test = require('node:test');
const assert = require('node:assert/strict');
const { JobQueue } = require('../core/queue');

test('pulls jobs in order and tracks success', () => {
    const q = new JobQueue([{ n: 1 }, { n: 2 }], 0);
    const j1 = q.pull('w1');
    assert.equal(j1.n, 1);
    q.markSuccess(j1, { ok: true });
    assert.equal(q.size().done, 1);
});

test('retries a failed job up to maxRetries, then gives up', () => {
    const q = new JobQueue([{ n: 1 }], 1);
    const job = q.pull('w1');
    const first = q.markFailure(job, 'boom');
    assert.equal(first.requeued, true);
    assert.equal(first.retryCount, 1);

    const retried = q.pull('w1');
    const second = q.markFailure(retried, 'boom again');
    assert.equal(second.requeued, false);
    assert.equal(q.size().failed, 1);
});

test('hasPendingWork reflects in-flight jobs, not just the queue', () => {
    const q = new JobQueue([{ n: 1 }], 0);
    const job = q.pull('w1');
    assert.equal(q.hasPendingWork(), true); // in-flight, not yet resolved
    q.markSuccess(job, {});
    assert.equal(q.hasPendingWork(), false);
});
