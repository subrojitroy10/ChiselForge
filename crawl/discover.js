// Generic (site-agnostic) page-link discovery — sitemap.xml/robots.txt
// lookup plus a same-origin BFS crawl of <a href> links.
//
// Source: ported from web-UI/automate.js's discoverFromSitemaps()/
// crawlLinks()/sameSitePage()/normalize() — that module already implemented
// this generically (for arbitrary sites' sourcemap discovery), so this is a
// direct reuse of proven logic, not a rewrite. No site-specific assumptions
// anywhere in this file.

const { URL } = require('url');

function normalize(input, base) {
    try {
        const u = new URL(input, base);
        if (!/^https?:$/.test(u.protocol)) return null;
        u.hash = '';
        for (const key of [...u.searchParams.keys()]) {
            if (/^(utm_|fbclid|gclid)/i.test(key)) u.searchParams.delete(key);
        }
        return u.href;
    } catch {
        return null;
    }
}

const NON_PAGE_EXT = /\.(?:avif|basis|bin|bmp|css|csv|docx?|gif|glb|gltf|hdr|ico|jpe?g|js|json|ktx2|map|mp3|mp4|ogg|pdf|png|svg|txt|wasm|webm|webp|woff2?|xml|zip)$/i;

function sameSitePage(raw, base, allowedHost) {
    const href = normalize(raw, base);
    if (!href) return null;
    const u = new URL(href);
    if (u.hostname !== allowedHost) return null;
    if (NON_PAGE_EXT.test(u.pathname)) return null;
    return href;
}

function xmlLocations(xml) {
    return [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)]
        .map(match => match[1].trim()
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'"));
}

async function fetchText(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'accept-encoding': 'identity', 'user-agent': 'Mozilla/5.0 ChiselForgeCrawler/1.0' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { body: await response.text(), type: response.headers.get('content-type') || '' };
    } finally {
        clearTimeout(timer);
    }
}

async function sitemapCandidates(seed, timeoutMs) {
    const candidates = new Set([
        new URL('/sitemap.xml', seed).href,
        new URL('/sitemap_index.xml', seed).href,
    ]);
    try {
        const robots = await fetchText(new URL('/robots.txt', seed).href, timeoutMs);
        for (const match of robots.body.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) {
            const href = normalize(match[1], seed);
            if (href) candidates.add(href);
        }
    } catch (_) { /* robots.txt is optional */ }
    return [...candidates];
}

async function discoverFromSitemaps(seed, { maxPages, timeoutMs, allowedHost }) {
    const pages = new Set();
    const queue = await sitemapCandidates(seed, timeoutMs);
    const seen = new Set();

    while (queue.length && pages.size < maxPages) {
        const sitemap = queue.shift();
        if (seen.has(sitemap) || seen.size >= 50) continue;
        seen.add(sitemap);
        try {
            const { body } = await fetchText(sitemap, timeoutMs);
            const locations = xmlLocations(body);
            const isIndex = /<sitemapindex\b/i.test(body);
            for (const location of locations) {
                if (isIndex || /\.xml(?:\.gz)?(?:\?|$)/i.test(location)) {
                    const nested = normalize(location, sitemap);
                    if (nested && new URL(nested).hostname === allowedHost) queue.push(nested);
                } else {
                    const page = sameSitePage(location, seed, allowedHost);
                    if (page) pages.add(page);
                    if (pages.size >= maxPages) break;
                }
            }
        } catch (_) { /* this sitemap candidate doesn't exist or failed — try the next */ }
    }
    return [...pages];
}

async function crawlLinks(seed, { maxPages, timeoutMs, delayMs, allowedHost, onPage }) {
    const pages = new Set([seed]);
    const queue = [seed];
    const failures = [];

    while (queue.length && pages.size < maxPages) {
        const page = queue.shift();
        try {
            const { body, type } = await fetchText(page, timeoutMs);
            if (type && !type.includes('html')) continue;
            onPage?.(page, pages.size);
            for (const match of body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
                const href = sameSitePage(match[1], page, allowedHost);
                if (!href || pages.has(href)) continue;
                pages.add(href);
                queue.push(href);
                if (pages.size >= maxPages) break;
            }
        } catch (error) {
            failures.push({ url: page, error: error.message });
        }
        if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    }
    return { pages: [...pages], failures };
}

/**
 * Discovers same-origin pages starting from a seed URL — sitemap.xml first
 * (if present), then a same-origin BFS link crawl to fill in anything the
 * sitemap missed (or as the sole source if there's no sitemap).
 *
 * @param {string} seed
 * @param {object} [options]
 * @param {number} [options.maxPages=50]
 * @param {number} [options.timeoutMs=20000]
 * @param {number} [options.delayMs=200]     Delay between crawl requests — be a polite crawler
 * @param {(url:string, count:number)=>void} [options.onPage]  Progress callback during the link crawl
 * @returns {Promise<{ pages: string[], sitemapPageCount: number, crawledPageCount: number, failures: Array<{url:string, error:string}> }>}
 */
async function discoverPages(seed, options = {}) {
    const { maxPages = 50, timeoutMs = 20000, delayMs = 200, onPage } = options;
    const allowedHost = new URL(seed).hostname;

    const sitemapPages = await discoverFromSitemaps(seed, { maxPages, timeoutMs, allowedHost });
    const { pages: crawledPages, failures } = await crawlLinks(seed, { maxPages, timeoutMs, delayMs, allowedHost, onPage });

    const pages = [...new Set([seed, ...sitemapPages, ...crawledPages])].slice(0, maxPages);

    return {
        pages,
        sitemapPageCount: sitemapPages.length,
        crawledPageCount: crawledPages.length,
        failures,
    };
}

module.exports = {
    discoverPages,
    normalize,
    sameSitePage,
};
