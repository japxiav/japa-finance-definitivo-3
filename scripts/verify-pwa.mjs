import { readFileSync, existsSync } from 'node:fs';
const required = [
  'public/manifest.webmanifest',
  'public/sw.js',
  'public/icons/icon-192.png',
  'public/icons/icon-512.png',
  'public/apple-touch-icon.png',
  'public/favicon.png',
];
for (const file of required) {
  if (!existsSync(file)) throw new Error(`PWA asset missing: ${file}`);
}
const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
if (manifest.name !== 'Japa Finance') throw new Error('Unexpected PWA name');
if (manifest.display !== 'standalone') throw new Error('PWA must use standalone display');
if (manifest.start_url !== '/') throw new Error('PWA start_url must be /');
const html = readFileSync('index.html', 'utf8');
for (const token of ['manifest.webmanifest', 'apple-touch-icon', 'theme-color', 'viewport']) {
  if (!html.includes(token)) throw new Error(`index.html missing ${token}`);
}
console.log('✓ PWA manifest, icons, iPhone metadata, and service worker are present');
