import test from 'node:test';
import assert from 'node:assert/strict';
import { versionImports, versionHtml } from '../scripts/cacheBust.mjs';

test('cache bust: relative module imports get the version, bare ones are left for the import map', () => {
  const src = [
    "import * as THREE from 'three';",
    "import { CONFIG } from './config.js';",
    'import { feel } from "../feel.js";',
    "export { react } from '../../characters.js';",
    "import './side-effect.js';",
    "const m = await import('./games/golf/game.js');",
    "import { World } from 'cannon-es';",
  ].join('\n');
  const out = versionImports(src, 'abc123');
  assert.match(out, /from '\.\/config\.js\?v=abc123'/);
  assert.match(out, /from "\.\.\/feel\.js\?v=abc123"/);
  assert.match(out, /from '\.\.\/\.\.\/characters\.js\?v=abc123'/);
  assert.match(out, /import '\.\/side-effect\.js\?v=abc123'/);
  assert.match(out, /import\('\.\/games\/golf\/game\.js\?v=abc123'\)/);
  assert.match(out, /from 'three';/);
  assert.match(out, /from 'cannon-es';/);
  assert.equal(versionImports(out, 'abc123'), out, 'already versioned specifiers are left alone');
});

test('cache bust: page scripts, stylesheets and import-map entries get the version; external URLs do not', () => {
  const html = `<link rel="icon" href="data:image/svg+xml,<svg/>" />
    <link rel="stylesheet" href="css/game.css" />
    <script type="importmap">
      { "imports": { "three": "./vendor/three/three.module.js", "cannon-es": "./vendor/cannon-es/cannon-es.js" } }
    </script>
    <script src="https://cdn.example.com/x.js"></script>
    <script src="vendor/peerjs/peerjs.min.js"></script>
    <script type="module" src="js/main.js"></script>`;
  const out = versionHtml(html, 'v9');
  assert.match(out, /href="css\/game\.css\?v=v9"/);
  assert.match(out, /"three": "\.\/vendor\/three\/three\.module\.js\?v=v9"/);
  assert.match(out, /"cannon-es": "\.\/vendor\/cannon-es\/cannon-es\.js\?v=v9"/);
  assert.match(out, /src="vendor\/peerjs\/peerjs\.min\.js\?v=v9"/);
  assert.match(out, /src="js\/main\.js\?v=v9"/);
  assert.match(out, /src="https:\/\/cdn\.example\.com\/x\.js"/);
  assert.match(out, /href="data:image\/svg\+xml,<svg\/>"/);
  assert.match(out, /"imports":/, 'the import map keys are untouched');
});
