// Browser transport — Playwright lifecycle management, two modes:
//
// 1. BrowserRuntime — fresh-launched, headless-capable browser with automatic
//    context recycling and full restarts on a cadence. Source: generalized
//    from Google/worker.js (browserRestartLimit / sessionVenueLimit logic,
//    proven across 7 concurrent workers, ~11k venues). Use this for worker-pool
//    jobs.
//
// 2. connectToLocalChrome — attaches to (and if needed, launches) a real,
//    visible local Chrome via the Chrome DevTools Protocol. Source: ported
//    from Scrapper/google.js / Scrapper/zomato.js's ensureChrome/getWsUrl.
//    Use this for interactive/search-and-click flows where you want a visible
//    browser (e.g. resolving a venue name to a URL via a Google search+click).
//
// `playwright` is required by the caller, not this module — see the lazy
// require pattern in extraction/llm.js. This keeps HTTP-only usage (e.g.
// autoExtract's JSON-LD/hydration tiers) free of a playwright dependency.

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const DEFAULT_BROWSER_ARGS = [
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
];

// ── Mode 1: fresh-launched worker-pool browser with recycling ──────────────

class BrowserRuntime {
    /**
     * @param {import('playwright')} playwright   Pass the imported `{ chromium }` module
     * @param {object} [options]
     * @param {boolean} [options.headless=false]
     * @param {string[]} [options.browserArgs]
     * @param {number} [options.sessionLimit=15]   Recycle context every N completed jobs
     * @param {number} [options.restartLimit=45]   Full browser restart every N completed jobs
     * @param {boolean} [options.ignoreHTTPSErrors=true]
     */
    constructor(chromium, options = {}) {
        this.chromium = chromium;
        this.headless = options.headless ?? false;
        this.browserArgs = options.browserArgs ?? DEFAULT_BROWSER_ARGS;
        this.sessionLimit = options.sessionLimit ?? 15;
        this.restartLimit = options.restartLimit ?? 45;
        this.ignoreHTTPSErrors = options.ignoreHTTPSErrors ?? true;

        this.browser = null;
        this.context = null;
        this.page = null;
        this.jobsInSession = 0;
        this.jobsTotal = 0;
    }

    async launch() {
        this.browser = await this.chromium.launch({ headless: this.headless, args: this.browserArgs });
        this.context = await this.browser.newContext({ ignoreHTTPSErrors: this.ignoreHTTPSErrors });
        this.page = await this.context.newPage();
        return this.page;
    }

    // Call once per completed job. Handles context recycling / full restart
    // on the configured cadence, returns the (possibly new) active page.
    async recordJobDone() {
        this.jobsTotal++;
        this.jobsInSession++;

        if (this.jobsTotal > 0 && this.jobsTotal % this.restartLimit === 0) {
            try { await this.context.close(); } catch (_) {}
            try { await this.browser.close(); } catch (_) {}
            await sleep(randomDelay(3000, 5000));
            this.browser = await this.chromium.launch({ headless: this.headless, args: this.browserArgs });
            this.context = await this.browser.newContext({ ignoreHTTPSErrors: this.ignoreHTTPSErrors });
            this.page = await this.context.newPage();
            this.jobsInSession = 0;
        } else if (this.jobsInSession > 0 && this.jobsInSession % this.sessionLimit === 0) {
            try { await this.context.close(); } catch (_) {}
            this.context = await this.browser.newContext({ ignoreHTTPSErrors: this.ignoreHTTPSErrors });
            this.page = await this.context.newPage();
        }

        return this.page;
    }

    getPage() {
        return this.page;
    }

    async close() {
        try { await this.browser.close(); } catch (_) {}
    }
}

// ── Mode 2: attach to a real local Chrome via CDP ───────────────────────────

const DEFAULT_CHROME_PATHS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
];

function findChrome(candidatePaths) {
    for (const p of candidatePaths) { if (p && fs.existsSync(p)) return p; }
    return null;
}

function isDebugPortOpen(port) {
    return new Promise(resolve => {
        http.get(`http://127.0.0.1:${port}/json/version`, res => { res.resume(); resolve(true); })
            .on('error', () => resolve(false));
    });
}

