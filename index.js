module.exports = {
    // core
    JobQueue: require('./core/queue').JobQueue,
    ...require('./core/checkpoint'),
    ...require('./core/output'),
    RateLimiter: require('./core/rate-limiter').RateLimiter,
    ...require('./core/proxy-pool'),
    ...require('./core/logger'),
    ...require('./core/pagination'),
    runWorkerPool: require('./core/worker-loop').runWorkerPool,

    // transports
    http: require('./transports/http'),
    browser: require('./transports/browser'),

    // extraction strategies
    jsonLd: require('./extraction/json-ld'),
    llm: require('./extraction/llm'),
    htmlToText: require('./extraction/html-to-text').htmlToText,
    classify: require('./extraction/classify'),
    autoExtract: require('./extraction/auto').autoExtract,
    validate: require('./extraction/validate'),
    confidence: require('./extraction/confidence'),
};
