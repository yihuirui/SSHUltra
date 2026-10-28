const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const activeFiles = new Set();

// Only received terminal output is recorded. Escape sequences are removed across chunks.
class SessionLog {
  constructor(directory, profile, onError, { maxBytes = 10 * 1024 * 1024, now = () => new Date(), onClosed = () => {} } = {}) {
    this.directory = directory; this.profile = profile; this.onError = onError;
    this.maxBytes = maxBytes; this.now = now; this.decoder = new StringDecoder('utf8');
    this.escape = ''; this.atLineStart = true; this.bytes = 0; this.stream = null; this.closed = false;
    this.pending = new Set(); this.onClosed = onClosed;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(directory).isSymbolicLink() || !fs.lstatSync(directory).isDirectory()) throw new Error('日志目录必须为本机真实目录');
    this.prefix = `sshultra-${createHash('sha256').update(profile.id).digest('hex').slice(0, 16)}-`;
    // Explicit per-profile opt-in; never remove another profile's or an active log.
    if ([7, 30, 90].includes(profile.logRetentionDays)) {
      const cutoff = this.now().getTime() - profile.logRetentionDays * 86400000;
      for (const name of fs.readdirSync(directory)) {
        if (!name.startsWith(this.prefix) || !/^\d{4}-\d{2}-\d{2}-[a-f0-9-]{36}\.log$/.test(name.slice(this.prefix.length))) continue;
        const file = path.join(directory, name); const stat = fs.lstatSync(file);
        if (stat.isFile() && !stat.isSymbolicLink() && !activeFiles.has(file) && stat.mtimeMs < cutoff) fs.unlinkSync(file);
      }
    }
    this.rotate();
    this.record(`[会话开始 ${profile.name} ${profile.username}@${profile.host}:${profile.port}]\n`);
  }
  rotate() {
    this.stream?.end();
    const stamp = this.now().toISOString(); this.day = stamp.slice(0, 10);
    this.file = path.join(this.directory, `${this.prefix}${this.day}-${randomUUID()}.log`);
    const file = this.file;
    const fd = fs.openSync(this.file, 'wx', 0o600);
    const stream = fs.createWriteStream(this.file, { fd, autoClose: true });
    this.stream = stream; this.pending.add(stream); this.bytes = 0; activeFiles.add(file);
    stream.once('close', () => { this.pending.delete(stream); activeFiles.delete(file); if (this.closed && !this.pending.size) this.onClosed(); });
    stream.on('error', () => this.fail());
  }
  fail() {
    if (this.closed) return;
    this.closed = true; this.stream?.destroy();
    this.onError('持续日志写入失败，已停止记录。请检查磁盘空间和日志目录。');
  }
  clean(text) {
    let result = '';
    for (const ch of text) {
      if (this.escape === 'esc') { this.escape = ch === '[' ? 'csi' : ch === ']' ? 'osc' : ''; continue; }
      if (this.escape === 'csi') { if (/[\x40-\x7e]/.test(ch)) this.escape = ''; continue; }
      if (this.escape === 'osc') { if (ch === '\x07') this.escape = ''; else if (ch === '\x1b') this.escape = 'osc-end'; continue; }
      if (this.escape === 'osc-end') { this.escape = ch === '\\' ? '' : 'osc'; continue; }
      if (ch === '\x1b') { this.escape = 'esc'; continue; }
      if (ch === '\n' || ch === '\t' || ch >= ' ' && ch !== '\x7f') result += ch;
    }
    return result;
  }
  record(text) {
    if (this.closed) return;
    try {
      let output = '';
      for (const ch of text) {
        if (this.atLineStart) { output += `[${this.now().toISOString()}] `; this.atLineStart = false; }
        output += ch; if (ch === '\n') this.atLineStart = true;
      }
      if (this.day !== this.now().toISOString().slice(0, 10) || this.bytes + Buffer.byteLength(output) > this.maxBytes) this.rotate();
      if (this.stream.writableLength + Buffer.byteLength(output) > 2 * 1024 * 1024) { this.fail(); return; }
      this.bytes += Buffer.byteLength(output); this.stream.write(output);
    } catch { this.fail(); }
  }
  write(buffer) { this.record(this.clean(this.decoder.write(buffer))); }
  close() {
    if (this.closed) return;
    this.record(this.clean(this.decoder.end())); this.record('\n[会话结束]\n');
    this.closed = true; this.stream.end();
  }
  async flush() {
    await Promise.all([...this.pending].map(s => s.closed ? Promise.resolve() : new Promise(resolve => s.once('close', resolve))));
  }
}
module.exports = { SessionLog };
