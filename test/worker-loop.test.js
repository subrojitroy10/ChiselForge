const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runWorkerPool } = require('../core/worker-loop');
const { loadCompletedKeys } = require('../core/checkpoint');

test('processes all jobs, retries a transient failure, and checkpoints', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-pool-'));
    const jobs = Array.from({ length: 6 }, (_, i) => ({ name: `job-${i + 1}` }));
    const failOnce = new Set(['job-3']);

    const result = await runWorkerPool({
        jobs,
        workerCount: 2,
        getCheckpointKey: job => job.name,
        checkpointDir: stateDir,
        maxRetries: 1,
        delayBetweenJobsMinMs: 0,
        delayBetweenJobsMaxMs: 0,
        errorBackoffMinMs: 5,
        errorBackoffMaxMs: 10,
        processJob: async job => {
            if (failOnce.has(job.name)) {
                failOnce.delete(job.name);
                throw new Error('simulated transient failure');
            }
            return { ok: true };
        },
    });

    assert.equal(result.done, 6);
    assert.equal(result.failed, 0);
    assert.deepEqual(
        [...loadCompletedKeys(stateDir)].sort(),
        jobs.map(j => j.name).sort()
    );
});

test('resuming against the same checkpoint dir skips already-completed jobs', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-pool-resume-'));
    const jobs = [{ name: 'a' }, { name: 'b' }];

    await runWorkerPool({
        jobs,
        workerCount: 1,
        getCheckpointKey: job => job.name,
        checkpointDir: stateDir,
        processJob: async () => ({ ok: true }),
    });

    let calledAgain = false;
    const second = await runWorkerPool({
        jobs,
        workerCount: 1,
        getCheckpointKey: job => job.name,
        checkpointDir: stateDir,
        processJob: async () => { calledAgain = true; return {}; },
    });

    assert.equal(calledAgain, false);
    assert.equal(second.skipped, 2);
});
