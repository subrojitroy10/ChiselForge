// Starter benchmark corpus — real, live, publicly-accessible pages.
//
// NOT the full diverse corpus a mature benchmark should have (no Next.js
// hydration example, no SPA/browser-required example, no e-commerce/article
// examples yet — see BENCHMARKS.md's "Known gaps" for the honest list of
// what's not measured yet). This is a starting point, expand it over time
// rather than trusting these three cases to represent the whole web.

module.exports = [
    {
        name: 'zomato-reviews (hydration tier)',
        url: 'https://www.zomato.com/mumbai/british-brewing-company-lower-parel/reviews',
        schema: { author: 'string', text: 'string', rating: 'number' },
        options: { jsonLdType: 'Review' },
        expectMinItems: 1,
    },
    {
        name: 'zomato-restaurant-metadata (json-ld tier)',
        url: 'https://www.zomato.com/mumbai/british-brewing-company-lower-parel/reviews',
        schema: { name: 'string', telephone: 'string', servesCuisine: 'string' },
        options: { jsonLdType: 'Restaurant' },
        expectMinItems: 1,
    },
    {
        name: 'example.com (plain text, no structure — text tier)',
        url: 'https://example.com/',
        schema: { title: 'string', purpose: 'string' },
        options: {},
        expectMinItems: 1,
    },
];
