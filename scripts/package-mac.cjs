const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verifyMacArchitecture } = require('./verify-mac-arch.cjs');

function packageMac(args = process.argv.slice(2)) {
  const arch = args.find(a => a.startsWith('--arch='))?.slice(7) || process.arch;
  if (args.some(a => !a.startsWith('--arch=') && !a.startsWith('--output='))) throw new Error('不支持的打包参数');
  const root = path.resolve(__dirname, '..');
  const output = path.resolve(root, args.find(a => a.startsWith('--output='))?.slice(9) || `release/${require('../package.json').version}`);
  const runtime = path.join(root, 'node_modules/electron/dist/Electron.app');
  // Fail before copying anything; a custom electronDist is not a cross-compiler.
  verifyMacArchitecture(runtime, arch);
  const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--mac', 'dir', `--${arch}`, '--publish', 'never', `--config.directories.output=${output}`], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`打包失败：${result.status}`);
  const app = path.join(output, arch === 'arm64' ? 'mac-arm64' : 'mac', 'SSHUltra.app');
  const checked = verifyMacArchitecture(app, arch);
  console.log(JSON.stringify({ app, arch, checkedBinaries: checked.binaries.length }));
  return app;
}
if (require.main === module) {
  try { packageMac(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { packageMac };
