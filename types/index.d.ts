// Type declarations for ChiselForge's public API (index.js).
//
// Hand-written against the runtime JSDoc, not generated — this is a v0.1
// JavaScript codebase (see docs/architecture.md's "Language choices" for why
// TypeScript-the-runtime isn't adopted yet). These declarations describe the
// existing public surface; they don't change any runtime behavior.
//
// `playwright`'s own types are intentionally not referenced here (it's an
// optional dependency — see README's "Install" section) — anything that
// takes/returns a Playwright object is typed loosely (e.g. `unknown`,
// documented in a comment) rather than creating a hard type-only dependency
// on a package most calls never need.

// ── Shared extraction types ─────────────────────────────────────────────

/** Field descriptor shape, e.g. { name: 'string', price: 'number', reviews: 'array' } */
export type Schema = Record<string, string>;

export type ExtractionStrategy = 'json-ld' | 'hydration' | 'text';

export interface ValidationFieldResult {
    index: number;
    valid: boolean;
    issues: string[];
}

export interface ValidationResult {
    valid: boolean;
    totalItems: number;
    validItems: number;
    results: ValidationFieldResult[];
}

export interface ExtractionMeta {
    strategy: ExtractionStrategy;
    llmUsed: boolean;
    browserUsed: boolean;
    confidence: number;
    validation: ValidationResult;
    needsBrowser: boolean;
    hasJsonLd: boolean;
    hydrationKey: string | null;
}

export interface ExtractionResult<T = any> {
    data: T[];
    extraction: ExtractionMeta;
}

/** `(url: string) => Promise<html>` — see transports/browser.js's createBrowserRenderer. */
export type RenderWithBrowser = (url: string) => Promise<string>;

export type OnStep = (step: string, detail?: object) => void;

export interface AutoExtractOptions {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    instructions?: string;
    llmMaxTokens?: number;
    llmTimeoutMs?: number;
    jsonLdType?: string;
    renderOnBlock?: boolean;
    renderWithBrowser?: RenderWithBrowser;
    /** Pre-fetched HTML — skips the internal fetch if supplied. */
    html?: string;
    /** Set true when the HTML passed via `html` was already produced by a browser render before this call. */
    browserUsed?: boolean;
    httpTimeoutMs?: number;
    hydrationMaxChars?: number;
    onStep?: OnStep;
}

export function autoExtract<T = any>(
    url: string,
    schema: Schema,
    options?: AutoExtractOptions
): Promise<ExtractionResult<T>>;

// ── Crawling ─────────────────────────────────────────────────────────────

export interface CrawlPageResult<T = any> {
    url: string;
    title: string | null;
    rawText: string;
    data: T[];
    strategy: ExtractionStrategy | null;
    llmUsed: boolean | null;
    browserUsed: boolean | null;
    confidence: number | null;
    warnings: string[];
    error: string | null;
}

export interface CrawlSiteOptions {
    maxPages?: number;
    workers?: number;
    delayMs?: number;
    /** Defaults to a unique temp dir per call — pass the same path back in to resume. */
    checkpointDir?: string;
    maxRetries?: number;
    /** Forwarded to runWorkerPool — delay after a failed page, before retrying/continuing. Defaults to runWorkerPool's own default (20-40s) if unset. */
    errorBackoffMinMs?: number;
    errorBackoffMaxMs?: number;
    /** On by default — see DiscoverPagesOptions.respectRobots. */
    respectRobots?: boolean;
    /** Forwarded to every autoExtract() call — apiKey, baseUrl, model, jsonLdType, instructions, etc. */
    extractOptions?: AutoExtractOptions;
    onProgress?: (event: string, detail?: object) => void;
}

export interface CrawlSiteResult<T = any> {
    seed: string;
    pagesDiscovered: number;
    discoveryFailures: Array<{ url: string; error: string }>;
    pagesExtracted: number;
    pagesFailed: number;
    pages: Array<CrawlPageResult<T>>;
}

export function crawlSite<T = any>(
    seed: string,
    schema: Schema,
    options?: CrawlSiteOptions
): Promise<CrawlSiteResult<T>>;

