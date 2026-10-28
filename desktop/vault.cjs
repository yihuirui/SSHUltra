const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { atomicWritePrivate } = require('./atomic-file.cjs');

// Encryption key lives in macOS Keychain; ciphertext stays in this app's userData.
// Decryption is only exposed to the main-process connection path.
class CredentialVault {
  constructor(directory, safeStorage, platform = process.platform) {
    this.file = path.join(directory, 'credentials.enc.json'); this.safe = safeStorage; this.platform = platform;
    this.entries = []; this.warning = null;
    try {
      const parsed = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
      if (!Array.isArray(parsed) || parsed.length > 500 || parsed.some(e => !e || typeof e.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(e.id) || typeof e.name !== 'string' || typeof e.encrypted !== 'string')) throw new Error('Invalid credential data');
      this.entries = parsed;
    } catch {
      this.warning = '安全凭据库无法读取，原文件已保留。连接清单仍可使用；请将连接的安全凭据改为“本次输入”，或退出应用后恢复凭据库备份。';
    }
  }
  available() { try { return !this.warning && this.platform === 'darwin' && !!this.safe?.isEncryptionAvailable(); } catch { return false; } }
  list() { return this.entries.map(({ id, name }) => ({ id, name })); }
  persist(next) {
    if (this.warning) throw new Error(this.warning);
    atomicWritePrivate(this.file, JSON.stringify(next)); this.entries = next;
  }
  save(raw) {
    if (!this.available()) throw new Error('macOS Keychain 安全存储不可用；请使用本次输入或系统 SSH Agent');
    if (!raw || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 160 || /[\x00-\x1f\x7f]/.test(raw.name)) throw new Error('凭据名称无效');
    const id = raw.id || randomUUID();
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('凭据 ID 无效');
    const secrets = {};
    for (const field of ['password', 'passphrase']) {
      if (raw[field] !== undefined) {
        if (typeof raw[field] !== 'string' || raw[field].length > 16384) throw new Error('凭据内容无效');
        secrets[field] = raw[field];
      }
    }
    if (!Object.values(secrets).some(Boolean)) throw new Error('请输入要保存的密码或私钥口令');
    const encrypted = this.safe.encryptString(JSON.stringify(secrets)).toString('base64');
    const next = this.entries.filter(e => e.id !== id);
    next.push({ id, name: raw.name.trim(), encrypted });
    if (next.length > 500) throw new Error('最多保存 500 组凭据');
    this.persist(next); return { id, name: raw.name.trim() };
  }
  read(id) {
    if (this.warning) throw new Error(this.warning);
    if (!this.available()) throw new Error('Keychain 不可用，请重试或改用本次输入');
    const entry = this.entries.find(e => e.id === id); if (!entry) throw new Error('保存的凭据不存在');
    try { return JSON.parse(this.safe.decryptString(Buffer.from(entry.encrypted, 'base64'))); }
    catch { throw new Error('无法解密保存的凭据，请重新输入并保存'); }
  }
  remove(id) { this.persist(this.entries.filter(e => e.id !== id)); }
}
module.exports = { CredentialVault };
