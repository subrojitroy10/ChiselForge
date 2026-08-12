// Minimal schema validation for extracted items — checks that each item has
// the fields the caller asked for, with a roughly-matching JS type.
//
// This is a v0.1 shape check, not a full schema language (no nested object
// validation, no array-item-type checking, no min/max/enum constraints). It
// exists so autoExtract() can honestly report "did the extraction actually
// answer the schema" rather than just "did something come back."

function inferExpectedType(description) {
    const firstWord = String(description || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
    if (['string', 'text'].includes(firstWord)) return 'string';
    if (['number', 'integer', 'int', 'float', 'decimal'].includes(firstWord)) return 'number';
    if (['boolean', 'bool'].includes(firstWord)) return 'boolean';
    if (['array', 'list'].includes(firstWord)) return 'array';
    if (['object'].includes(firstWord)) return 'object';
    return null; // unrecognized type hint — skip the type check for this field, only check presence
}

function matchesType(value, expected) {
    if (expected === null) return true;
    if (expected === 'array') return Array.isArray(value);
    if (expected === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
    return typeof value === expected;
}

/**
 * @param {any[]} items
 * @param {object} schema   e.g. { name: "string", price: "number", reviews: "array" }
 * @returns {{ valid: boolean, totalItems: number, validItems: number, results: Array<{ index:number, valid:boolean, issues:string[] }> }}
 */
function validateItems(items, schema) {
    const fields = Object.keys(schema || {});

    const results = (items || []).map((item, index) => {
        const issues = [];
        if (typeof item !== 'object' || item === null) {
            return { index, valid: false, issues: ['item is not an object'] };
        }
        for (const field of fields) {
            if (!(field in item)) {
                issues.push(`missing field "${field}"`);
                continue;
            }
            const expected = inferExpectedType(schema[field]);
            if (!matchesType(item[field], expected)) {
                issues.push(`field "${field}" expected ${expected}, got ${typeof item[field]}`);
            }
        }
        return { index, valid: issues.length === 0, issues };
    });

    const validItems = results.filter(r => r.valid).length;

    return {
        valid: results.length > 0 && validItems === results.length,
        totalItems: results.length,
        validItems,
        results,
    };
}

module.exports = { validateItems, inferExpectedType, matchesType };
