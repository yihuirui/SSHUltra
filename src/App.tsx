import { useCallback, useEffect, useRef, useState } from 'react';
import { Anchor, Plus, Search, Server, Folder, ChevronDown, ChevronRight, X, Columns2, Grid2X2, Square, PanelRight, Upload, Download, RefreshCw, ArrowUp, File, Send, ShieldCheck, Terminal, Pencil, Trash2, ExternalLink, KeyRound, CircleHelp, Minus, Check, AlertCircle } from 'lucide-react';
import type { AuthRequest, Credentials, Entry, Profile, Session, Transfer, SavedCommand, SavedCredential } from './types';
import { TerminalPane } from './TerminalPane';
import { CommandLibrary, AuthenticationDialog, ConnectionManager, CredentialManager } from './WorkflowTools';
import './workflows.css';
import { Modal } from './Modal';

const blank: Partial<Profile> = { name: '', group: '默认分组', host: '', port: 22, username: '', authType: 'password', keyPath: '', color: 'teal', jumpProfileId: '', credentialId: '', logEnabled: false, logRetentionDays: 0 };
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const prettyBytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
type EditorState = { initial: Partial<Profile>; instance: number; reconnectId?: string };

export function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState('');
  const [layout, setLayout] = useState<'single' | 'columns' | 'grid'>('single');
  const [paneSlots, setPaneSlots] = useState<(string | null)[]>([null, null, null, null]);
  const [focusedSlot, setFocusedSlot] = useState(0);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [files, setFiles] = useState(true);
  const [targets, setTargets] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [help, setHelp] = useState(false);
  const [tool, setTool] = useState<'commands' | 'connections' | 'credentials' | null>(null);
  const [commands, setCommands] = useState<SavedCommand[]>([]);
  const [savedCredentials, setSavedCredentials] = useState<SavedCredential[]>([]);
  const [credentialAvailable, setCredentialAvailable] = useState(false);
  const [authRequests, setAuthRequests] = useState<AuthRequest[]>([]);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const [fontSize, setFontSize] = useState(13);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const credentials = useRef(new Map<string, Credentials>());
  const editorInstance = useRef(0);
  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  const reportError = useCallback((text: string) => notify(text, true), [notify]);
  const openEditor = useCallback((initial: Partial<Profile> = blank, reconnectId?: string) => {
    setEditor({ initial: { ...initial }, instance: ++editorInstance.current, reconnectId });
  }, []);
  useEffect(() => {
    window.harbor.init().then(data => { setProfiles(data.profiles); setCommands(data.commands); setSavedCredentials(data.credentials); setCredentialAvailable(data.credentialAvailable); if (data.vaultWarning) reportError(data.vaultWarning); }).catch(e => reportError(message(e)));
    return window.harbor.onEvent(event => {
      if (event.type === 'workflows') { setCommands(event.commands); setSavedCredentials(event.credentials); }
      if (event.type === 'auth') setAuthRequests(prev => [...prev, event]);
      if (event.type === 'auth-expired') setAuthRequests(prev => prev.filter(p => p.token !== event.token));
      if (event.type === 'logging') {
        setSessions(prev => prev.map(s => s.id === event.id ? { ...s, logging: event.enabled } : s));
        if (event.message) reportError(event.message);
      }
      if (event.type === 'profiles') setProfiles(event.profiles);
      if (event.type === 'status') {
        if (['error', 'disconnected'].includes(event.status)) setAuthRequests(prev => prev.filter(p => p.id !== event.id));
        setSessions(prev => prev.map(s => s.id === event.id ? { ...s, status: s.status === 'error' && event.status === 'disconnected' ? 'error' : event.status, message: event.message || s.message } : s));
        if (event.status !== 'connected') setTargets(prev => prev.filter(id => id !== event.id));
      }
      if (event.type === 'transfer') setTransfers(prev => [event, ...prev.filter(t => t.transferId !== event.transferId)].slice(0, 20));
    });
  }, [reportError]);
  useEffect(() => { if (!notice || notice.error) return; const t = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(t); }, [notice]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('dialog[open]');
      const newConnection = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n' && !e.shiftKey;
      // Keep the existing reset-to-new shortcut inside the connection editor only.
      if (dialogs.length && !(dialogs.length === 1 && dialogs[0].getAttribute('aria-label') === 'SSH 连接' && newConnection)) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setTool('commands'); }
      if (newConnection) { e.preventDefault(); openEditor(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [openEditor]);
  const takeCredentials = useCallback((id: string) => { const value = credentials.current.get(id) || {}; credentials.current.delete(id); return value; }, []);
  const connect = (profile: Profile, secrets: Credentials) => {
    if (sessions.length >= 12) { reportError('当前窗口已有 12 个终端，请先关闭一个终端或新建窗口。'); return; }
    const id = crypto.randomUUID();
    credentials.current.set(id, { ...secrets });
    const count = layout === 'single' ? 1 : layout === 'columns' ? 2 : 4;
    const freeSlot = paneSlots.slice(0, count).findIndex(slot => !slot);
    const slot = freeSlot >= 0 ? freeSlot : Math.min(focusedSlot, count - 1);
    setPaneSlots(prev => {
      const next = [...prev];
      next[slot] = id;
      return next.map((value, index) => index !== slot && value === id ? null : value);
    });
    setFocusedSlot(slot); setSessions(prev => [...prev, { id, profile, status: 'connecting', connectAttempt: 0 }]); setActive(id); setEditor(null);
  };
  const reconnect = (id: string, profile: Profile, secrets: Credentials) => {
    credentials.current.set(id, { ...secrets });
    setSessions(prev => prev.map(session => session.id === id
      ? { ...session, profile, status: 'connecting', message: undefined, connectAttempt: session.connectAttempt + 1 }
      : session));
    setEditor(null);
  };
  const close = (id: string) => {
    void window.harbor.disconnect(id).catch(e => reportError(message(e)));
    const remaining = sessions.filter(s => s.id !== id);
    const closedSlot = paneSlots.indexOf(id);
    const nextSlots = paneSlots.map(slot => slot === id ? null : slot);
    const replacement = active === id ? remaining.find(session => !nextSlots.includes(session.id)) : undefined;
    if (replacement && closedSlot >= 0) nextSlots[closedSlot] = replacement.id;
    setPaneSlots(nextSlots);
    setSessions(remaining); setTargets(prev => prev.filter(t => t !== id)); credentials.current.delete(id);
    if (active === id) {
      const nextActive = replacement?.id || nextSlots.find((slot): slot is string => Boolean(slot)) || remaining.at(-1)?.id || '';
      setActive(nextActive);
      setFocusedSlot(Math.max(0, nextSlots.indexOf(nextActive)));
    }
  };
  const modalAuth = authRequests.find(request => request.presentation !== 'terminal');
  const inputBlocked = Boolean(editor || help || tool || modalAuth);
  const prepareReconnect = (session: Session) => {
    const latest = profiles.find(profile => profile.id === session.profile.id);
    if (!latest) { reportError('保存的连接已删除，请重新新建连接；当前终端内容仍保留。'); return; }
    openEditor(latest, session.id);
  };
  const selected = sessions.find(s => s.id === active);
  const connected = sessions.filter(s => s.status === 'connected');
  const slotCount = layout === 'single' ? 1 : layout === 'columns' ? 2 : 4;
  const visibleIds = paneSlots.slice(0, slotCount).filter((id): id is string => Boolean(id));
  const selectSession = (id: string) => {
    const existingSlot = paneSlots.indexOf(id);
    if (existingSlot >= 0 && existingSlot < slotCount) {
      setActive(id); setFocusedSlot(existingSlot); return;
    }
    const slot = Math.min(focusedSlot, slotCount - 1);
    setPaneSlots(prev => {
      const next = [...prev];
      next[slot] = id;
      return next.map((value, index) => index !== slot && value === id ? null : value);
    });
    setActive(id); setFocusedSlot(slot);
  };
  const focusPane = (id: string, slot: number) => { setActive(id); setFocusedSlot(slot); };
  const changeLayout = (nextLayout: 'single' | 'columns' | 'grid') => {
    const nextCount = nextLayout === 'single' ? 1 : nextLayout === 'columns' ? 2 : 4;
    const candidates = [...new Set([active, ...paneSlots, ...sessions.map(session => session.id)].filter(id => sessions.some(session => session.id === id)))];
    const nextSlots: (string | null)[] = [...candidates.slice(0, nextCount), ...Array(Math.max(0, 4 - nextCount)).fill(null)];
    setPaneSlots(nextSlots); setFocusedSlot(0); setLayout(nextLayout);
  };
  const filtered = profiles.filter(p => `${p.name} ${p.host} ${p.username} ${p.group}`.toLowerCase().includes(filter.toLowerCase()));
  const groups = [...new Set(filtered.map(p => p.group))];
  const send = async () => {
    if (!targets.length || !command.trim() || sending) return;
    setSending(true);
    try {
      const result = await window.harbor.batch([...targets], command);
      if (!result.canceled) {
        setRecentCommands(prev => [command, ...prev.filter(c => c !== command)].slice(0, 20));
        const failed = result.results.filter(r => !r.sent);
        notify(failed.length ? `${result.results.length - failed.length} 个会话已发送，${failed.length} 个失败，请检查终端。` : `已发送到 ${result.results.length} 个会话，请在终端查看执行结果。`, failed.length > 0);
      }
    } catch (e) { reportError(message(e)); } finally { setSending(false); }
  };
  return <div className="app">
    <header className="titlebar"><div className="title-brand"><Anchor size={17}/><strong>SSH<span>Ultra</span></strong><span className="version">PREVIEW 0.2.3</span></div><div className="title-center">你的远程工作空间</div><div className="title-actions"><button title="新建窗口" onClick={() => window.harbor.newWindow().catch(e => reportError(message(e)))}><ExternalLink size={15}/><span>新窗口</span></button><button title="使用帮助" onClick={() => setHelp(true)}><CircleHelp size={16}/></button></div></header>
    <div className="app-body">
      <aside className="sidebar"><div className="sidebar-heading"><span>连接管理</span><span className="count">{profiles.length}</span></div>
        <button className="new-connection" onClick={() => openEditor()}><Plus size={16}/>新建连接<kbd>⌘N</kbd></button>
        <div className="host-search"><Search size={14}/><input aria-label="搜索连接" placeholder="搜索名称、主机或分组" value={filter} onChange={e => setFilter(e.target.value)}/></div>
        <div className="host-tree">{groups.map(group => <div className="host-group" key={group}>
          <button className="group-heading" onClick={() => setCollapsed(prev => prev.includes(group) ? prev.filter(g => g !== group) : [...prev, group])}>{collapsed.includes(group) ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}<Folder size={14}/><span>{group}</span><small>{filtered.filter(p => p.group === group).length}</small></button>
          {!collapsed.includes(group) && filtered.filter(p => p.group === group).map(profile => <div className={`host-row ${selected?.profile.id === profile.id ? 'selected' : ''}`} key={profile.id}>
            <button className="host-open" onClick={() => openEditor(profile)} title={`连接 ${profile.username}@${profile.host}`}><Server size={16} className={`color-${profile.color}`}/><span><strong>{profile.name}</strong><small>{profile.username}@{profile.host}</small></span>{sessions.some(s => s.profile.id === profile.id && s.status === 'connected') && <i className="status-dot connected"/>}</button>
            <button className="host-edit icon-button" title={`编辑 ${profile.name}`} onClick={() => openEditor(profile)}><Pencil size={12}/></button>
          </div>)}
        </div>)}{!profiles.length && <div className="sidebar-empty"><Server size={24}/><p>服务器，从这里开始</p><span>保存常用连接，按环境分组。</span></div>}{profiles.length > 0 && !filtered.length && <p className="muted empty-filter">没有匹配的连接</p>}</div>
        <div className="sidebar-tools"><button onClick={() => setTool('connections')}>连接批量管理</button><button onClick={() => setTool('credentials')}>安全凭据</button><button onClick={() => window.harbor.openLogs().catch(e => reportError(message(e)))}>打开日志目录</button></div><div className="sidebar-bottom"><ShieldCheck size={17}/><div><strong>本地工作区</strong><span>配置留在本机 · 凭据可选安全保存</span></div></div>
      </aside>
      <main className="workspace"><div className="workspace-toolbar"><div className="workspace-label"><Terminal size={16}/><strong>终端工作区</strong><span>{connected.length} 个已连接</span></div><div className="layout-tools"><div className="segmented"><button title="单终端" aria-label="单终端" className={layout === 'single' ? 'on' : ''} onClick={() => changeLayout('single')}><Square size={15}/></button><button title="双栏分屏" aria-label="双栏分屏" className={layout === 'columns' ? 'on' : ''} onClick={() => changeLayout('columns')}><Columns2 size={15}/></button><button title="四宫格分屏" aria-label="四宫格分屏" className={layout === 'grid' ? 'on' : ''} onClick={() => changeLayout('grid')}><Grid2X2 size={15}/></button></div><span className="tool-divider"/><button title="减小字体" className="icon-button" onClick={() => setFontSize(v => Math.max(10, v - 1))}><Minus size={13}/></button><span className="font-size">{fontSize}</span><button title="增大字体" className="icon-button" onClick={() => setFontSize(v => Math.min(22, v + 1))}><Plus size={13}/></button><span className="tool-divider"/><button title="切换文件面板" aria-label="切换文件面板" className={`icon-button ${files ? 'accent' : ''}`} onClick={() => setFiles(!files)}><PanelRight size={16}/></button></div></div>
        <div className="tab-bar" role="tablist" aria-label="SSH 会话">{sessions.map(s => <div className={`session-tab ${active === s.id ? 'active' : ''}`} key={s.id}><button role="tab" aria-selected={active === s.id} onClick={() => selectSession(s.id)}><i className={`status-dot ${s.status}`}/><span>{s.profile.name}</span></button><button className="tab-close" title={`关闭 ${s.profile.name}`} onClick={() => close(s.id)}><X size={12}/></button></div>)}<button className="tab-add" title="添加 SSH 会话" onClick={() => openEditor()}><Plus size={16}/></button></div>
        <div className="terminal-and-files"><div className="terminal-area">
          {!sessions.length ? <div className="welcome"><div className="welcome-mark"><Anchor size={38} strokeWidth={1.25}/></div><div className="eyebrow">A QUIETER PLACE TO OPERATE</div><h1>每个连接，都井然有序。</h1><p>连接服务器、并排查看终端，<br/>把重复操作交给批量命令。</p><button className="primary" onClick={() => openEditor()}><Plus size={16}/>添加第一个 SSH 连接<span>⌘N</span></button><div className="welcome-features"><span><Columns2 size={17}/>多会话分屏</span><span><Send size={17}/>明确目标的批量发送</span><span><Folder size={17}/>SFTP 文件传输</span></div><div className="welcome-footnote"><ShieldCheck size={13}/>首次连接验证主机指纹，凭据保存由你选择。</div></div> : <div className={`terminal-grid layout-${layout}`}>
            {sessions.map((s, sessionIndex) => {
              const slotIndex = paneSlots.slice(0, slotCount).indexOf(s.id);
              const visible = slotIndex >= 0;
              return <TerminalPane key={s.id} session={s} authRequest={authRequests.find(request => request.id === s.id && request.presentation === 'terminal')} onAuthDone={token => setAuthRequests(prev => prev.filter(request => request.token !== token))} inputBlocked={inputBlocked} visible={visible} active={active === s.id} slotOrder={visible ? slotIndex : slotCount + sessionIndex + 4} fontSize={fontSize} takeCredentials={takeCredentials} onFocus={() => visible ? focusPane(s.id, slotIndex) : selectSession(s.id)} onReconnect={() => prepareReconnect(s)} onError={reportError}/>;
            })}
            {layout !== 'single' && paneSlots.slice(0, slotCount).map((id, index) => id && sessions.some(s => s.id === id) ? null : <button className="add-pane" key={`empty-${index}`} style={{ order: index }} onClick={() => openEditor()}><Plus size={25}/><span>连接另一台服务器</span><small>并排比较输出</small></button>)}
          </div>}
        </div>{files && <FilePanel session={selected} transfers={transfers.filter(t => t.id === active)} reportError={reportError} notify={notify}/>}</div>
        <section className="command-bar"><div className="command-top"><span className="command-title"><Send size={14}/>批量命令</span><button title="命令库 ⌘⇧P" onClick={() => setTool('commands')}>命令库</button><span className="target-summary">已选择 {targets.length} 个会话</span><button onClick={() => setTargets(connected.map(s => s.id))} disabled={!connected.length || sending}>全选已连接</button><button onClick={() => setTargets([])} disabled={!targets.length || sending}>清空</button><span className="command-hint">确认目标后发送 · 不同步键盘输入</span></div>
          <div className="target-list">{connected.length ? connected.map(s => <label className={`target-chip ${targets.includes(s.id) ? 'checked' : ''}`} key={s.id}><input type="checkbox" aria-label={`批量目标 ${s.profile.name}`} checked={targets.includes(s.id)} disabled={sending} onChange={e => setTargets(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id))}/><span>{s.profile.name}</span><small>{s.profile.host}</small></label>) : <span className="muted">连接服务器后，可在这里选择发送目标。</span>}</div>
          <div className="command-input-row"><span className="prompt-symbol">›_</span><textarea aria-label="批量命令" placeholder="输入命令，例如 uname -a；发送前会展示目标和完整命令" value={command} maxLength={16384} onChange={e => setCommand(e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }}/><button className="primary send-button" disabled={!targets.length || !command.trim() || sending} onClick={send}><Send size={14}/>{sending ? '等待确认…' : '预览并发送'}</button></div>
        </section>
      </main>
    </div>
    <footer className="statusbar"><span><i className={`status-dot ${connected.length ? 'connected' : 'disconnected'}`}/>{connected.length ? `${connected.length} 个 SSH 连接` : '准备就绪'}</span><span>{layout === 'single' ? '单终端' : layout === 'columns' ? '双栏分屏' : '四宫格分屏'} · UTF-8 · xterm-256color</span><span>{selected ? `${selected.profile.host}:${selected.profile.port}` : 'SSHUltra · macOS Preview'}</span></footer>
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role="status">{notice.error ? <AlertCircle size={18}/> : <Check size={18}/>}<span>{notice.text}</span><button title="关闭提示" onClick={() => setNotice(null)}><X size={15}/></button></div>}
    {editor && <ConnectionEditor profiles={profiles} credentials={savedCredentials} key={editor.instance} initial={editor.initial} onClose={() => setEditor(null)} onConnect={(profile, secrets) => editor.reconnectId ? reconnect(editor.reconnectId, profile, secrets) : connect(profile, secrets)} onSaved={profile => { if (editor.reconnectId) setSessions(prev => prev.map(session => session.id === editor.reconnectId ? { ...session, profile } : session)); setEditor(null); notify('连接已保存'); }} reportError={reportError}/>}
    {tool === 'commands' && <CommandLibrary commands={commands} recent={recentCommands} initialBody={command} onUse={setCommand} onClose={() => setTool(null)} reportError={reportError}/>}
    {tool === 'connections' && <ConnectionManager profiles={profiles} credentials={savedCredentials} onClose={() => setTool(null)} reportError={reportError}/>}
    {tool === 'credentials' && <CredentialManager credentials={savedCredentials} available={credentialAvailable} onClose={() => setTool(null)} reportError={reportError}/>}
    {modalAuth && <AuthenticationDialog key={modalAuth.token} request={modalAuth} onDone={() => setAuthRequests(prev => prev.filter(p => p.token !== modalAuth.token))} reportError={reportError}/>}
    {help && <Modal label="使用帮助" onClose={() => setHelp(false)} backdropClose><section className="modal help-modal"><div className="modal-heading"><h2>开始使用 SSHUltra</h2><button title="关闭帮助" onClick={() => setHelp(false)}><X size={18}/></button></div><p>先添加服务器。主机、用户名、认证方式和分组会保存在本机；密码与私钥口令可在本次输入，或引用用户选择保存的安全凭据。</p><ol><li><strong>分屏：</strong>先打开多个会话，再选择双栏或四宫格。最多显示 4 个终端，切换标签可查看其他会话。</li><li><strong>批量命令：</strong>勾选目标 → 输入命令 → 预览并确认。命令发送到当前终端程序，请先检查提示符。</li><li><strong>文件：</strong>双击目录进入，点击下载箭头保存文件。上传同名文件会失败；失败的上传可能留下部分文件，需要在远端检查。</li><li><strong>快捷键：</strong>⌘N 新建连接，⌘⇧N 新窗口，⌘F 搜索终端，⌘Enter 预览批量命令。</li></ol><p className="muted">当前为首版预览：最多 12 个会话／窗口；已支持单级 SSH 跳板、交互认证、命令库、配置迁移和可选持续日志；目录递归传输仍未包含。滚屏导出仅包含当前回滚缓冲区（最多 10000 行），不等同于完整审计日志。</p><button className="primary" onClick={() => setHelp(false)}>开始使用</button></section></Modal>}
  </div>;
}

