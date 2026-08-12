// Tiny static file server for benchmark fixtures that need to be fetched
// over real HTTP (not file://, since fetch()/Playwright behave differently
// against file:// URLs than real page loads) but shouldn't depend on any
// external site's uptime — used for the needsBrowser/SPA-shell case.

const http = require('http');
const fs = require('fs');
const path = require('path');

function startLocalServer(fixturesDir, port = 0) {
    const server = http.createServer((req, res) => {
        const filePath = path.join(fixturesDir, req.url === '/' ? 'index.html' : req.url);
        fs.readFile(filePath, (err, data) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    });

    return new Promise(resolve => {
        server.listen(port, '127.0.0.1', () => {
            const actualPort = server.address().port;
            resolve({
                url: fixtureName => `http://127.0.0.1:${actualPort}/${fixtureName}`,
                close: () => new Promise(r => server.close(r)),
            });
        });
    });
}

module.exports = { startLocalServer };
