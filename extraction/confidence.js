// Confidence scoring — a fixed heuristic for v0.1, NOT a trained model.
//
// The intended future direction (see docs/architecture.md) is to learn confidence
// from actual extraction outcomes over time. Building that now would be
// pretending sophistication this project doesn't have yet. This just
// combines "how deterministic was the tier that answered" with "how much of
// the schema validation actually passed" into one number — good enough to
// surface in output, not good enough to make unsupervised decisions from.

const TIER_BASE_CONFIDENCE = {
    'json-ld': 0.95,   // deterministic, exact — only uncertainty is whether the block itself was well-formed
    hydration: 0.75,   // structured input, but still LLM-interpreted
    text: 0.5,         // no structure at all — the least reliable tier by construction
};

/**
 * @param {'json-ld'|'hydration'|'text'} tier
 * @param {{ totalItems: number, validItems: number }} validation
 * @returns {number} 0-1
 */
function estimateConfidence(tier, validation) {
    const base = TIER_BASE_CONFIDENCE[tier] ?? 0.5;
    if (!validation || validation.totalItems === 0) return 0;
    const validRatio = validation.validItems / validation.totalItems;
    return Math.round(base * validRatio * 100) / 100;
}

module.exports = { estimateConfidence, TIER_BASE_CONFIDENCE };
