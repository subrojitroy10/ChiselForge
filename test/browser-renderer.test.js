// Tests createBrowserRenderer()'s browser-restart bookkeeping (--bulk mode)
// using an injected fake launchBrowser, so this stays fast/deterministic and
// free of a real Playwright launch — same "stub instead of real browser"
// approach test/auto-browser-fallback.test.js already uses for
// renderWithBrowser itself. Real Playwright rendering IS exercised for real
// in benchmark/run.js (see docs/benchmarks.md) — this test is about the restart
// counting logic, not proving Playwright itself works.
//
// Context (not tested here, no code path exists for it): BrowserRuntime in
// this same module implements a different pattern — one persistent page
// reused across jobs, with periodic context recycling — generalized from
// the Google-places scraper. createBrowserRenderer instead opens a fresh
// page per call and closes it immediately, which already creates an
// isolated ephemeral Playwright context that closes with the page — so only
// the full browser-process restart (this test) is a real gap here.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createBrowserRenderer } = require('../transports/browser');

// A fake "browser" whose only job is to record how many times it was asked
// to open a page and whether it was closed — enough to prove the restart
// bookkeeping without any real browser process.
function fakeLaunchBrowser(launchLog) {
    return async () => {
        const instance = { id: launchLog.length, closed: false, pagesOpened: 0 };
        launchLog.push(instance);
        return {
            newPage: async () => {
                instance.pagesOpened++;
                return {
                    goto: async () => {},
                    waitForTimeout: async () => {},
                    content: async () => `<html><body>page from browser ${instance.id}</body></html>`,
                    close: async () => {},
                };
            },
            close: async () => { instance.closed = true; },
        };
    };
}

test('reuses the same browser instance across calls when browserRestartEvery is not set (default)', async () => {
    const launchLog = [];
    const renderer = createBrowserRenderer({ launchBrowser: fakeLaunchBrowser(launchLog) });

    await renderer.renderWithBrowser('https://example.com/1');
    await renderer.renderWithBrowser('https://example.com/2');
    await renderer.renderWithBrowser('https://example.com/3');

    assert.equal(launchLog.length, 1, 'only one browser should ever be launched with no restart interval set');
    assert.equal(launchLog[0].pagesOpened, 3);
    assert.equal(launchLog[0].closed, false, 'not closed until renderer.close() is called');

    await renderer.close();
    assert.equal(launchLog[0].closed, true);
});

test('restarts the browser process every N renders when browserRestartEvery is set', async () => {
    const launchLog = [];
    const renderer = createBrowserRenderer({
        launchBrowser: fakeLaunchBrowser(launchLog),
        browserRestartEvery: 2,
    });

    await renderer.renderWithBrowser('https://example.com/1'); // browser #0, render 1
    await renderer.renderWithBrowser('https://example.com/2'); // browser #0, render 2
    await renderer.renderWithBrowser('https://example.com/3'); // restart -> browser #1, render 1
    await renderer.renderWithBrowser('https://example.com/4'); // browser #1, render 2
    await renderer.renderWithBrowser('https://example.com/5'); // restart -> browser #2, render 1

    assert.equal(launchLog.length, 3, 'should have restarted twice (3 browsers total) for 5 renders at every-2 cadence');
    assert.equal(launchLog[0].closed, true, 'the first browser should have been closed on restart');
    assert.equal(launchLog[1].closed, true, 'the second browser should have been closed on restart');
    assert.equal(launchLog[2].closed, false, 'the third (current) browser should still be open');
    assert.equal(launchLog[0].pagesOpened, 2);
    assert.equal(launchLog[1].pagesOpened, 2);
    assert.equal(launchLog[2].pagesOpened, 1);

    await renderer.close();
    assert.equal(launchLog[2].closed, true);
});

test('does not restart before browserRestartEvery renders have actually happened', async () => {
    const launchLog = [];
    const renderer = createBrowserRenderer({
        launchBrowser: fakeLaunchBrowser(launchLog),
        browserRestartEvery: 10,
    });

    await renderer.renderWithBrowser('https://example.com/1');
    await renderer.renderWithBrowser('https://example.com/2');
    await renderer.renderWithBrowser('https://example.com/3');

    assert.equal(launchLog.length, 1, 'well under the restart threshold, should still be the same browser');
});
