import { useState } from 'react';
import { Modal } from './Modal';
import { X, Plus, Search, Trash2, BookOpen, KeyRound, Settings2 } from 'lucide-react';
import type { AuthRequest, ImportPreview, Profile, SavedCommand, SavedCredential } from './types';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
type Close = { onClose: () => void; reportError: (text: string) => void };
export function CommandLibrary({ commands, recent, initialBody, onUse, onClose, reportError }: Close & {
  commands: SavedCommand[]; recent: string[]; initialBody: string; onUse: (body: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState<Partial<SavedCommand>>({ name: '', folder: '常用命令', body: initialBody });
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState(false); const [busy, setBusy] = useState(false);
  const names = [...new Set([...String(draft.body || '').matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]{0,31})\}\}/g)].map(m => m[1]))];
  const filtered = commands.filter(c => `${c.name} ${c.folder} ${c.body}`.toLowerCase().includes(filter.toLowerCase()));
  const choose = (command: Partial<SavedCommand>) => { setDraft({ ...command }); setPreparing(false); setParameters({}); };
  const fill = () => {
    if (!draft.body?.trim()) return;
    if (names.length && !preparing) { setPreparing(true); return; }
    const body = draft.body.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]{0,31})\}\}/g, (_match, name: string) => parameters[name] || '');
    onUse(body); onClose();
  };
  return <Modal label="命令库" onClose={onClose}><section className="modal tools-modal">
    <div className="modal-heading"><h2><BookOpen size={19}/>命令库</h2><button title="关闭命令库" onClick={onClose}><X size={18}/></button></div>
    <p className="tool-description">选择命令，编辑后填入批量命令栏。发送前仍会确认目标与完整命令。</p>
    <div className="tool-columns"><aside className="tool-list"><div className="tool-search"><Search size={14}/><input data-modal-initial aria-label="搜索命令" placeholder="搜索名称、文件夹或内容" value={filter} onChange={e => setFilter(e.target.value)}/></div>
      <button className="secondary" onClick={() => choose({ name: '', folder: '常用命令', body: initialBody })}><Plus size={14}/>新建命令</button>
      {[...new Set(filtered.map(c => c.folder))].map(folder => <div key={folder}><h3>{folder}</h3>{filtered.filter(c => c.folder === folder).map(c => <button className={`command-item ${draft.id === c.id ? 'chosen' : ''}`} key={c.id} onClick={() => choose(c)}><strong>{c.name}</strong><small>{c.body}</small></button>)}</div>)}
      {!commands.length && <p className="muted">还没有收藏。可以保存当前命令，或用 {'{{path}}'} 作为参数。</p>}
      {!!recent.length && <div><h3>本次运行的最近发送</h3>{recent.map((body, i) => <button className="command-item" key={i} onClick={() => choose({ name: '', folder: '最近命令', body })}><small>{body}</small></button>)}</div>}
    </aside><form className="tool-editor" onSubmit={async e => {
      e.preventDefault(); setBusy(true);
      try { const value = await window.harbor.saveCommand(draft); setDraft(value); }
      catch (error) { reportError(message(error)); } finally { setBusy(false); }
    }}>
      <label>命令名称<input required value={draft.name || ''} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}/></label>
      <label>命令文件夹<input value={draft.folder || ''} onChange={e => setDraft(p => ({ ...p, folder: e.target.value }))}/></label>
      <label>命令内容<textarea aria-label="命令内容" rows={7} required value={draft.body || ''} onChange={e => { setDraft(p => ({ ...p, body: e.target.value })); setPreparing(false); }}/></label>
      <p className="muted">收藏会保存在本机，请先移除密码、令牌等敏感内容。最近发送仅保留在当前窗口内存。</p>
      {preparing && names.map(name => <label key={name}>参数 {name}<input aria-label={`参数 ${name}`} value={parameters[name] || ''} onChange={e => setParameters(p => ({ ...p, [name]: e.target.value }))}/></label>)}
      <div className="tool-actions">{draft.id && <button type="button" className="danger-link" disabled={busy} onClick={async () => {
        try { if (await window.harbor.deleteCommand(draft.id!)) choose({ name: '', folder: '常用命令', body: '' }); } catch (error) { reportError(message(error)); }
      }}><Trash2 size={14}/>删除命令</button>}<button className="secondary" disabled={busy}>保存命令</button><button type="button" className="primary" disabled={!draft.body?.trim() || busy || preparing && names.some(n => !parameters[n]?.trim())} onClick={fill}>{names.length && !preparing ? '填写参数' : '填入命令'}</button></div>
    </form></div>
  </section></Modal>;
}

