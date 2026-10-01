#!/usr/bin/env node
'use strict';
/**
 * Static web server for the ArchGraph community site (website/build).
 *
 * Zero dependencies. Serves the prebuilt Docusaurus site under its baseUrl
 * (default /archgraph/) with SPA fallback, so a single deployment can bring up
 * both the Graph Store (/mcp, /graph/read) and the site on the same host.
 *
 * Env:
 *   GRAPH_STORE_WEB_ROOT   site root dir (default <pkg>/website/build)
 *   GRAPH_STORE_WEB_BASE   URL base path (default /archgraph/)
 *   GRAPH_STORE_WEB_HOST   bind host (default 0.0.0.0)
 *   GRAPH_STORE_WEB_PORT   port (default 18793)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PKG_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(process.env.GRAPH_STORE_WEB_ROOT || path.join(PKG_DIR, 'website', 'build'));
const BASE = `/${String(process.env.GRAPH_STORE_WEB_BASE || '/archgraph/').replace(/^\/+|\/+$/g, '')}/`;
const HOST = process.env.GRAPH_STORE_WEB_HOST || '0.0.0.0';
const PORT = Number(process.env.GRAPH_STORE_WEB_PORT || 18793);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8',
};

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let p = decodeURIComponent(url.pathname);

  if (p === '/' || p === BASE.slice(0, -1)) {
    res.writeHead(302, { Location: BASE });
    return res.end();
  }
  if (!p.startsWith(BASE)) return send(res, 404, 'Not Found');

  const rel = p.slice(BASE.length);
  let file = path.join(ROOT, rel || 'index.html');
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

  if (!fs.existsSync(file)) {
    const htmlFallback = path.join(ROOT, rel ? `${rel}.html` : 'index.html');
    if (fs.existsSync(htmlFallback)) file = htmlFallback;
    else if (path.extname(rel) === '') file = path.join(ROOT, 'index.html'); // SPA fallback
    else return send(res, 404, 'Not Found');
  }
  try {
    const body = fs.readFileSync(file);
    send(res, 200, body, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  } catch {
    send(res, 500, 'Read error');
  }
});

server.listen(PORT, HOST, () => console.log(`[graph-store-web] serving ${ROOT} at http://${HOST}:${PORT}${BASE}`));
