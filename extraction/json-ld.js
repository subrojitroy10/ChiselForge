// Tier-2 extraction: schema.org structured data (JSON-LD).
//
// Many sites embed <script type="application/ld+json"> blocks specifically
// so crawlers can read structured data (Review, Product, AggregateRating,
// Article, ...) without custom selectors. When present, this is faster, free,
// and more reliable than both DOM scraping and LLM extraction — always try
// this tier before falling back to extraction/llm.js.

function extractJsonLdBlocks(html) {
    const blocks = [...String(html || '').matchAll(
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    )];

    const results = [];
    for (const match of blocks) {
        try {
            results.push(JSON.parse(match[1].trim()));
        } catch (_) {
            // Malformed JSON-LD is common enough (trailing commas, HTML-escaped
            // quotes) that we just skip it rather than throw.
        }
    }
    return results;
}

// JSON-LD can nest via @graph, and @type can be a string or an array.
// Flattens everything into one list and filters by type.
function findByType(jsonLdBlocks, type) {
    const flat = [];
    for (const block of jsonLdBlocks) {
        const items = Array.isArray(block) ? block : [block];
        for (const item of items) {
            flat.push(item);
            if (Array.isArray(item['@graph'])) flat.push(...item['@graph']);
        }
    }

    return flat.filter(item => {
        const t = item?.['@type'];
        if (!t) return false;
        return Array.isArray(t) ? t.includes(type) : t === type;
    });
}

// Best-effort relevance heuristic for when the caller doesn't know (or
// didn't supply) the schema.org @type they want — see auto.js. Not ML, just
// field-name overlap: "does this JSON-LD block's own keys look like they'd
// answer this schema, or is it clearly a different kind of block (e.g.
// WebSite/BreadcrumbList) that happens to share the page with what you
// actually want." A real @type match (findByType) is always more precise
// than this when you have one — prefer that when you know it.
function fieldOverlapRatio(schema, block) {
    const schemaFields = Object.keys(schema || {}).map(f => f.toLowerCase());
    const blockFields = Object.keys(block || {})
        .filter(k => !k.startsWith('@'))
        .map(k => k.toLowerCase());

    if (!schemaFields.length || !blockFields.length) return 0;

    let matches = 0;
    for (const schemaField of schemaFields) {
        if (blockFields.some(blockField =>
            blockField === schemaField ||
            blockField.includes(schemaField) ||
            schemaField.includes(blockField)
        )) matches++;
    }
    return matches / schemaFields.length;
}

/**
 * @param {object[]} blocks
 * @param {object} schema
 * @param {number} [minOverlap=0.34]  Fraction of schema fields that must plausibly match a block's own keys
 * @returns {object[]} only the block(s) tied for the single best overlap score (empty if none clear minOverlap)
 */
function findRelevantBlocks(blocks, schema, minOverlap = 0.34) {
    // Returning everything above a loose floor is a real false-positive risk
    // with small schemas: a 2-field schema sharing just one common field
    // (e.g. "name") with an unrelated WebSite block can clear a 0.34 floor on
    // its own. Only returning the top-scoring block(s) — not everything above
    // the floor — avoids that without needing a much stricter, more
    // false-negative-prone floor.
    const scored = blocks
        .map(block => ({ block, overlap: fieldOverlapRatio(schema, block) }))
        .filter(({ overlap }) => overlap >= minOverlap);

    if (!scored.length) return [];

    const maxOverlap = Math.max(...scored.map(s => s.overlap));
    return scored
        .filter(({ overlap }) => overlap === maxOverlap)
        .map(({ block }) => block);
}

module.exports = { extractJsonLdBlocks, findByType, findRelevantBlocks, fieldOverlapRatio };
