// Global token-bucket rate limiter — caps total request rate across all
// workers in the process, regardless of how many run concurrently.
//
// Source: Magic Pin/pipelines/upper/rate-limiter.js — ported as-is. This is
// the version that was actually wired into workers and proven in production
// (10 workers sharing one limiter, 2 req/s global cap, 634 venues). The
// equivalent module in Google/rate-limiter.js was never imported by any
// caller — that dead copy is intentionally not carried over.

class RateLimiter {
    constructor(requestsPerSecond) {
        this.minInterval = 1000 / requestsPerSecond;
        this.lastRequestAt = 0;
        this.queue = [];
        this.running = false;
    }

    // Call this before every rate-limited operation. Resolves when it's your turn.
    throttle() {
        return new Promise(resolve => {
            this.queue.push(resolve);
            this._drain();
        });
    }

    async _drain() {
        if (this.running) return;
        this.running = true;

        while (this.queue.length > 0) {
            const now = Date.now();
            const wait = Math.max(0, this.lastRequestAt + this.minInterval - now);
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
            this.lastRequestAt = Date.now();
            this.queue.shift()();
        }

        this.running = false;
    }
}

module.exports = { RateLimiter };
