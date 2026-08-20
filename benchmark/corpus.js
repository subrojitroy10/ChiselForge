// Benchmark corpus — real, live, publicly-accessible pages (plus one local
// fixture for the browser-rendering case, see local-server.js's comment for
// why that one is local rather than an external URL).
//
// Categories covered, and why each site was chosen:
//   - relevant JSON-LD              Zomato restaurant metadata (Restaurant type)
//   - irrelevant JSON-LD present    Zomato reviews page, same JSON-LD, wrong schema
//   - hydration state + LLM         Zomato reviews (window.__PRELOADED_STATE__)
//   - Next.js hydration (__NEXT_DATA__), different domain than the above
//   - plain SSR, no structure       example.com (IANA's official test domain)
//   - e-commerce, no structure      books.toscrape.com (built for scraper testing)
//   - article/text content          quotes.toscrape.com (same family, different shape)
//   - requires browser rendering    local SPA-shell fixture + real Playwright render
//   - honest failure                schema asking for data that doesn't exist on the page
//   - relevant JSON-LD, @graph-wrapped  Atomberg homepage (Organization inside @graph, not top-level @type)
//   - Next.js hydration, second domain  Replit homepage (different __NEXT_DATA__ shape than DigitalOcean's)
//
// toscrape.com sites are explicitly built and maintained for scraper
// testing/practice — used here instead of a live commercial store specifically
// to avoid any ToS ambiguity a repeated benchmark run against a real retailer
// could raise. The two real-site additions below (Atomberg, Replit) are
// deliberately kept in benchmark/ rather than examples/ for the same
// reason — this file is run occasionally by a maintainer, not shipped for
// every user to re-run repeatedly (see CONTRIBUTING.md).

module.exports = [
    {
        name: 'zomato-restaurant-metadata (relevant JSON-LD, no LLM)',
        url: 'https://www.zomato.com/mumbai/british-brewing-company-lower-parel/reviews',
        schema: { name: 'string', telephone: 'string', servesCuisine: 'string' },
        options: {},
        expectMinItems: 1,
        expectLlmUsed: false,
    },
    {
        name: 'zomato-reviews (irrelevant JSON-LD present, correctly falls through to hydration)',
        url: 'https://www.zomato.com/mumbai/british-brewing-company-lower-parel/reviews',
        schema: { author: 'string', text: 'string', rating: 'number' },
        options: {},
        expectMinItems: 1,
        expectStrategy: 'hydration',
    },
    {
        name: 'digitalocean-tutorials (Next.js __NEXT_DATA__ hydration, different domain)',
        url: 'https://www.digitalocean.com/community/tutorials',
        schema: { title: 'string', url: 'string' },
        options: { instructions: 'Extract tutorial/article entries from the page data.' },
        expectMinItems: 1,
    },
    {
        name: 'example.com (plain SSR, no structure at all — text tier, single entity)',
        url: 'https://example.com/',
        schema: { title: 'string', purpose: 'string' },
        options: {},
        expectMinItems: 1,
    },
    {
        name: 'books-toscrape (e-commerce product page, no JSON-LD)',
        url: 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html',
        schema: { title: 'string', price: 'string', availability: 'string' },
        options: {},
        expectMinItems: 1,
    },
    {
        name: 'quotes-toscrape (text/article-shaped content, list of items)',
        url: 'https://quotes.toscrape.com/',
        schema: { quote: 'string', author: 'string' },
        options: {},
        expectMinItems: 1,
    },
    {
        name: 'honest-failure (schema asks for data the page does not have)',
        url: 'https://example.com/',
        schema: { productSku: 'string', warehouseLocation: 'string', supplierContactEmail: 'string' },
        options: {},
        expectMinItems: 0,   // correct behavior IS zero items — see run.js's isHonestFailureCase handling
        isHonestFailureCase: true,
    },
    {
        name: 'spa-shell (requires browser rendering — local fixture + real Playwright)',
        schema: { name: 'string', price: 'string', rating: 'number' },
        options: {},
        expectMinItems: 1,
        needsLocalServer: true,
        localFixture: 'spa-product.html',
        expectBrowserUsed: true,
    },
    {
        // Real result measured 2026-08-20: strategy=json-ld, llmUsed=false,
        // confidence=0.95, fully valid — see docs/benchmarks.md. The
        // Organization block lives inside `@graph`, not as a top-level
        // @type, which findByType already flattens correctly.
        name: 'atomberg-homepage (Organization JSON-LD nested inside @graph, no LLM)',
        url: 'https://atomberg.com/',
        schema: { name: 'string', url: 'string', email: 'string', description: 'string' },
        options: { jsonLdType: 'Organization' },
        expectMinItems: 1,
        expectLlmUsed: false,
    },
    {
        // Classification verified 2026-08-20 (no JSON-LD, real __NEXT_DATA__
        // hydration state detected, correctly routes to the hydration+LLM
        // tier) — but the LLM step itself has NOT been run against this case
        // (no NIM_API_KEY available at the time this entry was added). Run
        // this yourself with a real key before trusting its numbers in
        // docs/benchmarks.md; don't copy numbers from a case that was never
        // actually executed end-to-end.
        name: 'replit-homepage (Next.js __NEXT_DATA__ hydration, different domain/shape than digitalocean-tutorials)',
        url: 'https://replit.com/',
        schema: { title: 'string', description: 'string' },
        options: { instructions: 'Extract the page/site title and a short description from the page data.' },
        expectMinItems: 1,
        expectStrategy: 'hydration',
    },
];
