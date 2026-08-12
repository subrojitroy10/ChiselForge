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

module.exports = { extractJsonLdBlocks, findByType };
