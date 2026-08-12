// Retry-aware in-memory job queue.
//
// Source: Magic Pin/pipelines/shared/queue.js (JobQueue) — ported as-is, this
// module was already fully generic (no MagicPin-specific assumptions). It's a
// stronger base than Google/orchestrator.js's bare array, which had no retry
// tracking at all.
//
// Not a durable/distributed queue — in-memory only, single Node process.
// See OSS_PLAN.md §7 for why a durable queue was explicitly deferred.

class JobQueue {
    constructor(jobs, maxRetries = 0) {
        this.pending = jobs.map((job, i) => ({ ...job, id: i + 1, retryCount: 0 }));
        this.inFlight = new Map();
        this.done = [];
        this.failed = [];
        this.maxRetries = maxRetries;
    }

    pull(workerId) {
        const job = this.pending.shift();
        if (!job) return null;
        this.inFlight.set(job.id, { workerId, job });
        return job;
    }

    markSuccess(job, payload) {
        this.inFlight.delete(job.id);
        this.done.push({ ...job, payload, finishedAt: Date.now() });
    }

    // Requeues the job (up to maxRetries) or moves it to `failed`.
    // Returns { requeued: boolean, retryCount: number } so the caller can log accordingly.
    markFailure(job, reason) {
        this.inFlight.delete(job.id);
        if (job.retryCount < this.maxRetries) {
            job.retryCount += 1;
            this.pending.push(job);
            return { requeued: true, retryCount: job.retryCount };
        }
        this.failed.push({ ...job, reason, finishedAt: Date.now() });
        return { requeued: false, retryCount: job.retryCount };
    }

    hasPendingWork() {
        return this.pending.length > 0 || this.inFlight.size > 0;
    }

    size() {
        return {
            pending: this.pending.length,
            inFlight: this.inFlight.size,
            done: this.done.length,
            failed: this.failed.length,
        };
    }
}

module.exports = { JobQueue };
