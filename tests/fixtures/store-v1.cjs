// Frozen SSHUltra 0.1.1 Store (MIT), upstream a0e3fc21909948a29bd67d7921c83552ee38ba15.
// Compatibility fixture: keep unchanged when the current Store evolves.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function text(value, field, max = 160, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`${field} 格式不正确`);
  return value.trim();
}
function validateProfile(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('连接配置无效');
  const host = text(raw.host, '主机', 253);
  if (/[\s/\\]/.test(host)) throw new Error('主机应为 IP 地址或域名');
  const port = Number(raw.port ?? 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口应为 1–65535');
  const authType = raw.authType || 'password';
  if (!['password', 'key', 'agent'].includes(authType)) throw new Error('不支持的认证方式');
  const keyPath = text(raw.keyPath, '私钥路径', 4096, true);
  if (keyPath && !path.isAbsolute(keyPath)) throw new Error('私钥路径必须为绝对路径');
  const id = raw.id || randomUUID();
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('连接 ID 无效');
  return { id, name: text(raw.name || host, '名称'), group: text(raw.group || '默认分组', '分组'), host, port,
    username: text(raw.username, '用户名', 128), authType, keyPath,
    color: ['teal', 'blue', 'amber', 'rose'].includes(raw.color) ? raw.color : 'teal' };
}
class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'workspace.json');
    this.state = { version: 1, profiles: [], knownHosts: {} };
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.file)) {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.profiles) || !parsed.knownHosts || typeof parsed.knownHosts !== 'object' || Array.isArray(parsed.knownHosts)) throw new Error('工作区配置损坏，请先备份后检查 workspace.json');
      this.state = { version: 1, profiles: parsed.profiles.map(validateProfile), knownHosts: { ...parsed.knownHosts } };
    }
  }
  persist(next) {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, this.file);
    this.state = next;
  }
  profiles() { return structuredClone(this.state.profiles); }
  save(raw) {
    const profile = validateProfile(raw);
    const profiles = this.profiles();
    const i = profiles.findIndex(p => p.id === profile.id);
    if (i < 0) profiles.push(profile); else profiles[i] = profile;
    if (profiles.length > 1000) throw new Error('最多保存 1000 个连接');
    this.persist({ ...this.state, profiles });
    return profile;
  }
  remove(id) { this.persist({ ...this.state, profiles: this.state.profiles.filter(p => p.id !== id) }); }
  fingerprint(host, port) { return this.state.knownHosts[JSON.stringify([host.toLowerCase(), port])]; }
  trust(host, port, fingerprint) {
    if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) throw new Error('主机指纹格式无效');
    this.persist({ ...this.state, knownHosts: { ...this.state.knownHosts, [JSON.stringify([host.toLowerCase(), port])]: fingerprint } });
  }
}
module.exports = { Store, validateProfile };
