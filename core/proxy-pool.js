// Proxy pool loading + rotation.
//
// Source: merges Google/proxy.js (loadProxies/parseProxy — Playwright-shaped
// output, never actually wired into a worker) and Magic Pin/pipelines/upper/
// worker.js's inline PROXY_POOL loader (URL-string output, proven wired-in at
// scale: 100 Webshare datacenter IPs, 10 workers, 634 venues).
//
// IMPORTANT — no real proxy credentials ship with this repo. See
// proxies.example.txt for the expected file format. Proxies are opt-in: the
// browser transport was proven to work at scale (11k venues, zero blocks)
// WITHOUT proxies. Only wire this in if your target actually needs it.
//
// File format, one proxy per line: host:port:username:password

const fs = require('fs');

function loadProxyLines(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Proxy file not found: ${filePath}`);
    }

    const lines = fs.readFileSync(filePath, 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    if (!lines.length) {
        throw new Error(`Proxy file is empty: ${filePath}`);
    }

    return lines;
}

function parseProxyLine(line) {
    const parts = line.split(':');
    if (parts.length !== 4) {
        throw new Error(`Invalid proxy line (expected host:port:user:pass): ${line}`);
    }
    const [host, port, username, password] = parts;
    return { host, port, username, password };
}

// Shape Playwright's `proxy` launch/context option expects.
function toPlaywrightProxy({ host, port, username, password }, protocol = 'http') {
    return {
        server: `${protocol}://${host}:${port}`,
        username,
        password,
    };
}

// Shape a URL-based HTTP proxy agent (e.g. https-proxy-agent) expects.
function toProxyUrl({ host, port, username, password }, protocol = 'http') {
    return `${protocol}://${username}:${password}@${host}:${port}`;
}

class ProxyPool {
    constructor(filePath) {
        this.proxies = loadProxyLines(filePath).map(parseProxyLine);
    }

    random() {
        return this.proxies[Math.floor(Math.random() * this.proxies.length)];
    }

    randomPlaywrightProxy(protocol = 'http') {
        return toPlaywrightProxy(this.random(), protocol);
    }

    randomProxyUrl(protocol = 'http') {
        return toProxyUrl(this.random(), protocol);
    }

    size() {
        return this.proxies.length;
    }
}

module.exports = {
    ProxyPool,
    loadProxyLines,
    parseProxyLine,
    toPlaywrightProxy,
    toProxyUrl,
};