function ConnectionEditor({ profiles, credentials, initial, onClose, onConnect, onSaved, reportError }: { profiles: Profile[]; credentials: SavedCredential[]; initial: Partial<Profile>; onClose: () => void; onConnect: (p: Profile, c: Credentials) => void; onSaved: (profile: Profile) => void; reportError: (m: string) => void }) {
  const [form, setForm] = useState({ ...blank, ...initial });
  const [jumpPassword, setJumpPassword] = useState(''); const [jumpPassphrase, setJumpPassphrase] = useState('');
  const jump = profiles.find(p => p.id === form.jumpProfileId);
  const [password, setPassword] = useState(''); const [passphrase, setPassphrase] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const update = (field: keyof Profile, value: string | number) => setForm(prev => ({ ...prev, [field]: value }));
  const save = async (connect: boolean) => {
    setBusy(true); setError('');
    try {
      const p = await window.harbor.saveProfile(form);
      if (connect) onConnect(p, { password, passphrase, jump: { password: jumpPassword, passphrase: jumpPassphrase } }); else onSaved(p);
      setPassword(''); setPassphrase(''); setJumpPassword(''); setJumpPassphrase('');
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  return <Modal label="SSH 连接" onClose={() => { if (!busy) onClose(); }}><form className="modal connection-modal" onSubmit={e => { e.preventDefault(); void save(true); }}><div className="modal-heading"><div className="modal-title-icon"><Server size={20}/><div><h2>{initial.id ? '连接到服务器' : '新建 SSH 连接'}</h2><p>把常用服务器加入你的工作区</p></div></div><button type="button" title="关闭连接设置" onClick={onClose}><X size={19}/></button></div>
    <div className="form-grid"><label>连接名称<input autoFocus placeholder="例如：生产 · Web 01" value={form.name} onChange={e => update('name', e.target.value)}/></label><label>分组<input placeholder="例如：生产环境" value={form.group} onChange={e => update('group', e.target.value)}/></label><label className="host-field">主机地址<input required placeholder="192.168.1.10 或 hostname" value={form.host} onChange={e => update('host', e.target.value)}/></label><label>端口<input required type="number" min="1" max="65535" value={form.port} onChange={e => update('port', Number(e.target.value))}/></label><label>用户名<input required autoComplete="off" placeholder="例如：ops" value={form.username} onChange={e => update('username', e.target.value)}/></label><label>认证方式<select aria-label="认证方式" value={form.authType} onChange={e => update('authType', e.target.value)}><option value="password">密码</option><option value="key">私钥文件</option><option value="agent">系统 SSH Agent</option><option value="interactive">验证码／交互认证</option></select></label></div>
    <label className="full-field">安全凭据<select aria-label="连接安全凭据" value={form.credentialId} onChange={e => update('credentialId', e.target.value)}><option value="">本次输入（不保存）</option>{form.credentialId && !credentials.some(c => c.id === form.credentialId) && <option value={form.credentialId}>原安全凭据不可用，请选择本次输入</option>}{credentials.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    {form.authType === 'password' && !form.credentialId && <label className="full-field">密码<input type="password" autoComplete="new-password" placeholder="可留空，连接时在终端区域输入" value={password} onChange={e => setPassword(e.target.value)}/></label>}
    {form.authType === 'key' && <><label className="full-field">私钥文件<div className="key-picker"><input placeholder="选择本机私钥文件" value={form.keyPath} onChange={e => update('keyPath', e.target.value)}/><button type="button" onClick={async () => { try { const key = await window.harbor.pickKey(); if (key) update('keyPath', key); } catch (e) { setError(message(e)); } }}><Folder size={15}/>选择</button></div></label><label className="full-field" style={{ display: form.credentialId ? 'none' : undefined }}>私钥口令（如有）<input type="password" autoComplete="new-password" value={passphrase} onChange={e => setPassphrase(e.target.value)} placeholder="仅用于本次连接"/></label></>}
    {form.authType === 'agent' && <p className="info-note"><KeyRound size={16}/>使用系统 SSH_AUTH_SOCK 指向的 Agent。</p>}
    <label className="full-field">跳板连接<select aria-label="跳板连接" value={form.jumpProfileId} onChange={e => { update('jumpProfileId', e.target.value); setJumpPassword(''); setJumpPassphrase(''); }}><option value="">直连</option>{profiles.filter(p => p.id !== form.id && !p.jumpProfileId).map(p => <option key={p.id} value={p.id}>{p.name} · {p.host}:{p.port}</option>)}</select></label>
    {jump && !jump.credentialId && jump.authType === 'password' && <label className="full-field">跳板密码<input type="password" autoComplete="off" value={jumpPassword} onChange={e => setJumpPassword(e.target.value)}/></label>}
    {jump && !jump.credentialId && jump.authType === 'key' && <label className="full-field">跳板私钥口令<input type="password" autoComplete="off" value={jumpPassphrase} onChange={e => setJumpPassphrase(e.target.value)}/></label>}
    <label className="full-field inline-check"><input type="checkbox" aria-label="连接后自动记录日志" checked={form.logEnabled} onChange={e => setForm(p => ({ ...p, logEnabled: e.target.checked }))}/>连接后自动记录日志</label>
    {form.logEnabled && <><p className="log-warning">日志包含服务器回显，可能含敏感内容；可随时在终端标题停止记录。</p><label className="full-field">日志保留期限<select aria-label="日志保留期限" value={form.logRetentionDays} onChange={e => setForm(p => ({ ...p, logRetentionDays: Number(e.target.value) }))}><option value={0}>永久保留（手动清理）</option><option value={7}>7 天，自动清理过期日志</option><option value={30}>30 天，自动清理过期日志</option><option value={90}>90 天，自动清理过期日志</option></select></label></>}
    <div className="form-bottom"><span>连接标记</span>{['teal', 'blue', 'amber', 'rose'].map(color => <button type="button" key={color} aria-label={`${color} 标记`} className={`color-choice color-${color} ${form.color === color ? 'chosen' : ''}`} onClick={() => update('color', color)}><span/></button>)}</div>
    <div className="info-note"><ShieldCheck size={16}/><span>首次连接需核对主机指纹。连接仅引用选定的安全凭据；本次输入不会保存。</span></div>{error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer">{initial.id && <button type="button" className="danger-link" disabled={busy} onClick={async () => { try { if (await window.harbor.deleteProfile(initial.id!)) onClose(); } catch (e) { reportError(message(e)); } }}><Trash2 size={14}/>删除连接</button>}<div className="spacer"/><button type="button" disabled={busy} className="secondary" onClick={() => save(false)}>仅保存</button><button type="submit" className="primary" disabled={busy}><Terminal size={15}/>{busy ? '正在保存…' : '保存并连接'}</button></div>
  </form></Modal>;
}

function FilePanel({ session, transfers, reportError, notify }: { session?: Session; transfers: Transfer[]; reportError: (m: string) => void; notify: (m: string) => void }) {
  const [directory, setDirectory] = useState(''); const [pathInput, setPathInput] = useState(''); const [entries, setEntries] = useState<Entry[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const generation = useRef(0);
  const sessionId = session?.id; const connected = session?.status === 'connected';
  const currentSession = useRef(sessionId); currentSession.current = sessionId;
  const list = useCallback(async (path: string) => {
    if (!sessionId || !connected || currentSession.current !== sessionId) return;
    const version = ++generation.current; setLoading(true); setError('');
    try { const result = await window.harbor.list(sessionId, path); if (generation.current === version) { setDirectory(result.path); setPathInput(result.path); setEntries(result.entries); } }
    catch (e) { if (generation.current === version) setError(message(e)); }
    finally { if (generation.current === version) setLoading(false); }
  }, [sessionId, connected]);
  useEffect(() => { setDirectory(''); setPathInput(''); setEntries([]); setError(''); setLoading(false); if (connected) void list('.'); return () => { generation.current++; }; }, [list, connected]);
  const childPath = (name: string) => `${directory.replace(/\/$/, '')}/${name}`;
  const upload = async () => {
    if (!sessionId || !directory) return;
    try { const result = await window.harbor.upload(sessionId, directory); if (result) { notify(`上传完成 · ${prettyBytes(result.bytes)}`); void list(directory); } } catch (e) { reportError(`上传失败：${message(e)}。若文件已部分写入，请在远端检查。`); }
  };
  return <aside className="file-panel"><div className="file-heading"><span><Folder size={15}/>远程文件</span><span className="badge">SFTP</span></div>
    {connected ? <><div className="file-host"><i className="status-dot connected"/>{session?.profile.name}</div><form className="path-form" onSubmit={e => { e.preventDefault(); void list(pathInput); }}><input aria-label="远程路径" value={pathInput} onChange={e => setPathInput(e.target.value)} placeholder="输入目录路径"/><button title="打开目录"><ChevronRight size={14}/></button></form><div className="file-tools"><button title="上级目录" disabled={!directory || loading} onClick={() => list(directory === '/' ? '/' : directory.slice(0, directory.lastIndexOf('/')) || '/')}><ArrowUp size={14}/></button><button title="刷新文件" disabled={loading} onClick={() => list(directory || '.')}><RefreshCw size={14} className={loading ? 'spin' : ''}/></button><button title="取消文件操作" disabled={!loading && !transfers.some(t => t.status === 'running')} onClick={() => window.harbor.cancelFiles(sessionId!).catch(e => reportError(message(e)))}>取消</button><span/><button disabled={!directory} onClick={upload}><Upload size={14}/>上传文件</button></div>{error && <div className="file-error">{error}<button onClick={() => list(directory || '.')}>重试</button></div>}<div className="file-list">{entries.map(entry => <div className="file-row" key={entry.name}><button className="file-name" title={entry.name} onDoubleClick={() => { if (entry.symlink && !entry.directory) void list(childPath(entry.name)); }} onClick={() => { if (entry.directory) void list(childPath(entry.name)); }}>{entry.directory ? <Folder size={16} className="folder-icon"/> : <File size={16}/>}<span>{entry.name}{entry.symlink ? ' ↗' : ''}</span></button>{!entry.directory && <><small>{prettyBytes(entry.size)}</small><button title={`下载 ${entry.name}`} className="download-file" onClick={async () => { try { const result = await window.harbor.download(sessionId!, childPath(entry.name)); if (result) notify(`下载完成 · ${prettyBytes(result.bytes)}`); } catch (e) { reportError(message(e)); } }}><Download size={13}/></button></>}</div>)}{!entries.length && !loading && !error && <div className="file-empty-small">目录为空</div>}</div><div className="file-caption">{entries.length} 个项目 · 同名上传不覆盖</div></> : <div className="file-empty"><Folder size={32} strokeWidth={1.2}/><strong>文件随连接就绪</strong><p>连接服务器后，<br/>在这里浏览、上传和下载文件。</p></div>}
    {!!transfers.length && <div className="transfers"><div className="transfer-heading">最近传输</div>{transfers.slice(0, 3).map(t => <div className={`transfer-row ${t.status === 'error' ? 'failed' : ''}`} key={t.transferId}>{t.direction === 'upload' ? <Upload size={13}/> : <Download size={13}/>}<span title={t.name}>{t.name}<small>{prettyBytes(t.bytes)} · {t.status === 'done' ? '完成' : t.status === 'error' ? '失败' : '传输中'}</small></span>{t.status === 'done' && <Check size={13}/>}</div>)}</div>}
  </aside>;
}
