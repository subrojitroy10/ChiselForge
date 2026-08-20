// Generic (site-agnostic) page-link discovery — sitemap.xml/robots.txt
// lookup plus a same-host BFS crawl of <a href> links.
//
// Source: ported from web-UI/automate.js's discoverFromSitemaps()/
// crawlLinks()/sameSitePage()/normalize() — that module already implemented
// this generically (for arbitrary sites' sourcemap discovery), so this is a
// direct reuse of proven logic, not a rewrite. No site-specific assumptions
// anywhere in this file.
//
// Worth being explicit about: <a href> extraction below runs a regex over
// the raw SOURCE HTML returned by a plain fetch, not a rendered/CSS-aware
// DOM. A link that's present in markup but hidden via CSS (display:none,
// visibility:hidden, or hidden purely by client-side JS) is still
// discovered here — this crawler doesn't compute rendered visibility, and
// doesn't claim to. That's a reasonable default for discovery (a hidden-but-
// real link is still a real page worth knowing about), just don't read
// "discovered" as "a human would see this link on the rendered page."

const { URL } = require('url');
const { BOT_BLOCK_STATUSES } = require('../transports/http');

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

// Matches the User-Agent header this crawler actually sends (see fetchText
// below) — used to pick which robots.txt group applies. robots.txt matching
// is a prefix/substring convention, not exact-string, so a site targeting
// "ChiselForgeCrawler" or a broader "*" group both apply.
const CRAWLER_USER_AGENT_TOKEN = 'chiselforgecrawler';

// Minimal robots.txt parser: User-agent groups, Disallow/Allow directives.
// Does not support wildcard (*) or end-anchor ($) path patterns within a
// single Disallow/Allow value — those are a real but less common part of
// the spec; plain path-prefix matching (what nearly every robots.txt in the
// wild actually uses) is what this covers.
function parseRobotsGroups(robotsTxt) {
    const lines = String(robotsTxt || '')
        .split('\n')
        .map(line => line.replace(/#.*/, '').trim())
        .filter(Boolean);

    const groups = [];
    let current = null;
    let sawRuleSinceLastAgent = true; // forces a new group on the first User-agent line

    for (const line of lines) {
        const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        const field = m[1].toLowerCase();
        const value = m[2].trim();

        if (field === 'user-agent') {
            // Consecutive "User-agent:" lines with no rule in between belong
            // to the SAME group (a common robots.txt convention: multiple
            // agents sharing one rule set) — only start a new group once a
            // Disallow/Allow has actually been seen for the current one.
            if (!current || sawRuleSinceLastAgent) {
                current = { agents: [], rules: [] };
                groups.push(current);
                sawRuleSinceLastAgent = false;
            }
            current.agents.push(value.toLowerCase());
        } else if ((field === 'disallow' || field === 'allow') && current) {
            current.rules.push({ type: field, path: value });
            sawRuleSinceLastAgent = true;
        }
    }
    return groups;
}

// Picks the most specific matching group for our UA (a named match beats
// the wildcard "*" group, per the robots.txt spec), then applies
// longest-path-wins precedence between its Disallow/Allow rules — also
// per-spec, and the only sane way to resolve e.g. "Disallow: /" alongside
// "Allow: /public/" for the same group.
function robotsDisallowsPath(groups, pathname) {
    const named = groups.filter(g => g.agents.some(a => a !== '*' && CRAWLER_USER_AGENT_TOKEN.includes(a)));
    const wildcard = groups.filter(g => g.agents.includes('*'));
    const applicable = (named.length ? named : wildcard).flatMap(g => g.rules);

    let best = null;
    for (const rule of applicable) {
        if (!rule.path) continue; // an empty "Disallow:" value means "disallow nothing"
        if (pathname.startsWith(rule.path) && (!best || rule.path.length > best.path.length)) {
            best = rule;
        }
    }
    return best ? best.type === 'disallow' : false;
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

// Real gap found live (crawling lovable.dev): this fetcher used to throw on
// ANY non-2xx status, same bug transports/http.js's fetchHtml had before its
// own fix. The link-crawl BFS walks real HTML pages one at a time — exactly
// where a bot-detection block is most likely to show up — so it needs the
// same opt-in bypass-attempt path, not just crawlSite.js's per-page fetch.
// Sitemap/robots.txt fetching (below) deliberately does NOT get this
// treatment: those are XML/text files meant for bots, rendering them with a
// browser wouldn't do anything useful, and in practice they weren't blocked
// even when the seed HTML page was.
async function fetchText(url, timeoutMs, { allowBotBlockFallback = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'accept-encoding': 'identity', 'user-agent': 'Mozilla/5.0 ChiselForgeCrawler/1.0' },
        });
        const isBotBlockFallbackCase = allowBotBlockFallback && BOT_BLOCK_STATUSES.has(response.status);
        if (!response.ok && !isBotBlockFallbackCase) throw new Error(`HTTP ${response.status}`);
        return { status: response.status, body: await response.text(), type: response.headers.get('content-type') || '' };
    } finally {
        clearTimeout(timer);
    }
}

async function fetchRobotsTxt(seed, timeoutMs) {
    try {
        return await fetchText(new URL('/robots.txt', seed).href, timeoutMs);
    } catch (_) {
        return null; // robots.txt is optional — absence means "everything allowed"
    }
}

function sitemapUrlsFromRobots(robotsBody, seed) {
    const urls = [];
    for (const match of robotsBody.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) {
        const href = normalize(match[1], seed);
        if (href) urls.push(href);
    }
    return urls;
}

