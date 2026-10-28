const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const MACHO = new Set(['cefaedfe', 'cffaedfe', 'feedface', 'feedfacf', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);

function verifyMacArchitecture(directory, expected) {
  if (!['x64', 'arm64'].includes(expected)) throw new Error('目标架构应为 x64 或 arm64');
  if (process.platform !== 'darwin') throw new Error('macOS 架构验证需要 macOS 的 lipo');
  const wanted = expected === 'x64' ? 'x86_64' : 'arm64';
  const binaries = [];
  function visit(file) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) { for (const name of fs.readdirSync(file)) visit(path.join(file, name)); return; }
    if (!stat.isFile() || stat.size < 4) return;
    const fd = fs.openSync(file, 'r'); const head = Buffer.alloc(4);
    try { fs.readSync(fd, head, 0, 4, 0); } finally { fs.closeSync(fd); }
    if (!MACHO.has(head.toString('hex'))) return;
    const architectures = execFileSync('/usr/bin/lipo', ['-archs', file], { encoding: 'utf8' }).trim().split(/\s+/);
    if (!architectures.includes(wanted)) throw new Error(`架构不匹配：${path.relative(directory, file)} 实际为 ${architectures.join(', ')}，目标为 ${wanted}。请安装对应架构的 Electron/原生依赖后重试。`);
    binaries.push({ file: path.relative(directory, file), architectures });
  }
  visit(directory);
  if (!binaries.length) throw new Error('没有找到可验证的 Mach-O 程序');
  return { expected, binaries };
}
if (require.main === module) {
  try { console.log(JSON.stringify(verifyMacArchitecture(process.argv[2], process.argv[3]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verifyMacArchitecture };