export function AuthenticationDialog({ request, onDone, reportError }: { request: AuthRequest; onDone: () => void; reportError: (text: string) => void }) {
  const [answers, setAnswers] = useState<string[]>(request.prompts.map(() => '')); const [busy, setBusy] = useState(false);
  const send = async (value: string[] | null) => {
    setBusy(true);
    try { await window.harbor.answerAuth(request.token, value); }
    catch (error) { reportError(message(error)); }
    finally { setAnswers([]); onDone(); }
  };
  return <Modal label="SSH 交互认证" className="auth-backdrop" onClose={() => { if (!busy) void send(null); }}><form className="modal" onSubmit={e => { e.preventDefault(); void send(answers); }}>
    <div className="modal-heading"><h2>SSH 交互认证</h2><button type="button" title="取消认证" disabled={busy} onClick={() => send(null)}><X size={18}/></button></div>
    <p className="tool-description">服务器：{request.host}。请求在 60 秒后过期。</p><p className="auth-instructions">{request.name}<br/>{request.instructions}</p>
    {request.prompts.map((prompt, i) => <label className="full-field" key={i}>{prompt.prompt || `认证回答 ${i + 1}`}<input autoFocus={i === 0} aria-label={`认证回答 ${i + 1}`} type={prompt.echo ? 'text' : 'password'} autoComplete="off" value={answers[i] || ''} onChange={e => setAnswers(prev => prev.map((v, n) => n === i ? e.target.value : v))}/></label>)}
    <p className="tool-description">回答仅用于本次服务器认证，不保存到凭据库或日志。</p>
    <div className="tool-actions"><button type="button" className="secondary" disabled={busy} onClick={() => send(null)}>取消连接</button><button className="primary" disabled={busy}>提交认证</button></div>
  </form></Modal>;
}

export function CredentialManager({ credentials, available, onClose, reportError }: Close & { credentials: SavedCredential[]; available: boolean }) {
  const [id, setId] = useState(''); const [name, setName] = useState(''); const [password, setPassword] = useState(''); const [passphrase, setPassphrase] = useState(''); const [busy, setBusy] = useState(false);
  const clear = () => { setId(''); setName(''); setPassword(''); setPassphrase(''); };
  return <Modal label="安全凭据" onClose={onClose}><section className="modal tools-modal">
    <div className="modal-heading"><h2><KeyRound size={19}/>安全凭据</h2><button title="关闭凭据管理" onClick={onClose}><X size={18}/></button></div>
    <p className="tool-description">macOS Keychain 保护加密密钥，密文保存在本应用的数据目录。连接配置只引用凭据 ID。未签名预览版更新时可能再次出现 Keychain 授权提示。</p>
    {!available && <p className="form-error">当前系统安全存储不可用。可继续使用本次输入或 SSH Agent。</p>}
    <div className="tool-columns"><aside className="tool-list"><button className="secondary" onClick={clear}><Plus size={14}/>新建凭据</button>{credentials.map(c => <button className={`command-item ${id === c.id ? 'chosen' : ''}`} key={c.id} onClick={() => { clear(); setId(c.id); setName(c.name); }}><strong>{c.name}</strong><small>仅显示名称，不回读密码</small></button>)}</aside>
    <form className="tool-editor" onSubmit={async e => {
      e.preventDefault(); setBusy(true);
      try {
        const value = await window.harbor.saveCredential({ id: id || undefined, name, ...(password ? { password } : {}), ...(passphrase ? { passphrase } : {}) });
        if (value) { setId(value.id); setPassword(''); setPassphrase(''); }
      } catch (error) { reportError(message(error)); } finally { setBusy(false); }
    }}><label>凭据名称<input required value={name} onChange={e => setName(e.target.value)}/></label><label>保存的密码<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)}/></label><label>保存的私钥口令<input type="password" autoComplete="new-password" value={passphrase} onChange={e => setPassphrase(e.target.value)}/></label>
    <p className="muted">更新时重新输入要保留的密码或口令；不会保留未填写的旧字段。验证码请在连接时输入。</p>
    <div className="tool-actions">{id && <button type="button" className="danger-link" disabled={busy} onClick={async () => { try { if (await window.harbor.deleteCredential(id)) clear(); } catch (error) { reportError(message(error)); } }}><Trash2 size={14}/>删除凭据</button>}<button className="primary" disabled={!available || busy || !password && !passphrase}>保存安全凭据</button></div>
    </form></div>
  </section></Modal>;
}

