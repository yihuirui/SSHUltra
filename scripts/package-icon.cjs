const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
execFileSync('/usr/bin/swift', [path.join(__dirname, 'make-icon.swift'), root], { stdio: 'inherit', env: { ...process.env, CLANG_MODULE_CACHE_PATH: '/private/tmp/harbor-swift-module-cache' } });
const dir = path.join(root, 'assets', 'icon.iconset'); fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
  const output = path.join(dir, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
  execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), path.join(root, 'assets/icon.png'), '--out', output], { stdio: 'ignore' });
}
execFileSync('/usr/bin/iconutil', ['-c', 'icns', dir, '-o', path.join(root, 'assets/icon.icns')]);
console.log('Generated macOS application icon');