async function discoverFromSitemaps(seed, { maxPages, timeoutMs, allowedHost, extraSitemapUrls, isAllowed }) {
    const pages = new Set();
    const queue = [
        new URL('/sitemap.xml', seed).href,
        new URL('/sitemap_index.xml', seed).href,
        ...extraSitemapUrls,
    ];
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
                    if (page && isAllowed(page)) pages.add(page);
                    if (pages.size >= maxPages) break;
                }
            }
        } catch (_) { /* this sitemap candidate doesn't exist or failed — try the next */ }
    }
    return [...pages];
}

async function crawlLinks(seed, { maxPages, timeoutMs, delayMs, allowedHost, onPage, renderWithBrowser, renderOnBlock = false, isAllowed }) {
    const pages = new Set([seed]);
    const queue = [seed];
    const failures = [];
    let robotsSkipped = 0;

    while (queue.length && pages.size < maxPages) {
        const page = queue.shift();
        try {
            let { body, type, status } = await fetchText(page, timeoutMs, { allowBotBlockFallback: renderOnBlock });
            if (renderOnBlock && BOT_BLOCK_STATUSES.has(status) && renderWithBrowser) {
                body = await renderWithBrowser(page);
                type = 'text/html';
            }
            if (type && !type.includes('html')) continue;
            onPage?.(page, pages.size);
            for (const match of body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
                const href = sameSitePage(match[1], page, allowedHost);
                if (!href || pages.has(href)) continue;
                // Checked here, before the page is ever queued/fetched — robots.txt
                // governs FETCHING, not just the final result list, so a disallowed
                // path must never be added to the crawl queue in the first place.
                if (!isAllowed(href)) { robotsSkipped++; continue; }
                pages.add(href);
                queue.push(href);
                if (pages.size >= maxPages) break;
            }
        } catch (error) {
            failures.push({ url: page, error: error.message });
        }
        if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    }
    return { pages: [...pages], failures, robotsSkipped };
}

/**
 * Discovers same-host pages starting from a seed URL — sitemap.xml first
 * (if present), then a same-host BFS link crawl to fill in anything the
 * sitemap missed (or as the sole source if there's no sitemap).
 *
 * @param {string} seed
 * @param {object} [options]
 * @param {number} [options.maxPages=50]
 * @param {number} [options.timeoutMs=20000]
 * @param {number} [options.delayMs=200]     Delay between crawl requests — be a polite crawler
 * @param {(url:string, count:number)=>void} [options.onPage]  Progress callback during the link crawl
 * @param {Function} [options.renderWithBrowser]
 *        Optional `(url) => Promise<html>` — see extraction/auto.js. Only
 *        used by the link-crawl BFS when options.renderOnBlock is also true.
 * @param {boolean} [options.renderOnBlock=false]
 *        Off by default — see transports/http.js's BOT_BLOCK_STATUSES and
 *        extraction/auto.js's renderOnBlock for why this stays opt-in. When
 *        true, a bot-block-shaped response (403/429/503) during the
 *        link-crawl BFS triggers a browser-render attempt instead of
 *        immediately recording a discovery failure for that page.
 * @param {boolean} [options.respectRobots=true]
 *        On by default — an OSS crawler that ignores robots.txt by default
 *        isn't something to ship. Fetches /robots.txt once, parses
 *        User-agent/Disallow/Allow directives (longest-path-wins, a named
 *        group beats "*"), and excludes matching paths from both sitemap
 *        and link-crawl discovery — checked BEFORE a candidate page is ever
 *        queued/fetched, not just filtered from the final list. The seed
 *        URL itself is always allowed regardless (the operator explicitly
 *        asked for exactly that page). Set false to disable entirely.
 * @returns {Promise<{
 *   pages: string[], sitemapPageCount: number, crawledPageCount: number,
 *   robotsDisallowedCount: number,
 *   failures: Array<{url:string, error:string}>,
 * }>}
 */
async function discoverPages(seed, options = {}) {
    const {
        maxPages = 50, timeoutMs = 20000, delayMs = 200, onPage,
        renderWithBrowser, renderOnBlock = false, respectRobots = true,
    } = options;
    const allowedHost = new URL(seed).hostname;

    let robotsGroups = [];
    let extraSitemapUrls = [];
    const robots = await fetchRobotsTxt(seed, timeoutMs);
    if (robots) {
        if (respectRobots) robotsGroups = parseRobotsGroups(robots.body);
        extraSitemapUrls = sitemapUrlsFromRobots(robots.body, seed);
    }

    const isAllowed = (url) => {
        if (url === seed || !robotsGroups.length) return true;
        try {
            return !robotsDisallowsPath(robotsGroups, new URL(url).pathname);
        } catch (_) {
            return true;
        }
    };

    const sitemapPages = await discoverFromSitemaps(seed, { maxPages, timeoutMs, allowedHost, extraSitemapUrls, isAllowed });
    const { pages: crawledPages, failures, robotsSkipped } = await crawlLinks(
        seed, { maxPages, timeoutMs, delayMs, allowedHost, onPage, renderWithBrowser, renderOnBlock, isAllowed }
    );

    const pages = [...new Set([seed, ...sitemapPages, ...crawledPages])].slice(0, maxPages);

    return {
        pages,
        sitemapPageCount: sitemapPages.length,
        crawledPageCount: crawledPages.length,
        robotsDisallowedCount: robotsSkipped,
        failures,
    };
}

module.exports = {
    discoverPages,
    normalize,
    sameSitePage,
};