export function ConnectionManager({ profiles, credentials, onClose, reportError }: Close & { profiles: Profile[]; credentials: SavedCredential[] }) {
  const [ids, setIds] = useState<string[]>([]); const [filter, setFilter] = useState('');
  const [field, setField] = useState('group'); const [value, setValue] = useState('');
  const [includeUsername, setIncludeUsername] = useState(false); const [includeKeyPath, setIncludeKeyPath] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null); const [username, setUsername] = useState(''); const [busy, setBusy] = useState(false);
  const [templateFormat, setTemplateFormat] = useState('xlsx'); const [templateSaved, setTemplateSaved] = useState(false);
  const filtered = profiles.filter(p => `${p.name} ${p.group} ${p.host}`.toLowerCase().includes(filter.toLowerCase()));
  const selected = ids.filter(id => profiles.some(p => p.id === id));
  const perform = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } catch (error) { reportError(message(error)); } finally { setBusy(false); } };
  const fields: Record<string, string> = { group: '分组', host: '主机地址', port: '端口', username: '用户名', authType: '认证方式', keyPath: '私钥路径', jumpProfileId: '跳板连接', credentialId: '安全凭据', logEnabled: '连接后持续日志', logRetentionDays: '日志保留天数' };
  return <Modal label="连接批量管理" onClose={onClose}><section className="modal tools-modal">
    <div className="modal-heading"><h2><Settings2 size={19}/>连接批量管理</h2><button title="关闭连接批量管理" onClick={onClose}><X size={18}/></button></div>
    <p className="tool-description">批量修改保存的配置。已连接的终端继续使用连接时的设置，下次连接生效。</p>
    <div className="tool-columns"><aside className="tool-list"><input aria-label="筛选管理连接" placeholder="筛选名称、分组或主机" value={filter} onChange={e => setFilter(e.target.value)}/><div className="tool-actions"><button onClick={() => setIds(filtered.map(p => p.id))}>选择筛选结果</button><button onClick={() => setIds([])}>清空</button></div>
    {filtered.map(p => <label className="managed-profile" key={p.id}><input type="checkbox" aria-label={`管理目标 ${p.name}`} checked={selected.includes(p.id)} onChange={e => setIds(prev => e.target.checked ? [...new Set([...prev, p.id])] : prev.filter(id => id !== p.id))}/><span><strong>{p.name}</strong><small>{p.group} · {p.username}@{p.host}:{p.port}</small></span></label>)}</aside>
    <div className="tool-editor"><h3>批量修改 · 已选 {selected.length} 个</h3><label>修改字段<select aria-label="修改字段" value={field} onChange={e => { setField(e.target.value); setValue(''); }}>{Object.entries(fields).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label>新值{field === 'authType' ? <select aria-label="批量新值" value={value} onChange={e => setValue(e.target.value)}><option value="">选择认证方式</option><option value="password">密码</option><option value="key">私钥文件</option><option value="agent">SSH Agent</option><option value="interactive">交互认证</option></select> : field === 'jumpProfileId' || field === 'credentialId' ? <select aria-label="批量新值" value={value} onChange={e => setValue(e.target.value)}><option value="">解除引用</option>{(field === 'jumpProfileId' ? profiles.filter(p => !p.jumpProfileId && !selected.includes(p.id)) : credentials).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : field === 'logEnabled' ? <select aria-label="批量新值" value={value} onChange={e => setValue(e.target.value)}><option value="">请选择</option><option value="true">启用（可能记录敏感输出）</option><option value="false">关闭</option></select> : field === 'logRetentionDays' ? <select aria-label="批量新值" value={value} onChange={e => setValue(e.target.value)}><option value="">请选择</option><option value="0">永久保留</option><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option></select> : <input aria-label="批量新值" value={value} onChange={e => setValue(e.target.value)}/>}</label>
      <button className="secondary" disabled={!selected.length || busy || !value && !['jumpProfileId', 'credentialId', 'keyPath'].includes(field)} onClick={() => perform(() => window.harbor.bulkProfiles(selected, { [field]: ['port', 'logRetentionDays'].includes(field) ? Number(value) : field === 'logEnabled' ? value === 'true' : value }))}>预览修改并确认</button>
      <h3>导出选中的连接</h3><label className="inline-check"><input type="checkbox" checked={includeUsername} onChange={e => setIncludeUsername(e.target.checked)}/>包含用户名</label><label className="inline-check"><input type="checkbox" checked={includeKeyPath} onChange={e => setIncludeKeyPath(e.target.checked)}/>包含本机私钥路径</label><p className="muted">导出仍包含服务器地址；密码、口令和主机信任永不导出。</p><button className="secondary" disabled={!selected.length || busy} onClick={() => perform(() => window.harbor.exportProfiles(selected, includeUsername, includeKeyPath))}>导出所选配置</button>
      <h3>导入连接</h3><p className="muted">支持 Excel（.xlsx / .xls）、CSV / TSV、TXT、Markdown 表格，以及原有 SSHUltra JSON、SecureCRT SSH2 INI、OpenSSH config。</p>
      <p className="muted">表格首行为列名，可用中文或英文：名称、分组、主机地址、端口、用户名、认证方式、私钥路径、跳板。仅主机地址必填；TXT 也可一行一个 host、host:port 或 user@host:port。密码列忽略，不执行宏、公式或命令。</p>
      <div className="import-template"><label>模板格式<select aria-label="导入模板格式" value={templateFormat} disabled={busy} onChange={e => { setTemplateFormat(e.target.value); setTemplateSaved(false); }}><option value="xlsx">Excel XLSX</option><option value="csv">CSV</option><option value="txt">TXT（Tab 分隔）</option><option value="md">Markdown 表格</option></select></label><button className="secondary" disabled={busy} onClick={() => perform(async () => { setTemplateSaved(await window.harbor.saveImportTemplate(templateFormat)); })}>保存导入模板</button></div>{templateSaved && <p className="muted" role="status">模板已保存，填写后可选择文件导入。</p>}
      <button className="secondary" disabled={busy} onClick={() => perform(async () => { setPreview(null); const result = await window.harbor.readImport(); if (result) { setPreview(result); setUsername(''); } })}>{busy ? '正在处理…' : '选择导入文件'}</button>
      {preview && <div className="import-preview"><strong>将新增 {preview.count} 个连接</strong>{preview.sheets && <label>Excel 工作表<select aria-label="导入工作表" value={preview.sheet} disabled={busy} onChange={e => { const sheet = e.target.value; void perform(async () => { const result = await window.harbor.selectImportSheet(preview.token, sheet); setPreview(result); setUsername(''); }); }}>{preview.sheets.map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}</select></label>}<p>{preview.format} · 现有连接保留，确认后新增。</p>
        {!!preview.rows?.length && <div className="import-rows"><table aria-label="导入连接预览"><thead><tr><th>名称 / 分组</th><th>主机 / 端口</th><th>用户名</th></tr></thead><tbody>{preview.rows.map((row,i)=><tr key={i}><td>{row.name}<small>{row.group}</small></td><td>{row.host}:{row.port}</td><td>{row.username || '待填写默认值'}</td></tr>)}</tbody></table>{preview.count > preview.rows.length && <small>显示前 {preview.rows.length} 个，共 {preview.count} 个连接。</small>}</div>}
        {preview.warnings.map((w, i) => <p className="import-warning" key={i}>{w}</p>)}{!!preview.missingUsernames && <label>缺失用户名的默认值<input aria-label="导入默认用户名" value={username} onChange={e => setUsername(e.target.value)}/></label>}<button className="primary" disabled={busy || !preview.count || !!preview.missingUsernames && !username.trim()} onClick={() => perform(async () => { if (await window.harbor.applyImport(preview.token, username)) setPreview(null); })}>预览导入并确认</button></div>}
    </div></div>
  </section></Modal>;
}
