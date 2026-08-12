// Transport-agnostic worker pool loop — the piece that ties JobQueue,
// checkpointing, staggered startup, and per-job delay/backoff together.
//
// This is new engineering (not a direct port): Google/worker.js and
// Magic Pin/pipelines/upper/worker.js each had their own version of this loop,
// hardcoded to one transport (Playwright vs axios) and one job shape (venue
// review scraping). This generalizes the *shape* both converged on — pull job,
// skip if checkpointed, run caller-supplied processJob(), checkpoint on
// success, backoff-and-continue on failure — without knowing what processJob()
// actually does. The caller wires in a transport (see transports/) inside
// processJob().

const { JobQueue } = require('./queue');
const { ensureDirectory, loadCompletedKeys, markCompleted } = require('./checkpoint');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

/**
 * @param {object} config
 * @param {object[]} config.jobs                          Jobs to process
 * @param {number} config.workerCount
 * @param {(job:object)=>string} config.getCheckpointKey   Stable, unique key per job
 * @param {string} config.checkpointDir                    Where completed.txt lives
 * @param {(job:object, ctx:object)=>Promise<any>} config.processJob
 *        Caller-supplied job processor. Receives (job, { workerId, logger }).
 *        Throwing marks the job as failed for this attempt (retried per maxRetries,
 *        then given up on). Returning normally marks it checkpointed.
 * @param {number} [config.maxRetries=0]
 * @param {number} [config.staggerMinMs=0]        Randomized worker startup offset range
 * @param {number} [config.staggerMaxMs=0]
 * @param {number} [config.delayBetweenJobsMinMs=0]   Delay after each successful job
 * @param {number} [config.delayBetweenJobsMaxMs=0]
 * @param {number} [config.errorBackoffMinMs=20000]   Delay after a failed job, before retrying/continuing
 * @param {number} [config.errorBackoffMaxMs=40000]
 * @param {object} [config.logger]                  Optional StructuredLogger (core/logger.js)
 * @param {(current:number, total:number)=>void} [config.onProgress]
 * @returns {Promise<{ done:number, failed:number, skipped:number }>}
 */
async function runWorkerPool(config) {
    const {
        jobs,
        workerCount,
        getCheckpointKey,
        checkpointDir,
        processJob,
        maxRetries = 0,
        staggerMinMs = 0,
        staggerMaxMs = 0,
        delayBetweenJobsMinMs = 0,
        delayBetweenJobsMaxMs = 0,
        errorBackoffMinMs = 20000,
        errorBackoffMaxMs = 40000,
        logger = null,
        onProgress = null,
    } = config;

    ensureDirectory(checkpointDir);
    const completed = loadCompletedKeys(checkpointDir);

    const remainingJobs = jobs.filter(job => !completed.has(getCheckpointKey(job)));
    logger?.info('worker_pool_start', {
        totalJobs: jobs.length,
        alreadyDone: completed.size,
        remaining: remainingJobs.length,
        workerCount,
    });

    if (remainingJobs.length === 0) {
        return { done: 0, failed: 0, skipped: completed.size };
    }

    const queue = new JobQueue(remainingJobs, maxRetries);
    const progress = { current: 0, total: remainingJobs.length };

    const workerLoop = async (workerId) => {
        if (staggerMaxMs > 0) {
            await sleep(randomDelay(staggerMinMs, staggerMaxMs));
        }

        while (queue.hasPendingWork()) {
            const job = queue.pull(workerId);
            if (!job) { await sleep(50); continue; }

            progress.current++;
            onProgress?.(progress.current, progress.total);

            try {
                const result = await processJob(job, { workerId, logger });
                queue.markSuccess(job, result);
                markCompleted(checkpointDir, getCheckpointKey(job));
                logger?.info('job_success', { workerId, key: getCheckpointKey(job) });

                if (delayBetweenJobsMaxMs > 0) {
                    await sleep(randomDelay(delayBetweenJobsMinMs, delayBetweenJobsMaxMs));
                }
            } catch (err) {
                const { requeued, retryCount } = queue.markFailure(job, err.message);
                logger?.error('job_failed', { workerId, key: getCheckpointKey(job), error: err.message, requeued, retryCount });
                await sleep(randomDelay(errorBackoffMinMs, errorBackoffMaxMs));
            }
        }
    };

    await Promise.all(Array.from({ length: workerCount }, (_, i) => workerLoop(i + 1)));

    const stats = queue.size();
    logger?.info('worker_pool_end', stats);

    return { done: stats.done, failed: stats.failed, skipped: completed.size };
}

module.exports = { runWorkerPool };
