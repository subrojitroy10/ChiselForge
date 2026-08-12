// Two proven pagination-termination strategies, generalized from three
// different adapters that each independently arrived at a version of them:
//
// 1. Content-hash termination (Magic Pin/pipelines/upper/worker.js): hash the
//    page's content; if two consecutive pages hash the same, the source is
//    looping (returning the last page repeatedly) — stop.
//
// 2. ID-based dedup termination (Scrapper/zomato.js, and Google/worker.js's
//    in-memory review Map): track seen item IDs; if a page contributes zero
//    new IDs, either the source looped or ran out — stop.
//
// Use content-hash when items don't have a stable ID (e.g. scraped text with
// no source-provided key). Use ID-based dedup when they do — it's the more
// reliable signal (proven across both MagicPin's numeric hash and Zomato's
// literal reviewId) because it survives item reordering across pages, which
// a whole-page content hash does not.

const crypto = require('crypto');

function hashItems(items, serialize) {
    const blob = items.map(serialize).join('\n');
    return crypto.createHash('sha256').update(blob).digest('hex');
}

// Returns true if this page's hash matches the previous page's hash.
function isRepeatedPage(items, serialize, previousHash) {
    const hash = hashItems(items, serialize);
    return { isDuplicate: hash === previousHash, hash };
}

class DedupTracker {
    constructor() {
        this.seen = new Set();
    }

    // Adds a page's items, returns how many were new (0 means "stop paginating").
    addPage(items, getId) {
        let newCount = 0;
        for (const item of items) {
            const id = getId(item);
            if (id == null || this.seen.has(id)) continue;
            this.seen.add(id);
            newCount++;
        }
        return newCount;
    }

    size() {
        return this.seen.size;
    }
}

module.exports = {
    hashItems,
    isRepeatedPage,
    DedupTracker,
};
