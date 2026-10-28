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
  constructor({ store, emit, confirmHost, shellTimeoutMs = DEFAULT_SHELL_TIMEOUT_MS, requestAuth = async () => null, logFactory = null, sftpTimeoutMs = 15000, transferIdleTimeoutMs = 30000 }) {
    this.store = store;
    this.emit = emit;
    this.confirmHost = confirmHost;
    this.requestAuth = requestAuth; this.logFactory = logFactory; this.logs = new Set();
    this.shellTimeoutMs = Number.isInteger(shellTimeoutMs) && shellTimeoutMs > 0 ? shellTimeoutMs : DEFAULT_SHELL_TIMEOUT_MS;
    this.sftpTimeoutMs = Math.max(20, sftpTimeoutMs); this.transferIdleTimeoutMs = Math.max(20, transferIdleTimeoutMs);
    this.sessions = new Map();
  }
  connectionConfig(profile, credentials, session, setHostError) {
    const config = { host: profile.host, port: profile.port, username: profile.username,
        readyTimeout: 90000, tryKeyboard: true, keepaliveInterval: 15000, keepaliveCountMax: 3,
        hostVerifier: (key, callback) => {
          const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
          const previous = this.store.fingerprint(profile.host, profile.port);
          if (previous) {
            if (previous !== fingerprint) setHostError(`主机密钥已变化，连接已阻止。请向管理员核实 ${profile.host}:${profile.port} 的指纹。新指纹：${fingerprint}`);
            callback(previous === fingerprint && !session.closed);
            return;
          }
          Promise.resolve(this.confirmHost({ id: session.id, host: profile.host, port: profile.port, fingerprint })).then(accepted => {
            if (!accepted || session.closed) { setHostError('未信任该主机，连接已取消'); callback(false); return; }
            // Recheck after the dialog: another session may have established trust meanwhile.
            const current = this.store.fingerprint(profile.host, profile.port);
            if (current && current !== fingerprint) { setHostError('主机密钥与已保存的指纹不一致'); callback(false); return; }
            this.store.trust(profile.host, profile.port, fingerprint);
            callback(true);
          }).catch(() => { setHostError('无法保存主机信任信息'); callback(false); });
        }
      };
      if (profile.authType === 'password') {
        if (credentials.password !== undefined && (typeof credentials.password !== 'string' || credentials.password.length > 16384)) throw new Error('密码格式无效');
        if (credentials.password) config.password = credentials.password;
        else config.authHandler = this.deferredPassword(profile, session);
      } else if (profile.authType === 'key') {
        if (!profile.keyPath) throw new Error('请选择私钥文件');
        const stat = fs.statSync(profile.keyPath);
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('私钥文件无效或超过 1 MB');
        config.privateKey = fs.readFileSync(profile.keyPath);
        if (credentials.passphrase) config.passphrase = credentials.passphrase;
      } else if (profile.authType === 'agent') {
        if (!process.env.SSH_AUTH_SOCK) throw new Error('没有可用的 SSH Agent，请选择密码或私钥登录');
        config.agent = process.env.SSH_AUTH_SOCK;
      }
    return config;
  }
  deferredPassword(profile, session) {
    let triedNone = false, triedPassword = false, triedKeyboard = false;
    return (methods, _partial, next) => {
      if (session.closed) return false;
      if (!triedNone) { triedNone = true; return 'none'; }
      if (!triedPassword && methods?.includes('password')) {
        triedPassword = true;
        Promise.resolve().then(() => this.requestAuth({ id: session.id, host: profile.host,
          username: profile.username, port: profile.port, presentation: 'terminal',
          name: profile.id === session.profile.id ? '服务器密码' : '跳板机密码',
          instructions: '请输入本次连接的密码；输入不会发送到终端程序或保存。',
          prompts: [{ prompt: 'Password:', echo: false }] }))
          .then(answers => {
            if (session.closed) return;
            if (!Array.isArray(answers) || answers.length !== 1 || typeof answers[0] !== 'string' || !answers[0].length || answers[0].length > 16384) throw new Error('密码输入已取消或超时');
            next({ type: 'password', username: profile.username, password: answers[0] });
          }).catch(() => {
            if (session.closed) return;
            session.authError = '密码输入已取消或超时'; next(false);
          });
        return;
      }
      if (!triedKeyboard && methods?.includes('keyboard-interactive')) { triedKeyboard = true; return 'keyboard-interactive'; }
      return false;
    };
  }
  keyboard(client, session, profile) {
    client.on('keyboard-interactive', (name, instructions, _lang, prompts, finish) => {
      Promise.resolve(this.requestAuth({ id: session.id, host: profile.host, name, instructions, prompts }))
        .then(answers => {
          if (session.closed) return;
          if (!Array.isArray(answers) || answers.length !== prompts.length) throw new Error('交互认证已取消');
          finish(answers);
        }).catch(() => {
          if (session.closed) return;
          session.errorReported = true; session.authError = '交互认证已取消或超时';
          this.emit({ type: 'status', id: session.id, status: 'error', message: session.authError });
          this.closeSession(session);
        });
    });
  }
  async jumpSocket(session, profile, credentials, setHostError) {
    const jump = this.store.profiles().find(p => p.id === profile.jumpProfileId);
    if (!jump || jump.jumpProfileId || jump.id === profile.id) throw new Error('跳板连接不存在或不是单级连接');
    const client = new Client(); session.jump = client;
    this.keyboard(client, session, jump);
    const config = this.connectionConfig(jump, credentials.jump || {}, session, setHostError);
    await new Promise((resolve, reject) => {
      let ready = false;
      client.once('ready', () => { ready = true; resolve(); });
      client.on('error', error => { if (!ready) reject(new Error('跳板连接失败：' + error.message)); else this.closeSession(session); });
      client.once('close', () => { if (!ready) reject(new Error('跳板连接已关闭')); else this.closeSession(session); });
      client.connect(config);
    });
    if (session.closed) throw new Error('连接已取消');
    return new Promise((resolve, reject) => {
      const onClose = () => { clearTimeout(timer); reject(new Error('跳板连接已关闭')); };
      const timer = setTimeout(() => { client.removeListener('close', onClose); reject(new Error('跳板转发请求超时')); this.closeSession(session); }, 20000);
      client.once('close', onClose);
      client.forwardOut('127.0.0.1', 0, profile.host, profile.port, (error, stream) => {
        clearTimeout(timer); client.removeListener('close', onClose);
        if (session.closed) { stream?.destroy(); reject(new Error('连接已取消')); return; }
        if (error) reject(new Error('跳板转发被拒绝：' + error.message)); else resolve(stream);
      });
    });
  }
  setLogging(id, enabled) {
    const session = this.get(id);
    if (typeof enabled !== 'boolean') throw new Error('日志设置无效');
    if (!enabled) { if (session.log) { const log = session.log; log.close(); void log.flush().then(() => this.logs.delete(log)); } session.log = null; this.emit({ type: 'logging', id, enabled: false }); return; }
    if (session.log) return;
    if (!this.logFactory) throw new Error('日志存储不可用');
    session.log = this.logFactory(session.profile, message => {
      session.log = null; this.emit({ type: 'logging', id, enabled: false, message });
    });
    this.logs.add(session.log); this.emit({ type: 'logging', id, enabled: true });
  }
  async flushLogs() { await Promise.all([...this.logs].map(log => log.flush())); this.logs.clear(); }
  async connect(id, raw, credentials = {}, geometry = {}) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id) || this.sessions.has(id)) throw new Error('会话 ID 无效或重复');
    if (this.sessions.size >= MAX_SESSIONS) throw new Error(`每个窗口最多 ${MAX_SESSIONS} 个会话`);
    const profile = validateProfile(raw);
    const client = new Client();
    const session = { id, client, profile, channel: null, sftp: null, ftp: null, fileRequests: new Set(), pending: 0, inputPendingBytes: 0, inputBackpressured: false, connectStarted: false, closed: false, errorReported: false, transfers: new Set() };
    this.sessions.set(id, session);
    this.emit({ type: 'status', id, status: 'connecting' });
    let hostError = '';
    try {
      const config = this.connectionConfig(profile, credentials, session, message => { hostError = message; });
      this.keyboard(client, session, profile);
      if (profile.jumpProfileId) config.sock = await this.jumpSocket(session, profile, credentials, message => { hostError = message; });
      if (session.closed) throw new Error('连接已取消');
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
                session.log?.write(data);
                session.pending += data.length;
                this.emit({ type: 'data', id, data: data.toString('base64'), bytes: data.length });
                if (session.pending > 512 * 1024) { channel.pause(); channel.stderr.pause(); }
              };
              channel.on('data', output);
              channel.stderr.on('data', output);
              channel.on('error', fail);
              channel.on('close', () => this.closeSession(session));
              if (profile.logEnabled && this.logFactory) {
                try { this.setLogging(id, true); } catch { this.emit({ type: 'logging', id, enabled: false, message: '无法启动持续日志，请检查日志目录。' }); }
              }
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
      error.message = hostError || session.authError || error.message;
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
    if (session.log) { const log = session.log; log.close(); void log.flush().then(() => this.logs.delete(log)); } session.log = null;
    this.cancelFileRequests(session, new Error('SSH 会话已关闭，文件操作已取消'));
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
    session.jump?.destroy();
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
    return Promise.all(sessions.map(async s => {
      try { await this.write(s.id, payload); return { id: s.id, sent: true }; }
      catch (error) { return { id: s.id, sent: false, message: error.message }; }
    }));
  }
  resize(id, cols, rows) { const s = this.sessions.get(id); s?.channel?.setWindow(size(rows, 30, 300), size(cols, 100, 500), 0, 0); }
  ack(id, bytes) {
    const s = this.sessions.get(id);
    if (!s || !Number.isInteger(bytes) || bytes < 0 || bytes > 2 * 1024 * 1024) return;
    s.pending = Math.max(0, s.pending - bytes);
    if (s.pending < 128 * 1024) { s.channel?.resume(); s.channel?.stderr.resume(); }
  }
  invalidateSftp(session) {
    const ftp = session.ftp; session.ftp = null; session.sftp = null;
    try { ftp?.destroy(); } catch {}
  }
  cancelFileRequests(session, reason = new Error('文件操作已取消，可重新加载或重试')) {
    const requests = [...(session.fileRequests || [])];
    for (const controller of requests) if (!controller.signal.aborted) controller.abort(reason);
    this.invalidateSftp(session);
    return requests.length;
  }
  cancelFiles(id) { return this.cancelFileRequests(this.get(id)); }
  async fileOperation(session, label, action, timeoutMs = this.sftpTimeoutMs) {
    const controller = new AbortController();
    session.fileRequests ||= new Set(); session.fileRequests.add(controller);
    let timer;
    const touch = () => {
      if (controller.signal.aborted) return;
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error(`${label}超时，文件通道已重置，可重试`)), timeoutMs);
    };
    let onAbort;
    const canceled = new Promise((_resolve, reject) => {
      onAbort = () => {
        const reason = controller.signal.reason || new Error('文件操作已取消');
        reject(reason);
        // Reset the shared SFTP channel; unfinished negotiation also closes its SSH connection.
        this.cancelFileRequests(session, reason);
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    touch();
    try {
      return await Promise.race([Promise.resolve().then(() => {
        if (session.closed || controller.signal.aborted) throw controller.signal.reason || new Error('会话已关闭');
        return action(controller.signal, touch, controller);
      }), canceled]);
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort);
      session.fileRequests.delete(controller); session.transfers?.delete(controller);
    }
  }
  async sftp(id) {
    const s = this.get(id);
    if (!s.sftp) {
      const pending = this.fileOperation(s, 'SFTP 初始化', signal => new Promise((resolve, reject) => {
        const abortInit = () => {
          // ssh2 exposes no channel handle before SFTP negotiation finishes.
          // Close only this SSH connection to avoid leaking an unresponsive channel.
          if (!s.closed && !s.ftp) {
            s.errorReported = true;
            this.emit({ type: 'status', id, status: 'error', message: 'SFTP 初始化未完成，已断开当前 SSH 以释放资源；终端内容保留，可重新连接。' });
            this.closeSession(s);
          }
        };
        signal.addEventListener('abort', abortInit, { once: true });
        s.client.sftp((error, ftp) => {
          signal.removeEventListener('abort', abortInit);
          if (signal.aborted || s.closed) { try { ftp?.destroy(); } catch {} reject(signal.reason || new Error('会话已关闭')); return; }
          if (error) { reject(error); return; }
          s.ftp = ftp;
          ftp.once('close', () => { if (s.ftp === ftp) { s.ftp = null; s.sftp = null; } });
          resolve(ftp);
        });
      }));
      s.sftp = pending;
      void pending.catch(() => { if (s.sftp === pending) s.sftp = null; });
    }
    return s.sftp;
  }
  async list(id, directory = '.') {
    const session = this.get(id);
    return this.fileOperation(session, '目录读取', async signal => {
      const ftp = await this.sftp(id);
      if (signal.aborted) throw signal.reason;
      const canonical = await new Promise((resolve, reject) => ftp.realpath(remotePath(directory), (error, result) => error ? reject(error) : resolve(result)));
      if (signal.aborted) throw signal.reason;
      const entries = await new Promise((resolve, reject) => ftp.readdir(canonical, (error, result) => error ? reject(error) : resolve(result)));
      if (signal.aborted) throw signal.reason;
      return { path: canonical, entries: entries.filter(e => e.filename !== '.' && e.filename !== '..').map(e => ({
        name: e.filename, directory: e.attrs.isDirectory(), symlink: e.attrs.isSymbolicLink(), size: e.attrs.size, modified: e.attrs.mtime, mode: e.attrs.mode
      })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)) };
    });
  }
  async transfer(id, direction, local, remote, transferId) {
    const s = this.get(id); remotePath(remote);
    let partial; let transferred = 0; let last = 0;
    const event = (status, message) => this.emit({ type: 'transfer', id, transferId, direction, name: path.basename(local), bytes: transferred, status, ...(message ? { message } : {}) });
    event('running');
    try {
      return await this.fileOperation(s, '文件传输无进展', async (signal, touch, controller) => {
        s.transfers.add(controller);
        const ftp = await this.sftp(id);
        if (signal.aborted) throw signal.reason;
        let source, destination;
        if (direction === 'upload') {
          const stat = fs.statSync(local);
          if (!stat.isFile()) throw new Error('仅支持上传文件');
          source = fs.createReadStream(local);
          destination = ftp.createWriteStream(remote, { flags: 'wx', mode: 0o600 });
        } else if (direction === 'download') {
          partial = `${local}.harbor-${transferId}.part`;
          source = ftp.createReadStream(remote);
          destination = fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 });
        } else throw new Error('传输方向无效');
        source.on('data', chunk => {
          transferred += chunk.length; touch();
          if (Date.now() - last > 150) { last = Date.now(); event('running'); }
        });
        try { await pipeline(source, destination, { signal }); }
        finally { if (signal.aborted && partial) { try { fs.unlinkSync(partial); } catch {} } }
        if (signal.aborted) throw signal.reason;
        if (partial) fs.renameSync(partial, local);
        event('done'); return { bytes: transferred };
      }, this.transferIdleTimeoutMs);
    } catch (error) {
      if (partial) { try { fs.unlinkSync(partial); } catch {} }
      event('error', error.message); throw error;
    }
  }

}
module.exports = { SSHManager, remotePath };
