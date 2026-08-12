// Plain-HTTP transport — proxy-aware fetch with UA rotation and timeout.
//
// Source: generalized from Magic Pin/pipelines/upper/worker.js's fetchPage()
// (proxy + UA rotation, proven at scale) and Scrapper/zomato.js's fetchHtml()
// (proven against Zomato with zero proxy, zero blocks).
//
// Zero dependencies for the no-proxy path (native fetch, Node 18+). The
// proxy path lazily requires `undici` (the library Node's own fetch is built
// on) only when a proxy URL is actually supplied — same lazy-require pattern
// used in Scrapper/zomato.js for playwright, so `node your-adapter.js <url>`
// never needs undici installed unless you opt into proxying.

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function jitter(baseMs, jitterMs) { return baseMs + Math.floor(Math.random() * jitterMs); }

const DEFAULT_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

/**
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeoutMs=30000]
 * @param {string[]} [options.userAgents]   Defaults to DEFAULT_USER_AGENTS
 * @param {string} [options.proxyUrl]       e.g. "http://user:pass@host:port" (see core/proxy-pool.js)
 * @param {object} [options.headers]        Extra/override headers
 * @returns {Promise<{ status:number, html:string }>}
 */
async function fetchHtml(url, options = {}) {
    const {
        timeoutMs = 30000,
        userAgents = DEFAULT_USER_AGENTS,
        proxyUrl = null,
        headers = {},
    } = options;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const fetchOptions = {
        signal: controller.signal,
        headers: {
            'User-Agent': randomItem(userAgents),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            ...headers,
        },
    };

    if (proxyUrl) {
        // Lazy require — only pulled in when a proxy is actually used.
        const { ProxyAgent } = require('undici');
        fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
    }

    try {
        const response = await fetch(url, fetchOptions);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { status: response.status, html: await response.text() };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    fetchHtml,
    sleep,
    jitter,
    randomItem,
    DEFAULT_USER_AGENTS,
};
