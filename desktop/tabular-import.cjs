const { validateProfile } = require('./store.cjs');
const MAX_ROWS = 1000, MAX_COLUMNS = 64;
const normalize = value => String(value ?? '').trim().toLowerCase().replace(/[（(](?:必填|可选)[）)]/g, '').replace(/[\s_\-]/g, '');
const aliases = new Map();
for (const [key, names] of Object.entries({
  name: ['name', 'displayname', '连接名称', '连接名', '名称', '服务器名称'],
  group: ['group', 'folder', 'environment', '分组', '组', '环境', '目录'],
  host: ['host', 'hostname', 'address', 'ip', 'ipaddress', '主机', '主机地址', '主机名', '服务器地址', '服务器', 'ip地址', '地址'],
  port: ['port', 'sshport', '端口', 'ssh端口'],
  username: ['username', 'user', 'login', '用户名', '用户', '登录用户', '登录用户名', '账号'],
  authType: ['authtype', 'auth', 'authentication', '认证方式', '认证类型', '登录方式'],
  keyPath: ['keypath', 'identityfile', 'privatekey', '私钥路径', '私钥文件', '私钥'],
  importJump: ['jump', 'jumphost', 'proxyjump', '跳板', '跳板机', '跳板连接'],
  secret: ['password', 'passwd', 'pwd', 'passphrase', '密码', '口令', '私钥口令']
})) for (const name of names) aliases.set(normalize(name), key);
function headerKey(value) { return aliases.get(normalize(value)); }
function stringValue(value, row) {
  if (value === undefined || value === null) return '';
  if (!['string', 'number'].includes(typeof value)) throw new Error(`第 ${row} 行含不支持的单元格类型，请转换为文本或数字`);
  return String(value).trim();
}
function tableProfiles(rows, warnings = []) {
  const populated = rows.map((values, i) => ({ values, row: i + 1 })).filter(({ values }) => values?.some(v => v !== undefined && v !== null && String(v).trim()));
  if (!populated.length) throw new Error('文件中没有连接数据');
  const header = populated.shift();
  if (header.values.length > MAX_COLUMNS) throw new Error(`表格最多 ${MAX_COLUMNS} 列`);
  const keys = header.values.map(headerKey); const seen = new Set();
  for (const key of keys) if (key && key !== 'secret') { if (seen.has(key)) throw new Error('表头有重复的连接字段，请保留一列'); seen.add(key); }
  if (!seen.has('host')) throw new Error('缺少主机地址列；请使用“主机地址 / IP / host”等表头，或下载导入模板');
  if (populated.length > MAX_ROWS) throw new Error(`最多导入 ${MAX_ROWS} 个连接，请分批导入`);
  if (keys.includes('secret')) warnings.push('已忽略密码／口令列，不会保存凭据；连接时可在终端输入。');
  const unknown = keys.filter((key, i) => !key && String(header.values[i] ?? '').trim()).length;
  if (unknown) warnings.push(`已忽略 ${unknown} 个未识别字段，仅导入连接设置。`);
  const profiles = populated.map(({ values, row }) => {
    if (values.slice(keys.length).some(v => String(v ?? '').trim())) throw new Error(`第 ${row} 行的列数超过表头，请检查分隔符或引号`);
    const fields = Object.create(null);
    keys.forEach((key, i) => { if (key && key !== 'secret') fields[key] = stringValue(values[i], row); });
    const auth = normalize(fields.authType);
    const modes = new Map([['password','password'],['密码','password'],['key','key'],['privatekey','key'],['publickey','key'],['私钥','key'],['私钥文件','key'],['agent','agent'],['sshagent','agent'],['系统sshagent','agent'],['interactive','interactive'],['keyboardinteractive','interactive'],['交互认证','interactive'],['验证码','interactive']]);
    if (auth && !modes.has(auth)) throw new Error(`第 ${row} 行的认证方式无效；请填写密码、私钥、Agent 或交互认证`);
    if (fields.port && !/^\d+$/.test(fields.port)) throw new Error(`第 ${row} 行的端口应为 1–65535 的整数`);
    const p = { name: fields.name || fields.host, group: fields.group || '导入连接', host: fields.host || '', port: fields.port ? Number(fields.port) : 22,
      username: fields.username || '', authType: modes.get(auth) || (fields.keyPath ? 'key' : 'password'), keyPath: fields.keyPath || '', importJump: fields.importJump || '' };
    try { validateProfile({ ...p, keyPath: p.keyPath.startsWith('~/') ? '/pending-import' + p.keyPath.slice(1) : p.keyPath, username: p.username || 'pending-import' }); }
    catch (error) { throw new Error(`第 ${row} 行：${error.message}`); }
    return p;
  });
  if (!profiles.length) throw new Error('表格只有表头，没有连接数据');
  for (const p of profiles) if (p.importJump && profiles.filter(j => j.name === p.importJump).length !== 1) throw new Error('跳板列必须填写同批表格中唯一的连接名称');
  return { profiles, warnings: [...new Set(warnings)] };
}
function parseDelimited(text, delimiter) {
  const rows = []; let row = [], field = '', quoted = false, afterQuote = false;
  const pushField = () => { row.push(field); field = ''; afterQuote = false; if (row.length > MAX_COLUMNS) throw new Error(`表格最多 ${MAX_COLUMNS} 列`); };
  const pushRow = () => { pushField(); rows.push(row); row = []; if (rows.length > MAX_ROWS + 2) throw new Error(`最多导入 ${MAX_ROWS} 个连接，请分批导入`); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; afterQuote = true; } } else field += c; }
    else if (c === delimiter) pushField();
    else if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else if (c === '"' && !field && !afterQuote) quoted = true;
    else if (afterQuote) { if (c !== ' ') throw new Error('引号结束后应为分隔符或换行，请检查 CSV 格式'); }
    else { if (c === '"') throw new Error('CSV 字段中的引号必须转义为双引号'); field += c; }
    if (field.length > 16384) throw new Error('单个字段过长，请仅保留连接设置');
  }
  if (quoted) throw new Error('CSV 引号未闭合，请检查文件');
  if (row.length || field || afterQuote) pushRow();
  return rows;
}
function delimiterFor(line) {
  const keys = [',','\t',';']; let quote = false; const counts = [0,0,0];
  for (let i=0;i<line.length;i++) { if(line[i]==='"') { if(quote && line[i+1]==='"') i++; else quote=!quote; } else if(!quote) {const j=keys.indexOf(line[i]);if(j>=0)counts[j]++;} }
  const max = Math.max(...counts); return max ? keys[counts.indexOf(max)] : null;
}
function decodeText(buffer) {
  if (typeof buffer === 'string') return { text: buffer.replace(/^\uFEFF/, ''), warnings: [] };
  let encoding = 'utf-8';
  if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = 'utf-16le';
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = 'utf-16be';
  try { return { text: new TextDecoder(encoding, { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''), warnings: [] }; }
  catch { try { return { text: new TextDecoder('gb18030', { fatal: true }).decode(buffer), warnings: ['文件按 GB18030/GBK 解码，请核对中文名称。'] }; } catch { throw new Error('无法识别文字编码，请另存为 UTF-8 后导入'); } }
}
function markdownRows(text) {
  const lines = text.split(/\r?\n/); const blocks = [];
  const cells = line => line.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'').split(/(?<!\\)\|/).map(v=>v.trim().replace(/\\\|/g,'|').replace(/^`([^`]+)`$/,'$1'));
  for(let i=0;i<lines.length-1;i++) {
    if(!lines[i].includes('|'))continue;
    const rule=cells(lines[i+1]);if(rule.length<2||!rule.every(v=>/^:?-{3,}:?$/.test(v)))continue;
    const rows=[cells(lines[i])];i+=2;while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')){rows.push(cells(lines[i]));i++;}blocks.push(rows);
  }
  if(!blocks.length)throw new Error('Markdown 中未找到表格；请使用带表头与分隔行的连接表格');
  return tableProfiles(blocks[0],blocks.length>1?['仅导入第一张 Markdown 表格，请分开保存其他表格后导入。']:[]);
}
function addressList(text) {
  const profiles = [];
  for(const [i,original] of text.split(/\r?\n/).entries()) {
    const line=original.trim();if(!line||line.startsWith('#'))continue;
    const m=line.match(/^(?:([^\s@:/]+)@)?(\[[0-9a-fA-F:.]+\]|[^\s@:/]+)(?::(\d+))?$/);
    if(!m)throw new Error(`第 ${i+1} 行不是有效地址；可填写 host、host:port 或 user@host:port`);
    const p={host:m[2].replace(/^\[|\]$/g,''),port:m[3]?Number(m[3]):22,username:m[1]||'',name:m[2],authType:'password'};
    try{validateProfile({...p,username:p.username||'pending-import'});}catch(error){throw new Error(`第 ${i+1} 行：${error.message}`);}profiles.push(p);
    if(profiles.length>MAX_ROWS)throw new Error(`最多导入 ${MAX_ROWS} 个连接，请分批导入`);
  }
  if(!profiles.length)throw new Error('文件中没有连接地址');return {profiles,warnings:[]};
}
function parseTextTable(text, extension) {
  if(extension==='md'||extension==='markdown')return markdownRows(text);
  text=text.replace(/^\uFEFF/,'');const sep=text.match(/^sep=([,;\t])\r?\n/i);if(sep)text=text.slice(sep[0].length);
  const first=text.split(/\r?\n/).find(line=>line.trim())||'';
  const delimiter=sep?.[1]||(extension==='tsv'?'\t':delimiterFor(first));
  if(delimiter)return tableProfiles(parseDelimited(text,delimiter));
  if(extension==='txt' && first.trim().split(/\s+/).some(v=>headerKey(v)==='host')) return tableProfiles(text.split(/\r?\n/).filter(v=>v.trim()).map(v=>v.trim().split(/\s+/)));
  if(extension==='txt')return addressList(text);
  throw new Error('无法识别分隔表格；请使用逗号、分号或 Tab 分隔，并保留表头');
}
module.exports={tableProfiles,parseTextTable,decodeText,headerKey,MAX_ROWS,MAX_COLUMNS};
