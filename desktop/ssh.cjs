const { Client } = require('ssh2');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { validateProfile } = require('./store.cjs');

const MAX_SESSIONS = 12;
const MAX_INPUT_PENDING_BYTES = 256 * 1024;
const DEFAULT_SHELL_TIMEOUT_MS = 10000;
function remotePath(value) {
  if (typeof value !== 'string' || !value || value.length > 8192 || value.includes('\0')) throw new Error('远程路径无效');
  return value;
}
function size(value, fallback, max) { return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback; }
class SSHManager {
  constructor({ store, emit, confirmHost, shellTimeoutMs = DEFAULT_SHELL_TIMEOUT_MS }) {
    this.store = store;
    this.emit = emit;
    this.confirmHost = confirmHost;
    this.shellTimeoutMs = Number.isInteger(shellTimeoutMs) && shellTimeoutMs > 0 ? shellTimeoutMs : DEFAULT_SHELL_TIMEOUT_MS;
    this.sessions = new Map();
  }
  async connect(id, raw, credentials = {}, geometry = {}) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id) || this.sessions.has(id)) throw new Error('会话 ID 无效或重复');
    if (this.sessions.size >= MAX_SESSIONS) throw new Error(`每个窗口最多 ${MAX_SESSIONS} 个会话`);
    const profile = validateProfile(raw);
    const client = new Client();
    const session = { id, client, profile, channel: null, sftp: null, pending: 0, inputPendingBytes: 0, inputBackpressured: false, connectStarted: false, closed: false, errorReported: false, transfers: new Set() };
    this.sessions.set(id, session);
    this.emit({ type: 'status', id, status: 'connecting' });
    let hostError = '';
    try {
      const config = { host: profile.host, port: profile.port, username: profile.username,
        readyTimeout: 20000, keepaliveInterval: 15000, keepaliveCountMax: 3,
        hostVerifier: (key, callback) => {
          const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
          const previous = this.store.fingerprint(profile.host, profile.port);
          if (previous) {
            if (previous !== fingerprint) hostError = `主机密钥已变化，连接已阻止。请向管理员核实 ${profile.host}:${profile.port} 的指纹。新指纹：${fingerprint}`;
            callback(previous === fingerprint && !session.closed);
            return;
          }
          Promise.resolve(this.confirmHost({ id, host: profile.host, port: profile.port, fingerprint })).then(accepted => {
            if (!accepted || session.closed) { hostError = '未信任该主机，连接已取消'; callback(false); return; }
            // Recheck after the dialog: another session may have established trust meanwhile.
            const current = this.store.fingerprint(profile.host, profile.port);
            if (current && current !== fingerprint) { hostError = '主机密钥与已保存的指纹不一致'; callback(false); return; }
            this.store.trust(profile.host, profile.port, fingerprint);
            callback(true);
          }).catch(() => { hostError = '无法保存主机信任信息'; callback(false); });
        }
      };
      if (profile.authType === 'password') {
        if (typeof credentials.password !== 'string' || credentials.password.length > 16384) throw new Error('请输入密码');
        config.password = credentials.password;
      } else if (profile.authType === 'key') {
        if (!profile.keyPath) throw new Error('请选择私钥文件');
        const stat = fs.statSync(profile.keyPath);
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('私钥文件无效或超过 1 MB');
        config.privateKey = fs.readFileSync(profile.keyPath);
        if (credentials.passphrase) config.passphrase = credentials.passphrase;
      } else {
        if (!process.env.SSH_AUTH_SOCK) throw new Error('没有可用的 SSH Agent，请选择密码或私钥登录');
        config.agent = process.env.SSH_AUTH_SOCK;
      }
      await new Promise((resolve, reject) => {
        let settled = false;
        let shellTimer;
        const clearShellTimer = () => {
          if (shellTimer) { clearTimeout(shellTimer); shellTimer = null; }
        };
        const fail = error => {
          const message = hostError || error.message || 'SSH 连接失败';
          clearShellTimer();
          if (!settled) { settled = true; session.errorReported = true; reject(new Error(message)); }
          else if (!session.closed && this.sessions.get(id) === session) {
            session.errorReported = true;
            this.emit({ type: 'status', id, status: 'error', message });
          }
        };
        client.on('error', fail);
        client.on('close', () => {
          clearShellTimer();
          if (!settled) { settled = true; session.errorReported = true; reject(new Error(hostError || 'SSH 连接已关闭')); }
          this.finish(session);
        });
        client.on('ready', () => {
          if (session.closed) { client.end(); return; }
          shellTimer = setTimeout(() => {
            fail(new Error('远程 shell 请求超时，请检查服务器后重试'));
            this.closeSession(session);
          }, this.shellTimeoutMs);
          shellTimer.unref?.();
          try {
            client.shell({ term: 'xterm-256color', cols: size(geometry.cols, 100, 500), rows: size(geometry.rows, 30, 300) }, (error, channel) => {
              clearShellTimer();
              if (settled || session.closed) { channel?.close(); return; }
              if (error) { fail(error); client.end(); return; }
              session.channel = channel;
              const output = chunk => {
                const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                session.pending += data.length;
                this.emit({ type: 'data', id, data: data.toString('base64'), bytes: data.length });
                if (session.pending > 512 * 1024) { channel.pause(); channel.stderr.pause(); }
              };
              channel.on('data', output);
              channel.stderr.on('data', output);
              channel.on('error', fail);
              channel.on('close', () => this.closeSession(session));
              this.emit({ type: 'status', id, status: 'connected' });
              settled = true;
              resolve();
            });
          } catch (error) {
            clearShellTimer();
            fail(error);
            this.closeSession(session);
          }
        });
        try {
          session.connectStarted = true;
          client.connect(config);
        } catch (error) {
          session.connectStarted = false;
          reject(error);
        }
      });
      return { id };
    } catch (error) {
      session.errorReported = true;
      if (this.sessions.get(id) === session) this.emit({ type: 'status', id, status: 'error', message: error.message });
      this.closeSession(session);
      // Preflight validation can fail before a socket or close listener exists.
      // No transport was started, so release its reserved ID synchronously.
      if (!session.connectStarted) this.finish(session);
      throw error;
    }
  }
  markClosed(session) {
    if (session.closed) return;
    session.closed = true;
    for (const transfer of session.transfers) transfer.abort();
  }
  finish(session) {
    this.markClosed(session);
    if (this.sessions.get(session.id) === session) {
      this.sessions.delete(session.id);
      if (!session.errorReported) this.emit({ type: 'status', id: session.id, status: 'disconnected' });
    }
  }
  disconnect(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.closeSession(session);
  }
  closeSession(session) {
    this.markClosed(session);
    session.channel?.close();
    session.client.destroy();
  }
  closeAll() { for (const id of [...this.sessions.keys()]) this.disconnect(id); }
  get(id) {
    const s = this.sessions.get(id);
    if (!s || s.closed || !s.channel || s.channel.destroyed) throw new Error('会话尚未连接或已经断开');
    return s;
  }
  write(id, data) {
    if (typeof data !== 'string') throw new Error('终端输入无效');
    const bytes = Buffer.byteLength(data);
    if (bytes > 65536) throw new Error('单次终端输入不能超过 65536 bytes');
    if (bytes === 0) return Promise.resolve();
    const session = this.get(id);
    if (session.inputBackpressured) throw new Error('终端输入通道繁忙，请稍后重试');
    if (session.inputPendingBytes + bytes > MAX_INPUT_PENDING_BYTES) throw new Error('终端输入积压过多，请稍后重试');
    session.inputPendingBytes += bytes;
    return new Promise((resolve, reject) => {
      let completed = false;
      const complete = error => {
        if (completed) return;
        completed = true;
        session.inputPendingBytes = Math.max(0, session.inputPendingBytes - bytes);
        if (error) reject(new Error(`终端输入写入失败：${error.message || 'SSH 通道已关闭'}`));
        else resolve();
      };
      try {
        const channel = session.channel;
        const writable = channel.write(data, complete);
        if (!writable) {
          session.inputBackpressured = true;
          channel.once('drain', () => {
            if (session.channel === channel) session.inputBackpressured = false;
          });
        }
      }
      catch (error) { complete(error); }
    });
  }
  batch(ids, command) {
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_SESSIONS || new Set(ids).size !== ids.length) throw new Error('请选择有效且不重复的目标会话');
    if (typeof command !== 'string' || !command.trim() || command.length > 16384 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(command)) throw new Error('命令为空、过长或包含控制字符');
    const sessions = ids.map(id => this.get(id)); // Validate every target before writing to any channel.
    const payload = command.replace(/\r\n|\r|\n/g, '\r').replace(/\r+$/, '') + '\r';
    return sessions.map(s => {
      try { s.channel.write(payload); return { id: s.id, sent: true }; }
      catch (error) { return { id: s.id, sent: false, message: error.message }; }
    });
  }
  resize(id, cols, rows) { const s = this.sessions.get(id); s?.channel?.setWindow(size(rows, 30, 300), size(cols, 100, 500), 0, 0); }
  ack(id, bytes) {
    const s = this.sessions.get(id);
    if (!s || !Number.isInteger(bytes) || bytes < 0 || bytes > 2 * 1024 * 1024) return;
    s.pending = Math.max(0, s.pending - bytes);
    if (s.pending < 128 * 1024) { s.channel?.resume(); s.channel?.stderr.resume(); }
  }
  async sftp(id) {
    const s = this.get(id);
    if (!s.sftp) s.sftp = new Promise((resolve, reject) => s.client.sftp((error, ftp) => error ? reject(error) : resolve(ftp))).catch(error => { s.sftp = null; throw error; });
    return s.sftp;
  }
  async list(id, directory = '.') {
    const ftp = await this.sftp(id);
    const canonical = await new Promise((resolve, reject) => ftp.realpath(remotePath(directory), (error, result) => error ? reject(error) : resolve(result)));
    const entries = await new Promise((resolve, reject) => ftp.readdir(canonical, (error, result) => error ? reject(error) : resolve(result)));
    return { path: canonical, entries: entries.filter(e => e.filename !== '.' && e.filename !== '..').map(e => ({
      name: e.filename, directory: e.attrs.isDirectory(), symlink: e.attrs.isSymbolicLink(), size: e.attrs.size, modified: e.attrs.mtime, mode: e.attrs.mode
    })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)) };
  }
  async transfer(id, direction, local, remote, transferId) {
    const s = this.get(id);
    const ftp = await this.sftp(id);
    remotePath(remote);
    const abort = new AbortController();
    s.transfers.add(abort);
    let partial;
    let transferred = 0;
    let last = 0;
    try {
      let source, destination;
      if (direction === 'upload') {
        const stat = fs.statSync(local);
        if (!stat.isFile()) throw new Error('首版仅支持上传文件');
        source = fs.createReadStream(local);
        // Exclusive creation avoids accidentally replacing an existing remote file.
        destination = ftp.createWriteStream(remote, { flags: 'wx', mode: 0o600 });
      } else if (direction === 'download') {
        partial = `${local}.harbor-${transferId}.part`;
        source = ftp.createReadStream(remote);
        destination = fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 });
      } else throw new Error('传输方向无效');
      source.on('data', chunk => {
        transferred += chunk.length;
        if (Date.now() - last > 150) {
          last = Date.now();
          this.emit({ type: 'transfer', id, transferId, direction, name: path.basename(local), bytes: transferred, status: 'running' });
        }
      });
      await pipeline(source, destination, { signal: abort.signal });
      if (partial) fs.renameSync(partial, local);
      this.emit({ type: 'transfer', id, transferId, direction, name: path.basename(local), bytes: transferred, status: 'done' });
      return { bytes: transferred };
    } catch (error) {
      if (partial) { try { fs.unlinkSync(partial); } catch {} }
      this.emit({ type: 'transfer', id, transferId, direction, name: path.basename(local), bytes: transferred, status: 'error', message: error.message });
      throw error;
    } finally { s.transfers.delete(abort); }
  }
}
module.exports = { SSHManager, remotePath };