export interface DiscoverPagesOptions {
    maxPages?: number;
    timeoutMs?: number;
    delayMs?: number;
    onPage?: (url: string, count: number) => void;
    renderWithBrowser?: RenderWithBrowser;
    renderOnBlock?: boolean;
    /**
     * On by default. Fetches /robots.txt once and excludes disallowed paths
     * from both sitemap and link-crawl discovery, checked before a
     * candidate page is ever queued/fetched. The seed URL is always exempt.
     * Set false to disable robots.txt filtering entirely.
     */
    respectRobots?: boolean;
}

export interface DiscoverPagesResult {
    pages: string[];
    sitemapPageCount: number;
    crawledPageCount: number;
    robotsDisallowedCount: number;
    failures: Array<{ url: string; error: string }>;
}

export function discoverPages(seed: string, options?: DiscoverPagesOptions): Promise<DiscoverPagesResult>;

// ── core/queue.js ────────────────────────────────────────────────────────

export interface QueueSize {
    pending: number;
    inFlight: number;
    done: number;
    failed: number;
}

export interface MarkFailureResult {
    requeued: boolean;
    retryCount: number;
}

export class JobQueue<TJob extends object = any> {
    constructor(jobs: TJob[], maxRetries?: number);
    pull(workerId: number): (TJob & { id: number; retryCount: number }) | null;
    markSuccess(job: TJob & { id: number }, payload: any): void;
    markFailure(job: TJob & { id: number; retryCount: number }, reason: string): MarkFailureResult;
    hasPendingWork(): boolean;
    size(): QueueSize;
}

// ── core/worker-loop.js ──────────────────────────────────────────────────

export interface WorkerPoolConfig<TJob extends object = any> {
    jobs: TJob[];
    workerCount: number;
    /** Stable, unique key per job. */
    getCheckpointKey: (job: TJob) => string;
    /** Where completed.txt lives. */
    checkpointDir: string;
    /**
     * Caller-supplied job processor. Receives (job, { workerId, logger }).
     * Throwing marks the job as failed for this attempt (retried per
     * maxRetries, then given up on). Returning normally marks it checkpointed.
     */
    processJob: (job: TJob, ctx: { workerId: number; logger: StructuredLogger | null }) => Promise<any>;
    maxRetries?: number;
    /** Randomized worker startup offset range. */
    staggerMinMs?: number;
    staggerMaxMs?: number;
    /** Delay after each successful job. */
    delayBetweenJobsMinMs?: number;
    delayBetweenJobsMaxMs?: number;
    /** Delay after a failed job, before retrying/continuing. */
    errorBackoffMinMs?: number;
    errorBackoffMaxMs?: number;
    logger?: StructuredLogger | null;
    onProgress?: (current: number, total: number) => void;
}

export interface WorkerPoolResult {
    done: number;
    failed: number;
    skipped: number;
}

export function runWorkerPool<TJob extends object = any>(config: WorkerPoolConfig<TJob>): Promise<WorkerPoolResult>;

// ── core/checkpoint.js ───────────────────────────────────────────────────

export function ensureDirectory(dir: string): void;
export function checkpointPath(stateDir: string): string;
export function loadCompletedKeys(stateDir: string): Set<string>;
export function markCompleted(stateDir: string, key: string): void;

// ── core/output.js ───────────────────────────────────────────────────────

export function appendToWorkerFile(filePath: string, record: object): void;
export function appendJsonl(filePath: string, record: object): void;
export function readJsonl<T = any>(filePath: string): T[];

export interface MergeWorkerFilesOptions {
    workerFileName: (workerId: number) => string;
    /** Key to merge records under (e.g. a venue name). */
    getGroupKey: (record: any) => string;
    /** Extracts the array of sub-items to dedup (e.g. reviews). */
    getItems: (record: any) => any[];
    /** Produces a dedup key for one sub-item. */
    hashItem: (item: any) => string;
    /** Fields to keep from the first record seen for a group. */
    baseFields?: (record: any) => object;
    itemsFieldName?: string;
    outputFileName?: string;
}

export interface MergeWorkerFilesResult {
    mergedCount: number;
    outputPath: string;
}

export function mergeWorkerFiles(
    dir: string,
    totalWorkers: number,
    options: MergeWorkerFilesOptions
): MergeWorkerFilesResult;

export function hashString(text: string): string;

