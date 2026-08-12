// Append-only, concurrency-safe checkpoint tracking — lets a run resume after
// a crash/restart by skipping items already marked complete.
//
// Source: Google/persistence.js (loadCompletedKeys, markCompleted, checkpointPath,
// ensureDirectory) — ported and generalized. The original coupled the checkpoint
// key format to "venueName|locality"; here the caller supplies any string key,
// so this has no knowledge of venues, reviews, or any specific domain.
//
// Why appendFileSync: it's atomic at the OS level for small writes, which is
// what makes this safe to call concurrently from multiple workers in the same
// process without a lock. Verified in production across 7-10 concurrent workers.

const fs = require('fs');
const path = require('path');

function ensureDirectory(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function checkpointPath(stateDir) {
    return path.join(stateDir, 'completed.txt');
}

function loadCompletedKeys(stateDir) {
    const file = checkpointPath(stateDir);
    if (!fs.existsSync(file)) return new Set();

    return new Set(
        fs.readFileSync(file, 'utf-8')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
    );
}

function markCompleted(stateDir, key) {
    ensureDirectory(stateDir);
    fs.appendFileSync(checkpointPath(stateDir), key + '\n');
}

module.exports = {
    ensureDirectory,
    checkpointPath,
    loadCompletedKeys,
    markCompleted,
};
