// Official binary fallback for environments where Node's downloader cannot use the network proxy.
// Downloads from GitHub, verifies the checksum shipped by the electron npm package, then extracts.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const electronDir = path.dirname(require.resolve('electron/package.json'));
const { version } = require(path.join(electronDir, 'package.json'));
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This fallback targets macOS ARM64 only');
const name = `electron-v${version}-darwin-arm64.zip`;
const expected = require(path.join(electronDir, 'checksums.json'))[name];
if (!expected) throw new Error('No trusted package checksum available');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-electron-'));
try {
  const zip = path.join(temp, name);
  execFileSync('/usr/bin/curl', ['--fail', '--location', '--silent', '--show-error', '--connect-timeout', '15', '--max-time', '240', '--output', zip, `https://github.com/electron/electron/releases/download/v${version}/${name}`], { stdio: 'inherit', timeout: 250000 });
  const actual = createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  if (actual !== expected) throw new Error('Electron download checksum mismatch');
  const dist = path.join(electronDir, 'dist'); fs.mkdirSync(dist, { recursive: true });
  execFileSync('/usr/bin/ditto', ['-x', '-k', zip, dist]);
  fs.writeFileSync(path.join(electronDir, 'path.txt'), 'Electron.app/Contents/MacOS/Electron');
  console.log(JSON.stringify({ version, sha256: actual, installed: true }));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
