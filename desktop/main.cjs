const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { Store } = require('./store.cjs');
const { SSHManager } = require('./ssh.cjs');
const { SessionLog } = require('./logging.cjs');
const { CredentialVault } = require('./vault.cjs');
const { importProfiles, exportProfiles } = require('./migration.cjs');
const { runImport } = require('./import-service.cjs');
const os = require('node:os');
const { atomicWritePrivate } = require('./atomic-file.cjs');

if (process.env.HARBOR_TEST_MODE === '1' && process.env.HARBOR_DATA_DIR && path.isAbsolute(process.env.HARBOR_DATA_DIR)) {
  app.setPath('userData', process.env.HARBOR_DATA_DIR);
}
app.setName('SSHUltra');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const contexts = new Map();
let store;
let vault;
const activeLogs = new Set();
let pendingSecondInstance = false;
const pageURL = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
function context(event) {
  const ctx = contexts.get(event.sender.id);
  if (!ctx || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== pageURL) throw new Error('请求来源无效');
  return ctx;
}
function handle(name, fn) {
  if (!hasSingleInstanceLock) return;
  ipcMain.handle(`harbor:${name}`, async (event, ...args) => {
    try { return { ok: true, value: await fn(context(event), ...args) }; }
    catch (error) { return { ok: false, error: error.message || '操作失败' }; }
  });
}
function broadcastProfiles() {
  for (const { win } of contexts.values()) if (!win.isDestroyed()) win.webContents.send('harbor:event', { type: 'profiles', profiles: store.profiles() });
}
function credentialInput(profile, supplied = {}) {
  if (!supplied || typeof supplied !== 'object') throw new Error('凭据输入无效');
  return profile.credentialId ? vault.read(profile.credentialId) : { password: supplied.password, passphrase: supplied.passphrase };
}
function cancelAuthentication(ctx, id) {
  for (const [token, pending] of ctx.auth) {
    if (!id || pending.id === id) { clearTimeout(pending.timer); ctx.auth.delete(token); pending.resolve(null); }
  }
}
function requestAuthentication(win, info) {
  const ctx = contexts.get(win.webContents.id);
  if (!ctx || win.isDestroyed() || !Array.isArray(info.prompts) || info.prompts.length > 8) return Promise.resolve(null);
  const token = randomUUID();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      ctx.auth.delete(token); resolve(null);
      if (!win.isDestroyed()) win.webContents.send('harbor:event', { type: 'auth-expired', token });
    }, 60000);
    ctx.auth.set(token, { id: info.id, count: info.prompts.length, resolve, timer });
    win.webContents.send('harbor:event', { type: 'auth', token, id: info.id, host: info.host,
      presentation: info.presentation === 'terminal' ? 'terminal' : 'dialog',
      username: String(info.username || '').slice(0, 128), port: info.port,
      name: String(info.name || '').slice(0, 500), instructions: String(info.instructions || '').slice(0, 4096),
      prompts: info.prompts.map(p => ({ prompt: String(p.prompt || '').slice(0, 4096), echo: p.echo === true })) });
  });
}
function createWindow() {
  const win = new BrowserWindow({ width: 1440, height: 930, minWidth: 1000, minHeight: 680,
    title: 'SSHUltra', backgroundColor: '#10151d', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 21 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  const emit = event => {
    const ctx = contexts.get(win.webContents.id);
    if (ctx && event.type === 'status' && ['error', 'disconnected'].includes(event.status)) cancelAuthentication(ctx, event.id);
    if (!win.isDestroyed()) win.webContents.send('harbor:event', event);
  };
  const manager = new SSHManager({ store, emit,
    requestAuth: info => requestAuthentication(win, info),
    logFactory: (profile, onError) => {
      const logger = new SessionLog(path.join(app.getPath('userData'), 'logs'), profile, onError, { onClosed: () => activeLogs.delete(logger) });
      activeLogs.add(logger); return logger;
    },
    confirmHost: async info => {
    const answer = await dialog.showMessageBox(win, { type: 'question', title: '确认 SSH 主机指纹',
      message: `首次连接 ${info.host}:${info.port}`,
      detail: `请核对管理员提供的 SHA256 指纹。确认后保存在本机，后续指纹不一致时将阻止连接。\n\n${info.fingerprint}`,
      buttons: ['取消连接', '信任并连接'], defaultId: 0, cancelId: 0, noLink: true });
    return answer.response === 1;
  } });
  const ctx = { win, manager, transfers: 0, batchPending: false, auth: new Map(), importDraft: null };
  contexts.set(win.webContents.id, ctx);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.on('render-process-gone', () => { ctx.importController?.abort(); clearImportDraft(ctx); cancelAuthentication(ctx); manager.closeAll(); });
  win.on('close', event => {
    if (manager.sessions.size) {
      const response = dialog.showMessageBoxSync(win, { type: 'question', message: `关闭窗口并断开 ${manager.sessions.size} 个会话？`,
        detail: '该窗口中的文件传输也会停止。', buttons: ['取消', '断开并关闭'], defaultId: 0, cancelId: 0 });
      if (response === 0) { event.preventDefault(); return; }
    }
    manager.closeAll();
  });
  const wcId = win.webContents.id;
  win.on('closed', () => { ctx.importController?.abort(); clearImportDraft(ctx); cancelAuthentication(ctx); manager.closeAll(); contexts.delete(wcId); });
  win.loadURL(pageURL);
  return win;
}

function focusOrCreateWindow() {
  const windows = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
  const focused = BrowserWindow.getFocusedWindow?.();
  const win = focused && !focused.isDestroyed() ? focused : windows.at(-1);
  if (!win) {
    if (store) createWindow();
    else pendingSecondInstance = true;
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

if (hasSingleInstanceLock) app.on('second-instance', focusOrCreateWindow);
else app.quit();

handle('init', () => ({ profiles: store.profiles(), commands: store.commands(), credentials: vault.list(), credentialAvailable: vault.available(), vaultWarning: vault.warning, version: app.getVersion(), platform: process.platform }));
handle('save-profile', (_ctx, raw) => { const profile = store.save(raw); broadcastProfiles(); return profile; });
handle('delete-profile', async ({ win }, id) => {
  const p = store.profiles().find(p => p.id === id);
  if (!p) throw new Error('连接不存在');
  const { response } = await dialog.showMessageBox(win, { type: 'question', message: `删除保存的连接“${p.name}”？`, detail: '当前已连接的终端不受影响。', buttons: ['取消', '删除'], defaultId: 0, cancelId: 0 });
  if (response !== 1) return false;
  store.remove(id); broadcastProfiles(); return true;
});
handle('pick-key', async ({ win }) => {
  const result = await dialog.showOpenDialog(win, { title: '选择 SSH 私钥', properties: ['openFile', 'showHiddenFiles'] });
  return result.canceled ? null : result.filePaths[0];
});
handle('connect', ({ manager }, id, profile, credentials = {}, geometry) => {
  const secrets = credentialInput(profile, credentials);
  if (profile.jumpProfileId) {
    const jump = store.profiles().find(p => p.id === profile.jumpProfileId);
    if (!jump) throw new Error('跳板连接不存在');
    secrets.jump = credentialInput(jump, credentials.jump || {});
  }
  return manager.connect(id, profile, secrets, geometry);
});
handle('answer-auth', (ctx, token, answers) => {
  const pending = ctx.auth.get(token); if (!pending) throw new Error('认证请求已过期');
  if (answers !== null && (!Array.isArray(answers) || answers.length !== pending.count || answers.some(v => typeof v !== 'string' || v.length > 16384))) throw new Error('认证回答无效');
  clearTimeout(pending.timer); ctx.auth.delete(token); pending.resolve(answers); return true;
});
handle('set-logging', ({ manager }, id, enabled) => { manager.setLogging(id, enabled); return true; });
handle('open-logs', async () => {
  const directory = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const error = await shell.openPath(directory); if (error) throw new Error('无法打开日志目录'); return true;
});
handle('disconnect', ({ manager }, id) => manager.disconnect(id));
handle('input', ({ manager }, id, data) => manager.write(id, data));
handle('resize', ({ manager }, id, cols, rows) => manager.resize(id, cols, rows));
handle('ack', ({ manager }, id, bytes) => manager.ack(id, bytes));
handle('batch', async (ctx, ids, command) => {
  if (ctx.batchPending) throw new Error('请先处理当前发送确认');
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 12 || new Set(ids).size !== ids.length) throw new Error('目标会话无效');
  if (typeof command !== 'string' || !command.trim() || command.length > 16384) throw new Error('请输入不超过 16384 字符的命令');
  const targets = ids.map(id => ctx.manager.get(id));
  ctx.batchPending = true;
  try {
    const { response } = await dialog.showMessageBox(ctx.win, { type: 'warning', title: '确认批量发送',
      message: `向 ${targets.length} 个 SSH 会话发送并执行命令？`,
      detail: `${targets.map(s => `${s.profile.name} · ${s.profile.username}@${s.profile.host}:${s.profile.port}`).join('\n')}\n\n命令：\n${command}\n\n命令会输入每个终端当前运行的程序；请先确认各终端处于正确提示符。`,
      buttons: ['取消', '发送到以上会话'], defaultId: 0, cancelId: 0, noLink: true });
    if (response !== 1) return { canceled: true, results: [] };
    return { canceled: false, results: await ctx.manager.batch(ids, command) };
  } finally { ctx.batchPending = false; }
});
handle('cancel-files', ({ manager }, id) => manager.cancelFiles(id));
handle('list', ({ manager }, id, directory) => manager.list(id, directory));
handle('upload', async (ctx, id, directory) => {
  ctx.manager.get(id);
  if (typeof directory !== 'string' || !directory.startsWith('/')) throw new Error('请先打开远程目录');
  if (ctx.transfers >= 4) throw new Error('最多同时进行 4 个文件传输');
  ctx.transfers++;
  try {
    const pick = await dialog.showOpenDialog(ctx.win, { title: '上传文件（同名文件不会覆盖）', properties: ['openFile'] });
    if (pick.canceled) return null;
    const local = pick.filePaths[0];
    return await ctx.manager.transfer(id, 'upload', local, path.posix.join(directory, path.basename(local)), randomUUID());
  } finally { ctx.transfers--; }
});
handle('download', async (ctx, id, remote) => {
  ctx.manager.get(id);
  if (typeof remote !== 'string' || !remote.startsWith('/') || remote.includes('\0')) throw new Error('远程文件路径无效');
  if (ctx.transfers >= 4) throw new Error('最多同时进行 4 个文件传输');
  ctx.transfers++;
  try {
    const pick = await dialog.showSaveDialog(ctx.win, { title: '下载文件', defaultPath: path.basename(remote) });
    if (pick.canceled || !pick.filePath) return null;
    return await ctx.manager.transfer(id, 'download', pick.filePath, remote, randomUUID());
  } finally { ctx.transfers--; }
});
handle('export-scrollback', async ({ win }, content) => {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 20 * 1024 * 1024) throw new Error('终端内容过大');
  const pick = await dialog.showSaveDialog(win, { title: '导出当前终端回滚内容', defaultPath: `terminal-${new Date().toISOString().replace(/[:.]/g, '-')}.txt` });
  if (pick.canceled || !pick.filePath) return false;
  atomicWritePrivate(pick.filePath, content); return true;
});
handle('new-window', () => { createWindow(); return true; });
function publishWorkflows() {
  for (const { win } of contexts.values()) if (!win.isDestroyed()) win.webContents.send('harbor:event', { type: 'workflows', commands: store.commands(), credentials: vault.list() });
}
handle('save-command', (_ctx, command) => { const result = store.saveCommand(command); publishWorkflows(); return result; });
handle('delete-command', async ({ win }, id) => {
  if ((await dialog.showMessageBox(win, { message: '删除这条收藏命令？', buttons: ['取消', '删除'], defaultId: 0, cancelId: 0 })).response !== 1) return false;
  store.removeCommand(id); publishWorkflows(); return true;
});
handle('save-credential', async ({ win }, raw) => {
  if ((await dialog.showMessageBox(win, { type: 'question', message: '使用 macOS Keychain 保护并保存此凭据？', detail: '同名凭据的更新会影响引用它的连接。密码和口令不会包含在连接导出文件中。', buttons: ['取消', '保存凭据'], defaultId: 0, cancelId: 0 })).response !== 1) return null;
  const result = vault.save(raw); publishWorkflows(); return result;
});
handle('delete-credential', async ({ win }, id) => {
  if (store.profiles().some(p => p.credentialId === id)) throw new Error('请先解除连接对这组凭据的引用');
  if ((await dialog.showMessageBox(win, { message: '删除这组保存的凭据？', buttons: ['取消', '删除'], defaultId: 0, cancelId: 0 })).response !== 1) return false;
  vault.remove(id); publishWorkflows(); return true;
});
handle('bulk-profiles', async ({ win }, ids, patch) => {
  const before = store.profiles(); const next = store.bulkPreview(ids, patch);
  const detail = before.filter(p => ids.includes(p.id)).map(p => {
    const n = next.find(q => q.id === p.id);
    return p.name + '\n' + Object.keys(patch).map(k => k + ': ' + JSON.stringify(p[k]) + ' → ' + JSON.stringify(n[k])).join('\n');
  }).join('\n\n');
  if ((await dialog.showMessageBox(win, { type: 'warning', message: `更新 ${ids.length} 个连接？`, detail, buttons: ['取消', '应用修改'], defaultId: 0, cancelId: 0 })).response !== 1) return false;
  if (JSON.stringify(before) !== JSON.stringify(store.profiles())) throw new Error('确认期间连接已变化，请重新预览');
  store.replaceProfiles(next); broadcastProfiles(); return true;
});
handle('export-profiles', async ({ win }, ids, includeUsername, includeKeyPath) => {
  const value = exportProfiles(store.profiles(), ids, includeUsername === true, includeKeyPath === true);
  const pick = await dialog.showSaveDialog(win, { title: '导出连接配置', defaultPath: 'connections.sshultra.json' });
  if (pick.canceled || !pick.filePath) return false;
  atomicWritePrivate(pick.filePath, JSON.stringify(value, null, 2)); return true;
});
function importPreview(draft) {
  return { token: draft.token, count: draft.profiles.length, names: draft.profiles.map(p => p.name),
    missingUsernames: draft.profiles.filter(p => !p.username).length, warnings: draft.warnings,
    sheets: draft.sheets, sheet: draft.sheet, format: draft.format,
    rows: draft.profiles.slice(0, 8).map(p => ({ name: p.name, group: p.group || '导入连接', host: p.host, port: p.port ?? 22, username: p.username || '' })) };
}
function clearImportDraft(ctx) { clearTimeout(ctx.importExpiry); ctx.importExpiry = null; ctx.importDraft = null; }
async function parseImportDraft(ctx, buffer, filename, sheet) {
  ctx.importController = new AbortController();
  try {
    const parsed = await runImport(buffer, filename, sheet, ctx.importController.signal);
    clearImportDraft(ctx);
    ctx.importDraft = { ...parsed, buffer: parsed.sheets ? buffer : null, filename, token: randomUUID(), created: Date.now() };
    ctx.importExpiry = setTimeout(() => clearImportDraft(ctx), 10 * 60 * 1000); ctx.importExpiry.unref?.();
    return importPreview(ctx.importDraft);
  } finally { ctx.importController = null; }
}
handle('read-import', async (ctx) => {
  if (ctx.importBusy) throw new Error('请等待当前导入解析完成'); ctx.importBusy = true;
  try {
    const pick = await dialog.showOpenDialog(ctx.win, { title: '导入 Excel、CSV、TXT、Markdown 或 SSH 配置', properties: ['openFile'], filters: [
      { name: '连接清单和配置', extensions: ['xlsx','xls','csv','tsv','txt','md','markdown','json','ini','conf','config'] }, { name: '所有文件', extensions: ['*'] } ] });
    if (pick.canceled) return null;
    clearImportDraft(ctx);
    const file = pick.filePaths[0]; const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('请选择不超过 5 MiB 的导入文件');
    return await parseImportDraft(ctx, fs.readFileSync(file), path.basename(file));
  } finally { ctx.importBusy = false; }
});
handle('select-import-sheet', async (ctx, token, sheet) => {
  if (ctx.importBusy) throw new Error('请等待当前导入解析完成');
  const draft = ctx.importDraft;
  if (!draft || draft.token !== token || Date.now() - draft.created > 10 * 60 * 1000 || typeof sheet !== 'string' || !draft.sheets?.includes(sheet)) throw new Error('工作表预览已过期，请重新选择文件');
  ctx.importBusy = true; clearImportDraft(ctx);
  try { return await parseImportDraft(ctx, draft.buffer, draft.filename, sheet); }
  finally { ctx.importBusy = false; }
});
handle('save-import-template', async ({ win }, format) => {
  if (!['xlsx','csv','txt','md'].includes(format)) throw new Error('模板格式无效');
  const pick = await dialog.showSaveDialog(win, { title: '保存连接导入模板', defaultPath: `connections-template.${format}`, filters: [{ name: '导入模板', extensions: [format] }] });
  if (pick.canceled || !pick.filePath) return false;
  atomicWritePrivate(pick.filePath, fs.readFileSync(path.join(__dirname, `../templates/import-connections.${format}`))); return true;
});
handle('apply-import', async (ctx, token, username) => {
  const draft = ctx.importDraft;
  if (!draft || draft.token !== token || Date.now() - draft.created > 10 * 60 * 1000) throw new Error('导入预览已过期，请重新选择文件');
  const before = store.profiles(); const next = importProfiles(before, draft.profiles, username, os.homedir());
  if ((await dialog.showMessageBox(ctx.win, { type: 'question', message: `新增 ${draft.profiles.length} 个连接？`, detail: '现有连接保留，导入项使用新 ID；主机信任、凭据和自动日志设置不会导入。\n\n' + draft.profiles.map(p => p.name).join('\n'), buttons: ['取消', '新增连接'], defaultId: 0, cancelId: 0 })).response !== 1) return false;
  if (JSON.stringify(before) !== JSON.stringify(store.profiles())) throw new Error('确认期间连接已变化，请重新导入');
  store.replaceProfiles(next); clearImportDraft(ctx); broadcastProfiles(); return true;
});
let quitting = false;
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault(); quitting = true;
  for (const ctx of contexts.values()) { ctx.importController?.abort(); clearImportDraft(ctx); cancelAuthentication(ctx); ctx.manager.closeAll(); }
  for (const log of activeLogs) log.close();
  Promise.all([...activeLogs].map(log => log.flush())).finally(() => app.quit());
});
app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  try { store = new Store(app.getPath('userData')); vault = new CredentialVault(app.getPath('userData'), safeStorage); }
  catch (error) { dialog.showErrorBox('无法读取 SSHUltra 工作区', error.message); app.quit(); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'SSHUltra', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '文件', submenu: [{ label: '新建窗口', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() }, { role: 'close' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'togglefullscreen' }, { role: 'front' }] }
  ]));
  createWindow();
  if (pendingSecondInstance) { pendingSecondInstance = false; focusOrCreateWindow(); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
