// runWorkerPool() is the engineering layer underneath autoExtract/crawlSite —
// checkpointed, retryable, concurrent job execution with no opinion about
// what a "job" actually does. This demonstrates it directly, with a trivial
// in-memory job list instead of real extraction, so it runs instantly with
// no network and no LLM key. One job deliberately fails once to show retry.
//
//   node examples/worker-pool.js

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runWorkerPool } = require('../index');

async function main() {
    const jobs = [1, 2, 3, 4, 5].map(n => ({ n }));
    let job3Attempts = 0;

    const result = await runWorkerPool({
        jobs,
        workerCount: 2,
        getCheckpointKey: job => `job-${job.n}`,
        checkpointDir: path.join(os.tmpdir(), 'chiselforge-examples', `worker-pool-${crypto.randomBytes(4).toString('hex')}`),
        maxRetries: 2,
        // runWorkerPool defaults errorBackoffMinMs/MaxMs to 20-40 SECONDS —
        // sane for real scraping (don't hammer a site that just failed), but
        // this demo's simulated failure would otherwise make a "runs
        // instantly" example sit there for up to 40s for no visible reason.
        // Turned down here for the demo only; a real workload should keep
        // the real-world default (or something in that range).
        errorBackoffMinMs: 50,
        errorBackoffMaxMs: 150,
        processJob: async (job) => {
            if (job.n === 3) {
                job3Attempts++;
                if (job3Attempts === 1) throw new Error('simulated transient failure on job 3');
            }
            return job.n * job.n;
        },
        onProgress: (current, total) => console.log(`progress: ${current}/${total}`),
    });

    console.log('result:', result); // { done, failed, skipped }
}

main().catch(err => {
    console.error(err.message);
    process.exitCode = 1;
});
