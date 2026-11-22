// Cache busting for the static site. GitHub Pages tells browsers to keep every file for 10 minutes, and
// a plain reload re-fetches the page but not the ~30 JavaScript modules it imports, so a new deploy could
// run against stale modules for a while (or a mix of old and new ones). The build stamps the deploy's
// version onto every local file the pages load, so each deploy has fresh URLs and one reload gets it all.
// Pure functions (unit tested).

const LOCAL = /^(?!(?:[a-z]+:|\/\/|#|data:))/i; // not http:, https:, data:, //host, #anchor

/** Add ?v= to relative module specifiers: `from './x.js'`, `import './x.js'`, `import('./x.js')`, `export … from`. */
export function versionImports(code, v) {
  return code.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+?\.m?js)\2/g, (m, pre, q, spec) => `${pre}${q}${spec}?v=${v}${q}`);
}

/** Add ?v= to the page's own scripts, stylesheets and import-map entries (leaves external URLs alone). */
export function versionHtml(html, v) {
  let out = html.replace(/\b(src|href)=(['"])([^'"?]+\.(?:m?js|css))\2/g, (m, attr, q, url) => (LOCAL.test(url) ? `${attr}=${q}${url}?v=${v}${q}` : m));
  // Import map values: "three": "./vendor/three/three.module.js"
  out = out.replace(/<script type="importmap">([\s\S]*?)<\/script>/, (m, body) => {
    const map = body.replace(/(:\s*)(['"])(\.{0,2}\/?[^'"?:]+\.m?js)\2/g, (mm, pre, q, url) => (LOCAL.test(url) ? `${pre}${q}${url}?v=${v}${q}` : mm));
    return `<script type="importmap">${map}</script>`;
  });
  return out;
}
