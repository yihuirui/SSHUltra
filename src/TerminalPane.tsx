import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Search, X, Download, RotateCw, ChevronDown, ChevronUp, Circle } from 'lucide-react';
import type { AuthRequest, Credentials, Session } from './types';
import '@xterm/xterm/css/xterm.css';

const labels = { connecting: '连接中', connected: '已连接', disconnected: '已断开', error: '连接失败' };
const MAX_TERMINAL_INPUT_BYTES = 64 * 1024;
export function TerminalPane({ session, authRequest, onAuthDone, inputBlocked, visible, active, fontSize, slotOrder, takeCredentials, onFocus, onReconnect, onError }: {
  session: Session; inputBlocked: boolean; visible: boolean; active: boolean; fontSize: number; slotOrder: number;
  authRequest?: AuthRequest; onAuthDone: (token: string) => void;
  takeCredentials: (id: string) => Credentials; onFocus: () => void; onReconnect: () => void; onError: (message: string) => void;
}) {
  const blocked = useRef(inputBlocked); blocked.current = inputBlocked || Boolean(authRequest);
  const element = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(true);
  const initial = useRef({ session, takeCredentials, onError });
  useEffect(() => {
    const { session: s, takeCredentials: take, onError: error } = initial.current;
    let lastInputNotice = 0;
    const showInputError = (text: string) => {
      const now = Date.now();
      if (now - lastInputNotice < 1000) return;
      lastInputNotice = now;
      error(text);
    };
    const term = new Terminal({ cursorBlink: true, fontSize, fontFamily: '"SFMono-Regular", Menlo, Monaco, monospace',
      lineHeight: 1.25, scrollback: 10000, allowProposedApi: false, convertEol: false,
      theme: { background: '#10151d', foreground: '#d5dde9', cursor: '#67dfc0', selectionBackground: '#294c56',
        black: '#18212d', red: '#ef8a91', green: '#8bd6a4', yellow: '#e3c887', blue: '#8aaff2', magenta: '#c6a2e9', cyan: '#79c9d5', white: '#e4eaf2' } });
    const f = new FitAddon(); const find = new SearchAddon();
    term.loadAddon(f); term.loadAddon(find); term.open(element.current!);
    terminal.current = term; fit.current = f; search.current = find;
    const resize = () => { if (element.current?.clientWidth && element.current?.clientHeight) { f.fit(); void window.harbor.resize(s.id, term.cols, term.rows).catch(() => {}); } };
    const observer = new ResizeObserver(resize); observer.observe(element.current!);
    const off = window.harbor.onEvent(event => {
      if (event.type === 'data' && event.id === s.id) {
        const bytes = Uint8Array.from(atob(event.data), c => c.charCodeAt(0));
        term.write(bytes, () => { void window.harbor.ack(s.id, event.bytes).catch(() => {}); });
      }
    });
    const paste = (event: ClipboardEvent) => {
      if (blocked.current) { event.preventDefault(); event.stopPropagation(); return; }
      const data = event.clipboardData?.getData('text/plain') || event.clipboardData?.getData('text') || '';
      if (new TextEncoder().encode(data).byteLength <= MAX_TERMINAL_INPUT_BYTES) return;
      event.preventDefault();
      event.stopPropagation();
      showInputError('粘贴内容超过 64 KiB，本次未发送。请拆分后重试。');
    };
    element.current?.addEventListener('paste', paste, true);
    const input = term.onData(data => {
      if (blocked.current) return;
      if (new TextEncoder().encode(data).byteLength > MAX_TERMINAL_INPUT_BYTES) {
        showInputError('单次终端输入超过 64 KiB，本次未发送。请拆分后重试。');
        return;
      }
      void window.harbor.input(s.id, data).catch(e => showInputError(`终端输入未发送：${e instanceof Error ? e.message : String(e)}`));
    });
    term.attachCustomKeyEventHandler(event => {
      if (blocked.current) return false;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        if (event.type === 'keydown') setSearching(true);
        return false;
      }
      return true;
    });
    resize();
    return () => { off(); observer.disconnect(); element.current?.removeEventListener('paste', paste, true); input.dispose(); term.dispose(); terminal.current = null; void window.harbor.disconnect(s.id).catch(() => {}); };
  }, []);
  const attemptedConnect = useRef<number | null>(null);
  useEffect(() => {
    if (attemptedConnect.current === session.connectAttempt) return;
    attemptedConnect.current = session.connectAttempt;
    const credentials = takeCredentials(session.id);
    const term = terminal.current;
    const request = window.harbor.connect(session.id, session.profile, credentials, { cols: term?.cols || 100, rows: term?.rows || 30 });
    // IPC structured-clones credentials; clear this renderer copy immediately.
    delete credentials.password; delete credentials.passphrase;
    if (credentials.jump) { delete credentials.jump.password; delete credentials.jump.passphrase; delete credentials.jump; }
    void request.catch(e => onError(`连接失败：${e instanceof Error ? e.message : String(e)}`));
  }, [session.connectAttempt, session.id, session.profile, takeCredentials, onError]);
  useEffect(() => {
    if (terminal.current) terminal.current.options.fontSize = fontSize;
    if (visible && element.current?.clientWidth) {
      const frame = requestAnimationFrame(() => {
        fit.current?.fit();
        const term = terminal.current;
        if (term) { void window.harbor.resize(session.id, term.cols, term.rows).catch(() => {}); if (active && !searching && !inputBlocked && !authRequest) term.focus(); }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [visible, active, fontSize, searching, inputBlocked, authRequest, session.id]);
  const find = (direction = 'next') => {
    if (!query) return;
    setFound(Boolean(direction === 'next' ? search.current?.findNext(query) : search.current?.findPrevious(query)));
  };
  const exportContent = async () => {
    const buffer = terminal.current?.buffer.active;
    if (!buffer) return;
    const lines = Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) || '');
    try { await window.harbor.exportScrollback(lines.join('\n')); } catch (e) { onError((e as Error).message); }
  };
  return <section className={`terminal-pane ${active ? 'focused' : ''}`} style={{ display: visible ? 'flex' : 'none', order: slotOrder }} onMouseDown={onFocus} data-testid="terminal-pane" data-session-id={session.id}>
    <div className="pane-header"><div className="pane-identity"><i className={`status-dot ${session.status}`} /><strong>{session.profile.name}</strong><span>{session.profile.username}@{session.profile.host}</span></div>
      <div className="pane-actions"><button className={`icon-button ${session.logging ? 'logging-on' : ''}`} title={session.logging ? '停止持续日志' : '开始持续日志'} onClick={() => window.harbor.setLogging(session.id, !session.logging).catch(e => onError(String(e.message)))} disabled={session.status !== 'connected'}><Circle size={12}/>{session.logging && <span>记录中</span>}</button><span className="connection-label">{labels[session.status]}</span>
        <button className="icon-button" title="搜索终端 ⌘F" onClick={() => setSearching(!searching)}><Search size={14}/></button>
        <button className="icon-button" title="导出回滚内容" onClick={exportContent}><Download size={14}/></button>
      </div></div>
    {searching && <form className="terminal-search" onSubmit={e => { e.preventDefault(); find(); }}><input autoFocus aria-label="搜索终端" placeholder="搜索终端内容" value={query} onChange={e => { setQuery(e.target.value); setFound(true); }}/>{!found && <small>未找到</small>}<button type="button" title="上一个" onClick={() => find('previous')}><ChevronUp size={14}/></button><button title="下一个"><ChevronDown size={14}/></button><button type="button" title="关闭搜索" onClick={() => setSearching(false)}><X size={14}/></button></form>}
    <div className="terminal-host" ref={element}/>
    {authRequest && <TerminalPassword key={authRequest.token} request={authRequest} focused={active && visible && !inputBlocked} onDone={onAuthDone} onError={onError}/>}
    {(session.status === 'error' || session.status === 'disconnected') && <div className="disconnected-bar"><span>{session.message || '连接已关闭，终端内容仍保留。'}</span><button onClick={onReconnect}><RotateCw size={13}/>重新连接</button></div>}
  </section>;
}

function TerminalPassword({ request, focused, onDone, onError }: { request: AuthRequest; focused: boolean; onDone: (token: string) => void; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (focused) input.current?.focus(); }, [focused]);
  useEffect(() => {
    const field = input.current;
    return () => { if (field) field.value = ''; };
  }, []);
  const answer = async (cancel = false) => {
    if (busy) return;
    setBusy(true);
    const pending = window.harbor.answerAuth(request.token, cancel ? null : [input.current?.value || '']);
    if (input.current) input.current.value = '';
    try { await pending; } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { onDone(request.token); }
  };
  return <form className="terminal-auth" aria-label="终端密码认证" onSubmit={event => { event.preventDefault(); void answer(); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void answer(true); }
  }}>
    <strong>{request.name}</strong>
    <p>{request.username}@{request.host}:{request.port}</p>
    <label>Password:<input ref={input} aria-label="终端连接密码" type="password" required maxLength={16384} autoComplete="off" spellCheck={false} disabled={busy}/></label>
    <small>输入不回显、不保存；60 秒未提交将取消连接。</small>
    <div><button type="button" className="secondary" disabled={busy} onClick={() => answer(true)}>取消连接</button><button className="primary" disabled={busy}>{busy ? '正在认证…' : '继续连接'}</button></div>
  </form>;
}
