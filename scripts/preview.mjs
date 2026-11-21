// Serve dist/ at http://localhost:8080/swingyard/ - the same path it has on kksolve.com.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const BASE = '/swingyard/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PORT = Number(process.env.PORT) || 8080;

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/swingyard') {
      res.writeHead(301, { Location: BASE });
      return res.end();
    }
    if (!url.pathname.startsWith(BASE)) {
      res.writeHead(404);
      return res.end('not found');
    }
    let file = path.join(DIST, decodeURIComponent(url.pathname.slice(BASE.length)));
    if (!file.startsWith(DIST)) {
      res.writeHead(403);
      return res.end();
    }
    if (file.endsWith(path.sep) || file === DIST) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Preview: http://localhost:${PORT}${BASE}`));
