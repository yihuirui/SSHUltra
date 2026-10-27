const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { Store } = require('./store.cjs');
const { SSHManager } = require('./ssh.cjs');

if (process.env.HARBOR_TEST_MODE === '1' && process.env.HARBOR_DATA_DIR && path.isAbsolute(process.env.HARBOR_DATA_DIR)) {
  app.setPath('userData', process.env.HARBOR_DATA_DIR);
}
app.setName('SSHUltra');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const contexts = new Map();
let store;
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
function createWindow() {
  const win = new BrowserWindow({ width: 1440, height: 930, minWidth: 1000, minHeight: 680,
    title: 'SSHUltra', backgroundColor: '#10151d', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 21 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  const emit = event => { if (!win.isDestroyed()) win.webContents.send('harbor:event', event); };
  const manager = new SSHManager({ store, emit, confirmHost: async info => {
    const answer = await dialog.showMessageBox(win, { type: 'question', title: '确认 SSH 主机指纹',
      message: `首次连接 ${info.host}:${info.port}`,
      detail: `请核对管理员提供的 SHA256 指纹。确认后保存在本机，后续指纹不一致时将阻止连接。\n\n${info.fingerprint}`,
      buttons: ['取消连接', '信任并连接'], defaultId: 0, cancelId: 0, noLink: true });
    return answer.response === 1;
  } });
  const ctx = { win, manager, transfers: 0, batchPending: false };
  contexts.set(win.webContents.id, ctx);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.on('render-process-gone', () => manager.closeAll());
  win.on('close', event => {
    if (manager.sessions.size) {
      const response = dialog.showMessageBoxSync(win, { type: 'question', message: `关闭窗口并断开 ${manager.sessions.size} 个会话？`,
        detail: '该窗口中的文件传输也会停止。', buttons: ['取消', '断开并关闭'], defaultId: 0, cancelId: 0 });
      if (response === 0) { event.preventDefault(); return; }
    }
    manager.closeAll();
  });
  const wcId = win.webContents.id;
  win.on('closed', () => { manager.closeAll(); contexts.delete(wcId); });
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

handle('init', () => ({ profiles: store.profiles(), version: app.getVersion(), platform: process.platform }));
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
handle('connect', ({ manager }, id, profile, credentials, geometry) => manager.connect(id, profile, credentials, geometry));
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
    return { canceled: false, results: ctx.manager.batch(ids, command) };
  } finally { ctx.batchPending = false; }
});
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
  fs.writeFileSync(pick.filePath, content, { mode: 0o600 }); return true;
});
handle('new-window', () => { createWindow(); return true; });
app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  try { store = new Store(app.getPath('userData')); }
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
