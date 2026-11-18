import fs from 'fs';
import path from 'path';

const distDir = path.resolve('dist');
const assetsDir = path.join(distDir, 'assets');
const publicDir = path.resolve('public');

const indexHtmlPath = path.join(distDir, 'index.html');
let html = fs.readFileSync(indexHtmlPath, 'utf8');

// Read compiled CSS & exact entry JS from index.html
const assetFiles = fs.readdirSync(assetsDir);
const cssFile = assetFiles.find((f) => f.endsWith('.css'));
const scriptMatch = html.match(/src="\/assets\/([^"]+\.js)"/i);
const jsFile = scriptMatch
  ? scriptMatch[1]
  : assetFiles.find((f) => f.startsWith('index-') && f.endsWith('.js'));

const cssContent = cssFile ? fs.readFileSync(path.join(assetsDir, cssFile), 'utf8') : '';
let jsContent = jsFile ? fs.readFileSync(path.join(assetsDir, jsFile), 'utf8') : '';

// Use a lightweight SVG placeholder or external path for sample presets if needed
const iconSvgPath = path.join(publicDir, 'icon.svg');
const iconDataUrl = fs.existsSync(iconSvgPath)
  ? `data:image/svg+xml;base64,${fs.readFileSync(iconSvgPath).toString('base64')}`
  : '';

// Remove external script/stylesheet tags from dist/index.html
html = html.replace(/<link[^>]+rel="stylesheet"[^>]*>/gi, '');
html = html.replace(/<link[^>]+rel="manifest"[^>]*>/gi, '');
html = html.replace(/<script[^>]+src="\/assets\/[^"]+"[^>]*><\/script>/gi, '');
if (iconDataUrl) {
  html = html.split('href="/icon.svg"').join(`href="${iconDataUrl}"`);
}

// Replace import.meta with safe location fallback so the script runs cleanly as a classic script in WebView2 / about:blank
jsContent = jsContent.replaceAll('import.meta.url', 'window.location.href');
jsContent = jsContent.replaceAll('import.meta.resolve', 'undefined');
jsContent = jsContent.replace(/\bimport\.meta\b/g, '({ url: window.location.href })');

// Safely escape any closing script tags inside JS bundle
const safeJsContent = jsContent.split('</script>').join('<\\/script>');

// IMPORTANT: Use split().join() instead of String.prototype.replace() so "$&" / "$'" inside minified JS are never corrupted!
html = html.split('</head>').join(`  <style>${cssContent}</style>\n</head>`);
html = html
  .split('<div id="root"></div>')
  .join(`<div id="root"></div>\n  <script>\n${safeJsContent}\n</script>`);

const outPath = path.join(publicDir, 'Elegoo_CC2_Cost_Calculator_Offline.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log(
  'Created standalone offline app:',
  outPath,
  Math.round(fs.statSync(outPath).size / 1024) + ' KB'
);
