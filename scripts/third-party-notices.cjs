// Preserve the full notices for installed runtime packages and bundled renderer code.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const lock = require(path.join(root, 'package-lock.json'));
const sections = ['SSHUltra third-party notices\n\nOriginal application code is MIT licensed; third-party components retain their own licenses.\nElectron and Chromium notices also ship alongside the application framework.\n'];
let count = 0;
for (const [relative, metadata] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!relative || metadata.dev) continue;
  const directory = path.join(root, relative);
  if (!fs.existsSync(directory)) {
    if (metadata.optional) continue;
    throw new Error(`Missing runtime dependency: ${relative}`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const files = fs.readdirSync(directory).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name) && fs.statSync(path.join(directory, name)).isFile());
  if (!files.length) throw new Error(`Missing license notice: ${pkg.name}`);
  sections.push(`\n${'='.repeat(72)}\n${pkg.name}@${pkg.version}\n${pkg.homepage || ''}\n`);
  for (const file of files.sort()) sections.push(`\n--- ${file} ---\n${fs.readFileSync(path.join(directory, file), 'utf8')}`);
  if (pkg.name === 'cpu-features') {
    sections.push('\n--- bundled cpu_features LICENSE ---\n' + fs.readFileSync(path.join(directory, 'deps/cpu_features/LICENSE'), 'utf8'));
  }
  count++;
}
const electron = require(path.join(root, 'node_modules/electron/package.json'));
sections.push(`\n${'='.repeat(72)}\nElectron ${electron.version}\nhttps://www.electronjs.org\n\n` + fs.readFileSync(path.join(root, 'node_modules/electron/LICENSE'), 'utf8'));
sections.push('\nChromium and other Electron runtime third-party notices are in LICENSES.chromium.html shipped with Electron.\n');
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), sections.join('\n'));
console.log(`Preserved full notices for ${count} runtime dependencies and Electron.`);
