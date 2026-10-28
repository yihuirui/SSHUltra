const { randomUUID } = require('node:crypto');
const { validateProfile, validateReferences } = require('./store.cjs');

function parseConfig(content, filename) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 5 * 1024 * 1024) throw new Error('导入文件超过 5 MiB');
  if (filename.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(content);
    if (parsed.format !== 'sshultra-profiles' || parsed.version !== 1 || !Array.isArray(parsed.profiles)) throw new Error('请选择 SSHUltra 导出的连接 JSON');
    if (parsed.profiles.length > 1000) throw new Error('导入连接超过 1000 个');
    return { profiles: parsed.profiles, warnings: [] };
  }
  if (filename.toLowerCase().endsWith('.ini')) {
    const values = new Map();
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([SD]):"([^"]+)"=(.*)$/); if (m) values.set(m[2], { type: m[1], value: m[3] });
    }
    if (!values.get('Hostname')) throw new Error('此文件不含可识别的 SecureCRT 主机配置');
    const protocol = values.get('Protocol Name')?.value;
    if (protocol && protocol !== 'SSH2') throw new Error('仅导入 SecureCRT 的 SSH2 会话');
    const keyPath = values.get('Identity Filename V2')?.value || '';
    return { profiles: [{ name: filename.replace(/\.ini$/i, ''), host: values.get('Hostname').value,
      port: values.get('[SSH2] Port') ? parseInt(values.get('[SSH2] Port').value, 16) : 22,
      username: values.get('Username')?.value || '', authType: keyPath ? 'key' : 'password', keyPath }],
      warnings: ['SecureCRT 仅迁移 SSH2 地址、端口、用户名和私钥路径；不迁移密码、脚本、代理及主机信任。'] };
  }
  // Deliberately support only explicit OpenSSH Host entries; never execute config directives.
  const profiles = []; const warnings = []; let current = null; const aliases = new Set();
  for (const original of content.split(/\r?\n/)) {
    const line = original.trim(); if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(\S+?)(?:\s*=\s*|\s+)(.*)$/); if (!match) throw new Error('OpenSSH 配置行格式无法识别');
    const key = match[1].toLowerCase(); const value = match[2].trim().replace(/^"(.*)"$/, '$1');
    if (key === 'match') throw new Error('不支持 Match 配置；请先整理为独立显式 Host，不会执行其中的命令');
    if (['include', 'proxycommand'].includes(key)) throw new Error(`无法安全迁移 ${key}（含全局/通配符作用域），请先整理为显式 Host；不会执行或展开外部配置`);
    if (key === 'host') {
      const names = value.split(/\s+/);
      if (names.some(n => /[*?!]/.test(n))) throw new Error('不支持通配符 Host 继承，请先将配置整理为独立显式 Host');
      if (names.some(n => aliases.has(n))) throw new Error('Host 别名重复，请先合并为独立显式条目');
      for (const name of names) aliases.add(name);
      current = names.map(name => ({ name, host: name, port: 22, username: '', authType: 'agent', keyPath: '' }));
      profiles.push(...current); continue;
    }
    if (['localcommand', 'remotecommand', 'forwardagent', 'localforward', 'remoteforward'].includes(key)) {
      warnings.push(`未迁移 ${key}，请手动核对连接。`);
      continue;
    }
    if (!current) {
      if (['hostname', 'user', 'port', 'identityfile', 'proxyjump'].includes(key)) throw new Error(`不支持全局 ${key} 继承，请在各显式 Host 中指定`);
      continue;
    }
    for (const p of current) {
      if (key === 'hostname') p.host = value;
      if (key === 'user') p.username = value;
      if (key === 'port') p.port = Number(value);
      if (key === 'identityfile') { p.keyPath = value; p.authType = 'key'; }
      if (key === 'proxyjump') p.importJump = value === 'none' ? '' : value;
    }
    if (profiles.length > 1000) throw new Error('导入连接超过 1000 个');
  }
  return { profiles, warnings: [...new Set(warnings)] };
}
function importProfiles(current, source, username = '', home = '') {
  if (!Array.isArray(source) || !source.length || source.length > 1000) throw new Error('没有可导入的连接');
  if (source.some(p => p.importUnsupported)) throw new Error('配置包含未支持的代理或 Include，无法安全导入；请先展开配置或移除相关条目');
  const ids = new Map(); const aliases = new Map();
  const next = source.map(p => {
    const id = randomUUID(); if (p.id) { if (ids.has(p.id)) throw new Error('导入连接 ID 重复'); ids.set(p.id, id); } aliases.set(p.name, id);
    const keyPath = typeof p.keyPath === 'string' && p.keyPath.startsWith('~/') ? home + p.keyPath.slice(1) : p.keyPath || '';
    return { ...p, id, revision: 1, username: p.username || username, group: p.group || '导入连接', keyPath, credentialId: '', logEnabled: false, logRetentionDays: 0 };
  });
  for (let i = 0; i < next.length; i++) {
    const raw = source[i]; const jump = raw.importJump || raw.jumpProfileId;
    next[i].jumpProfileId = jump ? (raw.importJump ? aliases : ids).get(jump) : '';
    if (jump && !next[i].jumpProfileId) throw new Error('跳板必须同时导入，且 ProxyJump 仅支持单个已命名 Host');
  }
  const result = [...current, ...next.map(validateProfile)]; validateReferences(result);
  if (result.length > 1000) throw new Error('导入后超过 1000 个连接');
  return result;
}
function exportProfiles(profiles, ids, includeUsername = false, includeKeyPath = false) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !profiles.some(p => p.id === id))) throw new Error('请选择有效的导出连接');
  const selected = profiles.filter(p => ids.includes(p.id));
  if (selected.some(p => p.jumpProfileId && !ids.includes(p.jumpProfileId))) throw new Error('导出时请同时选择被引用的跳板连接');
  return { format: 'sshultra-profiles', version: 1, profiles: selected.map(p => ({
    id: p.id, name: p.name, group: p.group, host: p.host, port: p.port, authType: p.authType,
    username: includeUsername ? p.username : '', keyPath: includeKeyPath ? p.keyPath : '', color: p.color, jumpProfileId: p.jumpProfileId
  })) };
}
module.exports = { parseConfig, importProfiles, exportProfiles };
