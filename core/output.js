// Per-worker output isolation + merge-with-dedup.
//
// Source: Google/persistence.js (appendToWorkerJson, mergeWorkerFiles) —
// generalized. The original was hardcoded to a { venue_name, place_id,
// location, reviews } shape; this version takes caller-supplied key/hash
// functions so it has no knowledge of venues or reviews specifically.
//
// Why per-worker files: N concurrent workers writing to one shared output
// file is a race condition. Each worker owns its own file; merge() runs once,
// after all workers finish, and is the only place concurrent writes are
// reconciled.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashString(text) {
    return crypto.createHash('md5').update(text).digest('hex');
}

// Appends one record to this worker's output file (read-modify-write JSON array).
// Fine for the append rate a single worker produces; not meant for high-frequency
// writes — use appendJsonl() below if you need streaming/line-at-a-time writes.
function appendToWorkerFile(filePath, record) {
    let existing = [];
    if (fs.existsSync(filePath)) {
        try {
            existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (_) {
            existing = [];
        }
    }
    existing.push(record);
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
}

// Streaming line-delimited append — use this instead of appendToWorkerFile()
// when a worker writes many records (e.g. one per page) and you don't want to
// re-read/re-write the whole file each time.
function appendJsonl(filePath, record) {
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
}

function readJsonl(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            try { return JSON.parse(line); } catch (_) { return null; }
        })
        .filter(Boolean);
}

/**
 * Merges N per-worker JSON files into one deduplicated output file, then
 * deletes the per-worker files.
 *
 * @param {string} dir              Directory containing worker files
 * @param {number} totalWorkers     How many workerFileName(i) files to look for
 * @param {object} options
 * @param {(workerId:number)=>string} options.workerFileName  Per-worker file name
 * @param {(record:object)=>string}   options.getGroupKey      Key to merge records under (e.g. a venue name)
 * @param {(record:object)=>any[]}    options.getItems         Extracts the array of sub-items to dedup (e.g. reviews)
 * @param {(item:any)=>string}        options.hashItem         Produces a dedup key for one sub-item
 * @param {(record:object)=>object}   options.baseFields       Fields to keep from the first record seen for a group
 * @param {string}                    options.itemsFieldName   Field name for the deduped items array in the output
 * @param {string}                    options.outputFileName   Final merged file name
 * @returns {{ mergedCount: number, outputPath: string }}
 */
function mergeWorkerFiles(dir, totalWorkers, options) {
    const {
        workerFileName,
        getGroupKey,
        getItems,
        hashItem,
        baseFields = () => ({}),
        itemsFieldName = 'items',
        outputFileName = 'merged.json',
    } = options;

    const groups = new Map();

    for (let i = 1; i <= totalWorkers; i++) {
        const workerFile = path.join(dir, workerFileName(i));
        if (!fs.existsSync(workerFile)) continue;

        let records;
        try {
            records = JSON.parse(fs.readFileSync(workerFile, 'utf-8'));
        } catch (_) {
            fs.unlinkSync(workerFile);
            continue;
        }

        for (const record of records) {
            const key = getGroupKey(record);
            if (!groups.has(key)) {
                groups.set(key, { ...baseFields(record), _seenHashes: new Set(), [itemsFieldName]: [] });
            }
            const group = groups.get(key);
            for (const item of getItems(record)) {
                const hash = hashString(hashItem(item));
                if (!group._seenHashes.has(hash)) {
                    group._seenHashes.add(hash);
                    group[itemsFieldName].push(item);
                }
            }
        }

        fs.unlinkSync(workerFile);
    }

    const merged = Array.from(groups.values()).map(({ _seenHashes, ...rest }) => rest);
    const outputPath = path.join(dir, outputFileName);
    fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2));

    return { mergedCount: merged.length, outputPath };
}

module.exports = {
    appendToWorkerFile,
    appendJsonl,
    readJsonl,
    mergeWorkerFiles,
    hashString,
};