function getWsUrl(port) {
    return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/json/version`, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data).webSocketDebuggerUrl); }
                catch (err) { reject(err); }
            });
        }).on('error', reject);
    });
}

/**
 * Ensures a debuggable local Chrome is running, launching one if needed, and
 * returns a connected Playwright browser/context/page via CDP.
 *
 * @param {import('playwright')} playwright
 * @param {object} [options]
 * @param {number} [options.port=9222]
 * @param {string[]} [options.chromePaths]   Override the search paths for chrome.exe
 * @param {string} [options.userDataDir]     Defaults to a .chrome-debug-profile next to the caller
 */
async function connectToLocalChrome(chromium, options = {}) {
    const port = options.port ?? 9222;
    const chromePaths = options.chromePaths ?? DEFAULT_CHROME_PATHS;
    const userDataDir = options.userDataDir ?? path.join(process.cwd(), '.chrome-debug-profile');

    if (!(await isDebugPortOpen(port))) {
        const exe = findChrome(chromePaths);
        if (!exe) throw new Error('Chrome not found — pass chromePaths with your install location');

        spawn(exe, [
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${userDataDir}`,
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-popup-blocking',
        ], { detached: true, stdio: 'ignore' }).unref();

        let ready = false;
        for (let i = 0; i < 20; i++) {
            await sleep(500);
            if (await isDebugPortOpen(port)) { ready = true; break; }
        }
        if (!ready) throw new Error('Chrome launched but debug port never opened');
    }

    const wsUrl = await getWsUrl(port);
    const browser = await chromium.connectOverCDP(wsUrl);
    const context = browser.contexts()[0] || await browser.newContext({ ignoreHTTPSErrors: true });
    const page = context.pages()[0] || await context.newPage();

    return { browser, context, page };
}

// ── Mode 3: simple per-call renderWithBrowser factory ───────────────────────
//
// Unlike BrowserRuntime above (one persistent page reused across jobs, with
// context recycling), this opens a fresh page per call and closes it
// immediately — which, in Playwright, already creates an isolated ephemeral
// context that closes with the page. So the "recycle the context every N
// items" half of BrowserRuntime's pattern happens here for free; only the
// full PROCESS restart (releases Chrome's accumulated heap, which a
// context-only recycle doesn't) is a real gap for a long run through one
// browser process. Used by cli.js's extract/crawl commands.

const STEALTH_BROWSER_ARGS = [...DEFAULT_BROWSER_ARGS, '--start-maximized'];

// Default full-browser-restart interval for bulk-mode crawls, matching
// BrowserRuntime's own restartLimit default (45) — same proven cadence from
// the Google-places scraper, ~11,000 venues.
const DEFAULT_BULK_RESTART_EVERY = 45;

/**
 * Lazily launches a shared browser (reused across every renderWithBrowser
 * call, not relaunched per call — except when browserRestartEvery is set)
 * and returns a renderWithBrowser(url) function for autoExtract's
 * needsBrowser fallback. playwright is only required here, not by this
 * module's other exports — callers that never render a page never pay for
 * it. Caller is responsible for calling the returned close() when done.
 *
 * @param {object} [options]
 * @param {boolean} [options.stealth=false]
 *        Launches a real, visible (headless: false) browser with
 *        anti-detection args instead of the default headless instance.
 *        Only meaningful when attempting to get past bot-detection — see
 *        cli.js's --render-on-block.
 * @param {number} [options.browserRestartEvery]
 *        Undefined by default (off) — a single long-running browser process
 *        is fine for the common case (one page, or a small crawl). Only
 *        meaningful for a genuinely large crawl (hundreds/thousands of
 *        pages) run through one browser process for the whole duration —
 *        see cli.js's --bulk. Restarts the browser process every N renders.
 * @param {Function} [options.launchBrowser]
 *        Injectable override for tests — lets the restart-counting logic be
 *        verified without launching a real browser. Defaults to the real
 *        playwright chromium launch.
 * @returns {{ renderWithBrowser: (url:string)=>Promise<string>, close: ()=>Promise<void> }}
 */
function createBrowserRenderer({ stealth = false, browserRestartEvery, launchBrowser } = {}) {
    let browserPromise = null;
    let renderCount = 0;

    const launch = launchBrowser || (() => {
        let chromium;
        try {
            ({ chromium } = require('playwright'));
        } catch (err) {
            throw new Error(
                'Browser rendering requires the optional "playwright" dependency, which is ' +
                'not installed. Run `npm install playwright && npx playwright install chromium` ' +
                '(or reinstall without `--omit=optional`) to use browser fallback.'
            );
        }
        return stealth
            ? chromium.launch({ headless: false, args: STEALTH_BROWSER_ARGS })
            : chromium.launch({ headless: true });
    });

    async function getBrowser() {
        if (!browserPromise) browserPromise = launch();
        return browserPromise;
    }

    const renderWithBrowser = async (url) => {
        if (browserRestartEvery && renderCount > 0 && renderCount % browserRestartEvery === 0) {
            if (browserPromise) { try { await (await browserPromise).close(); } catch (_) {} }
            browserPromise = null;
        }
        renderCount++;

        const browser = await getBrowser();
        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(1000); // let client-side rendering settle
            return await page.content();
        } finally {
            await page.close();
        }
    };
    const close = async () => {
        if (browserPromise) { try { await (await browserPromise).close(); } catch (_) {} }
    };
    return { renderWithBrowser, close };
}

module.exports = {
    BrowserRuntime,
    connectToLocalChrome,
    createBrowserRenderer,
    DEFAULT_BROWSER_ARGS,
    STEALTH_BROWSER_ARGS,
    DEFAULT_BULK_RESTART_EVERY,
    DEFAULT_CHROME_PATHS,
};