// ── core/rate-limiter.js ─────────────────────────────────────────────────

export class RateLimiter {
    constructor(requestsPerSecond: number);
    /** Call before every rate-limited operation. Resolves when it's your turn. */
    throttle(): Promise<void>;
}

// ── core/proxy-pool.js ───────────────────────────────────────────────────

export interface ParsedProxy {
    host: string;
    port: string;
    username: string;
    password: string;
}

export interface PlaywrightProxyOption {
    server: string;
    username: string;
    password: string;
}

export function loadProxyLines(filePath: string): string[];
export function parseProxyLine(line: string): ParsedProxy;
export function toPlaywrightProxy(proxy: ParsedProxy, protocol?: string): PlaywrightProxyOption;
export function toProxyUrl(proxy: ParsedProxy, protocol?: string): string;

export class ProxyPool {
    constructor(filePath: string);
    random(): ParsedProxy;
    randomPlaywrightProxy(protocol?: string): PlaywrightProxyOption;
    randomProxyUrl(protocol?: string): string;
    size(): number;
}

// ── core/logger.js ───────────────────────────────────────────────────────

export function ensureDir(dirPath: string): void;
export function nowIso(): string;
export function slugify(value: string): string;

export class StructuredLogger {
    constructor(logFile: string);
    log(level: string, event: string, data?: object): void;
    info(event: string, data?: object): void;
    warn(event: string, data?: object): void;
    error(event: string, data?: object): void;
    close(): Promise<void>;
}

// ── core/pagination.js ───────────────────────────────────────────────────

export function hashItems<T = any>(items: T[], serialize: (item: T) => string): string;

export function isRepeatedPage<T = any>(
    items: T[],
    serialize: (item: T) => string,
    previousHash: string | null
): { isDuplicate: boolean; hash: string };

export class DedupTracker {
    /** Adds a page's items, returns how many were new (0 means "stop paginating"). */
    addPage<T = any>(items: T[], getId: (item: T) => string | number | null | undefined): number;
    size(): number;
}

// ── transports/http.js ───────────────────────────────────────────────────

export namespace http {
    interface FetchHtmlOptions {
        timeoutMs?: number;
        userAgents?: string[];
        /** e.g. "http://user:pass@host:port" — see core/proxy-pool.js. */
        proxyUrl?: string;
        headers?: Record<string, string>;
        /**
         * When true, a bot-block-shaped status (see BOT_BLOCK_STATUSES) is
         * returned normally instead of throwing, so the caller can attempt a
         * browser render as a fallback. This is fetchHtml's own option name
         * at the transport level — the higher-level `renderOnBlock` option
         * on autoExtract()/crawlSite()/discoverPages() is what a library
         * consumer actually sets; it maps down to this one internally.
         */
        allowBotBlockFallback?: boolean;
    }

    function fetchHtml(url: string, options?: FetchHtmlOptions): Promise<{ status: number; html: string }>;
    function sleep(ms: number): Promise<void>;
    function jitter(baseMs: number, jitterMs: number): number;
    function randomItem<T>(arr: T[]): T;
    const DEFAULT_USER_AGENTS: string[];
    /** Statuses treated as bot-block signals (403, 429, 503) when opted in. */
    const BOT_BLOCK_STATUSES: Set<number>;
}

// ── transports/browser.js ────────────────────────────────────────────────
//
// Playwright objects below (`chromium`, `Browser`, `Page`, etc.) are typed as
// `unknown`/`any` deliberately — playwright is an optional dependency (see
// README's "Install") and these declarations don't want to force a type-only
// dependency on it for consumers who never touch the browser transport.

export namespace browser {
    interface BrowserRuntimeOptions {
        headless?: boolean;
        browserArgs?: string[];
        /** Recycle context every N completed jobs. */
        sessionLimit?: number;
        /** Full browser restart every N completed jobs. */
        restartLimit?: number;
        ignoreHTTPSErrors?: boolean;
    }

    class BrowserRuntime {
        /** @param chromium The imported `{ chromium }` module from `playwright`. */
        constructor(chromium: unknown, options?: BrowserRuntimeOptions);
        launch(): Promise<unknown>;
        /** Call once per completed job. Returns the (possibly new) active page. */
        recordJobDone(): Promise<unknown>;
        getPage(): unknown;
        close(): Promise<void>;
    }

