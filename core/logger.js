// Structured JSONL event logging + small filesystem helpers.
//
// Source: Magic Pin/pipelines/shared/persistence.js (StructuredLogger, ensureDir,
// nowIso, slugify) — ported as-is. Google/'s pipeline only had console.log; this
// is the more production-grade logging that was actually used in the MagicPin
// run (structured events written to logs/{city}/run-{timestamp}.jsonl).

const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
    return new Date().toISOString();
}

function slugify(value) {
    return String(value || 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || 'unknown';
}

class StructuredLogger {
    constructor(logFile) {
        ensureDir(path.dirname(logFile));
        this.stream = fs.createWriteStream(logFile, { flags: 'a' });
    }

    log(level, event, data = {}) {
        const payload = { ts: nowIso(), level, event, ...data };
        this.stream.write(JSON.stringify(payload) + '\n');
        console.log(`[${payload.level}]`, payload.event, JSON.stringify(data));
    }

    info(event, data) { this.log('INFO', event, data); }
    warn(event, data) { this.log('WARN', event, data); }
    error(event, data) { this.log('ERROR', event, data); }

    close() {
        return new Promise(resolve => this.stream.end(resolve));
    }
}

module.exports = {
    ensureDir,
    nowIso,
    slugify,
    StructuredLogger,
};
