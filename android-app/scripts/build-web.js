// Copies the web app into www/ for the Android build. The service worker is
// left out: the app ships inside the APK, so it's already offline.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), OUT = path.resolve(__dirname, '../www');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const skip = new Set(['sw.js']);
for (const f of fs.readdirSync(ROOT)) {
  if (skip.has(f)) continue;
  if (/\.(html|js|svg|webmanifest)$/.test(f)) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
}
for (const dir of ['icons', 'vendor']) fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });
// Capacitor's runtime goes in front of the app's own scripts.
fs.copyFileSync(require.resolve('@capacitor/core/dist/capacitor.js', { paths: [path.resolve(__dirname, '..')] }), path.join(OUT, 'capacitor.js'));
const idx = path.join(OUT, 'index.html');
fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace('<script src="./native.js', '<script src="./capacitor.js"></script><script src="./native.js'));
// Health Connect shows this when someone taps "Privacy policy" in its permission screen.
fs.copyFileSync(path.join(ROOT, 'privacy.html'), path.join(OUT, 'privacypolicy.html'));
console.log('Web app copied to', OUT);