    interface ConnectToLocalChromeOptions {
        port?: number;
        chromePaths?: string[];
        userDataDir?: string;
    }

    function connectToLocalChrome(
        chromium: unknown,
        options?: ConnectToLocalChromeOptions
    ): Promise<{ browser: unknown; context: unknown; page: unknown }>;

    interface CreateBrowserRendererOptions {
        stealth?: boolean;
        /** Restart the browser process every N renders. Off by default. */
        browserRestartEvery?: number;
        /** Injectable override for tests — defaults to a real playwright chromium launch. */
        launchBrowser?: () => Promise<unknown>;
    }

    function createBrowserRenderer(
        options?: CreateBrowserRendererOptions
    ): { renderWithBrowser: RenderWithBrowser; close: () => Promise<void> };

    const DEFAULT_BROWSER_ARGS: string[];
    const STEALTH_BROWSER_ARGS: string[];
    const DEFAULT_BULK_RESTART_EVERY: number;
    const DEFAULT_CHROME_PATHS: string[];
}

// ── extraction/json-ld.js ────────────────────────────────────────────────

export namespace jsonLd {
    function extractJsonLdBlocks(html: string): object[];
    function findByType(jsonLdBlocks: object[], type: string): object[];
    /** Only the block(s) tied for the single best schema field-overlap score. */
    function findRelevantBlocks(blocks: object[], schema: Schema, minOverlap?: number): object[];
    function fieldOverlapRatio(schema: Schema, block: object): number;
}

// ── extraction/llm.js ────────────────────────────────────────────────────

export namespace llm {
    interface ExtractWithLLMOptions {
        /** Falls back to process.env.NIM_API_KEY. Required — throws if neither is set. */
        apiKey?: string;
        /** Defaults to NVIDIA NIM's endpoint. */
        baseUrl?: string;
        /** Defaults to a NIM-hosted Llama model. */
        model?: string;
        instructions?: string;
        /** Set false if pageContent is already plain text. Defaults to true. */
        isHtml?: boolean;
        /** Truncates pageContent before sending. Defaults to 12000. */
        maxChars?: number;
        /** Completion token budget. Defaults to 4096. */
        maxTokens?: number;
        timeoutMs?: number;
    }

    /** Always normalized to an array — a bare-object response is wrapped as a one-item array. */
    function extractWithLLM(pageContent: string, schema: Schema, options?: ExtractWithLLMOptions): Promise<any[]>;
    function parseJsonFromLLMResponse(content: string): any;
    function buildSystemPrompt(schema: Schema, instructions?: string): string;
    const DEFAULT_BASE_URL: string;
    const DEFAULT_MODEL: string;
}

// ── extraction/html-to-text.js ───────────────────────────────────────────

export function htmlToText(html: string): string;

// ── extraction/classify.js ───────────────────────────────────────────────

export interface HydrationState {
    key: string;
    state: object;
}

export interface ClassifyHtmlOptions {
    /** HTTP status of the response `html` came from, if known. */
    status?: number;
}

export interface ClassifyHtmlResult {
    needsBrowser: boolean;
    hasJsonLd: boolean;
    hydration: HydrationState | null;
    sourceTextLength: number;
    blockedStatus: number | null;
}

export namespace classify {
    function classifyHtml(html: string, options?: ClassifyHtmlOptions): ClassifyHtmlResult;
    function detectHydrationState(html: string): HydrationState | null;
    function stripToSourceText(html: string): string;
    function looksLikeEmptyShell(html: string): boolean;
    const KNOWN_HYDRATION_GLOBALS: string[];
}

// ── extraction/validate.js ───────────────────────────────────────────────

export namespace validate {
    function validateItems(items: any[], schema: Schema): ValidationResult;
    function inferExpectedType(description: string): string | null;
    function matchesType(value: any, expected: string | null): boolean;
}

// ── extraction/confidence.js ─────────────────────────────────────────────

export namespace confidence {
    function estimateConfidence(
        tier: ExtractionStrategy,
        validation: { totalItems: number; validItems: number }
    ): number;
    const TIER_BASE_CONFIDENCE: Record<ExtractionStrategy, number>;
}
