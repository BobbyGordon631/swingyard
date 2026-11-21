// Builds the static site (for GitHub Pages / kksolve.com/swingyard) into dist/.
// The static site runs in "online mode": phones connect to the game screen over WebRTC with a
// room code, so no server of our own is needed. `npm start` still runs the LAN server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const nm = (p) => path.join(ROOT, 'node_modules', p);

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });

// The same /vendor paths the LAN server maps onto node_modules.
const vendor = {
  'vendor/three/three.module.js': nm('three/build/three.module.js'),
  'vendor/cannon-es/cannon-es.js': nm('cannon-es/dist/cannon-es.js'),
  'vendor/peerjs/peerjs.min.js': nm('peerjs/dist/peerjs.min.js'),
  'vendor/qrcode/qrcode.js': nm('qrcode-generator/qrcode.js'),
};
for (const [to, from] of Object.entries(vendor)) {
  const dest = path.join(DIST, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(from, dest);
}
// Strip source-map comments for maps we do not ship (avoids 404 noise in the console).
const pj = path.join(DIST, 'vendor/peerjs/peerjs.min.js');
fs.writeFileSync(pj, fs.readFileSync(pj, 'utf8').replace(/\n\/\/# sourceMappingURL=.*$/m, ''));
// Mark the pages as the online build so they skip probing for the LAN server.
for (const page of ['index.html', 'controller.html']) {
  const f = path.join(DIST, page);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('</head>', '    <meta name="swingyard-mode" content="online" />\n  </head>'));
}
// Serve files as-is (no Jekyll processing on GitHub Pages).
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

let files = 0;
let bytes = 0;
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else {
      files++;
      bytes += fs.statSync(p).size;
    }
  }
})(DIST);
console.log(`dist/ ready: ${files} files, ${(bytes / 1e6).toFixed(1)} MB`);
