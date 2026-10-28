const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { atomicWritePrivate } = require('./atomic-file.cjs');

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
  if (!['password', 'key', 'agent', 'interactive'].includes(authType)) throw new Error('不支持的认证方式');
  const keyPath = text(raw.keyPath, '私钥路径', 4096, true);
  if (keyPath && !path.isAbsolute(keyPath)) throw new Error('私钥路径必须为绝对路径');
  const id = raw.id || randomUUID();
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('连接 ID 无效');
  if (raw.revision !== undefined && (!Number.isSafeInteger(raw.revision) || raw.revision < 0)) throw new Error('连接版本无效');
  for (const field of ['jumpProfileId', 'credentialId']) {
    if (raw[field] && (typeof raw[field] !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(raw[field]))) throw new Error('连接引用无效');
  }
  return { id, revision: raw.revision ?? 0, name: text(raw.name || host, '名称'), group: text(raw.group || '默认分组', '分组'), host, port,
    username: text(raw.username, '用户名', 128), authType, keyPath,
    jumpProfileId: raw.jumpProfileId || '', credentialId: raw.credentialId || '',
    logEnabled: raw.logEnabled === true,
    logRetentionDays: [0, 7, 30, 90].includes(raw.logRetentionDays) ? raw.logRetentionDays : 0,
    color: ['teal', 'blue', 'amber', 'rose'].includes(raw.color) ? raw.color : 'teal' };
}
function validateCommand(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('命令无效');
  const id = raw.id || randomUUID();
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('命令 ID 无效');
  if (typeof raw.body !== 'string' || !raw.body.trim() || Buffer.byteLength(raw.body) > 16384 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(raw.body)) throw new Error('命令为空、过长或包含控制字符');
  return { id, name: text(raw.name, '命令名称'), folder: text(raw.folder || '常用命令', '命令文件夹'), body: raw.body };
}
function validateReferences(profiles) {
  const byId = new Map(profiles.map(p => [p.id, p]));
  if (byId.size !== profiles.length) throw new Error('连接 ID 重复');
  for (const p of profiles) {
    if (!p.jumpProfileId) continue;
    const jump = byId.get(p.jumpProfileId);
    if (!jump || jump.id === p.id || jump.jumpProfileId) throw new Error('请选择存在的单级跳板连接；不支持循环或多级跳板');
  }
}
class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'workspace.json');
    this.state = { version: 2, profiles: [], knownHosts: {}, commands: [] };
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.file)) {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (![1, 2].includes(parsed.version)) throw new Error('工作区格式不受当前版本支持；请使用匹配版本，勿覆盖现有文件');
      if (!Array.isArray(parsed.profiles) || !parsed.knownHosts || typeof parsed.knownHosts !== 'object' || Array.isArray(parsed.knownHosts)) throw new Error('工作区配置损坏，请先备份后检查 workspace.json');
      this.state = { version: 2, profiles: parsed.profiles.map(p => validateProfile({ ...p, revision: p.revision ?? 1 })), knownHosts: { ...parsed.knownHosts }, commands: (parsed.commands || []).map(validateCommand) };
      validateReferences(this.state.profiles);
      if (parsed.version === 1) {
        this.backup('workspace-v1-backup');
        this.persist(this.state);
      }
    }
  }
  persist(next) {
    atomicWritePrivate(this.file, JSON.stringify(next, null, 2));
    this.state = next;
  }
  backup(prefix = 'workspace-backup') {
    if (!fs.existsSync(this.file)) return;
    const backup = path.join(this.directory, `${prefix}-${Date.now()}-${randomUUID()}.json`);
    // Reuse the private atomic writer; do not inherit a source file's broad permissions.
    atomicWritePrivate(backup, fs.readFileSync(this.file));
    return backup;
  }
  profiles() { return structuredClone(this.state.profiles); }
  save(raw) {
    const profile = validateProfile(raw);
    const profiles = this.profiles();
    const i = profiles.findIndex(p => p.id === profile.id);
    if (i < 0 && raw.id && profile.revision > 0) throw new Error('连接已删除，请重新新建连接');
    if (i >= 0 && raw.revision !== profiles[i].revision) throw new Error('连接已被其他操作更新，请关闭编辑器并重新打开，避免覆盖新配置');
    profile.revision = i < 0 ? 1 : profiles[i].revision + 1;
    if (i < 0) profiles.push(profile); else profiles[i] = profile;
    if (profiles.length > 1000) throw new Error('最多保存 1000 个连接');
    validateReferences(profiles);
    this.persist({ ...this.state, profiles });
    return profile;
  }
  remove(id) {
    if (this.state.profiles.some(p => p.jumpProfileId === id)) throw new Error('其他连接正在引用此跳板，请先解除引用');
    this.persist({ ...this.state, profiles: this.state.profiles.filter(p => p.id !== id) });
  }
  commands() { return structuredClone(this.state.commands); }
  saveCommand(raw) {
    const command = validateCommand(raw);
    const commands = this.commands().filter(c => c.id !== command.id);
    commands.push(command);
    if (commands.length > 500) throw new Error('最多保存 500 条命令');
    this.persist({ ...this.state, commands }); return command;
  }
  removeCommand(id) { this.persist({ ...this.state, commands: this.commands().filter(c => c.id !== id) }); }
  bulkPreview(ids, patch) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || new Set(ids).size !== ids.length) throw new Error('请选择不重复的连接');
    const allowed = ['host', 'port', 'username', 'group', 'authType', 'jumpProfileId', 'credentialId', 'keyPath', 'logEnabled', 'logRetentionDays'];
    if (!patch || typeof patch !== 'object' || !Object.keys(patch).length || Object.keys(patch).some(k => !allowed.includes(k))) throw new Error('批量修改字段无效');
    if (ids.some(id => !this.state.profiles.some(p => p.id === id))) throw new Error('连接已变化，请刷新后重试');
    const next = this.profiles().map(p => ids.includes(p.id) ? validateProfile({ ...p, ...patch, revision: p.revision + 1 }) : p);
    validateReferences(next); return next;
  }
  replaceProfiles(profiles) {
    if (!Array.isArray(profiles) || profiles.length > 1000) throw new Error('连接数量超限');
    const next = profiles.map(validateProfile); validateReferences(next);
    this.backup();
    this.persist({ ...this.state, profiles: next });
  }
  fingerprint(host, port) { return this.state.knownHosts[JSON.stringify([host.toLowerCase(), port])]; }
  trust(host, port, fingerprint) {
    if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) throw new Error('主机指纹格式无效');
    this.persist({ ...this.state, knownHosts: { ...this.state.knownHosts, [JSON.stringify([host.toLowerCase(), port])]: fingerprint } });
  }
}
module.exports = { Store, validateProfile, validateCommand, validateReferences };
