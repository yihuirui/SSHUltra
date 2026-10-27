const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { Store } = require('../desktop/store.cjs');
const { SSHManager } = require('../desktop/ssh.cjs');
const { createFixture } = require('./fixture.cjs');

const profile = fixture => ({ name: 'Reliability test', group: 'Tests', host: '127.0.0.1', port: fixture.port, username: 'ops', authType: 'password' });
const waitFor = async (predicate, timeout = 4000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error('Timed out waiting for evidence');
};

function managerWithChannel(channel) {
  const manager = new SSHManager({ store: {}, emit: () => {}, confirmHost: async () => true });
  manager.sessions.set('input', {
    id: 'input', profile: {}, client: {}, channel, sftp: null, pending: 0,
    inputPendingBytes: 0, inputBackpressured: false, closed: false, transfers: new Set()
  });
  return manager;
}

test('shell request deadline destroys an unresponsive request and releases its session ID', { timeout: 10000 }, async t => {
  const fixture = await createFixture({ respondToShell: false });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-shell-timeout-'));
  const events = [];
  const manager = new SSHManager({
    store: new Store(directory), emit: event => events.push(event),
    confirmHost: async () => true, shellTimeoutMs: 180
  });
  t.after(async () => {
    manager.closeAll();
    await fixture.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const started = Date.now();
  await assert.rejects(manager.connect('hung-shell', profile(fixture), { password: fixture.password }), /shell 请求超时/);
  assert.ok(Date.now() - started < 3000, 'shell request should fail within a bounded interval');
  await waitFor(() => manager.sessions.size === 0);
  assert.ok(!events.some(event => event.type === 'status' && event.id === 'hung-shell' && event.status === 'connected'));

  // The same id is reusable after the timed-out SSH connection has actually closed.
  await assert.rejects(manager.connect('hung-shell', profile(fixture), { password: fixture.password }), /shell 请求超时/);
  await waitFor(() => manager.sessions.size === 0);
});

test('closed SSH session IDs can be reused without disturbing another session', { timeout: 10000 }, async t => {
  const fixture = await createFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-session-reuse-'));
  const manager = new SSHManager({ store: new Store(directory), emit: () => {}, confirmHost: async () => true });
  t.after(async () => {
    manager.closeAll();
    await fixture.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await manager.connect('reused', profile(fixture), { password: fixture.password });
  await manager.connect('kept', profile(fixture), { password: fixture.password });
  const keptSession = manager.get('kept');
  manager.disconnect('reused');
  await assert.rejects(manager.connect('reused', profile(fixture), { password: fixture.password }), /会话 ID 无效或重复/);
  await waitFor(() => !manager.sessions.has('reused'));

  await manager.connect('reused', profile(fixture), { password: fixture.password });
  assert.strictEqual(manager.get('kept'), keptSession);
  await manager.write('kept', "printf 'KEEP_SESSION_OK\\n'\r");
  await waitFor(() => fixture.inputs.some(input => input.includes('KEEP_SESSION_OK')));
  manager.closeAll();
  await waitFor(() => manager.sessions.size === 0);
});

test('pre-connect credential and key path failures release IDs for a corrected retry', { timeout: 10000 }, async t => {
  const fixture = await createFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-preflight-retry-'));
  const manager = new SSHManager({ store: new Store(directory), emit: () => {}, confirmHost: async () => true });
  t.after(async () => {
    manager.closeAll();
    await fixture.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await assert.rejects(manager.connect('missing-password', profile(fixture), {}), /请输入密码/);
  assert.equal(manager.sessions.has('missing-password'), false);
  await manager.connect('missing-password', profile(fixture), { password: fixture.password });
  manager.disconnect('missing-password');
  await waitFor(() => !manager.sessions.has('missing-password'));

  const invalidKey = { ...profile(fixture), authType: 'key', keyPath: path.join(directory, 'missing-key') };
  await assert.rejects(manager.connect('invalid-key', invalidKey, {}), /ENOENT|no such file/i);
  assert.equal(manager.sessions.has('invalid-key'), false);
  await manager.connect('invalid-key', profile(fixture), { password: fixture.password });
  assert.ok(manager.get('invalid-key'));
  manager.disconnect('invalid-key');
  await waitFor(() => !manager.sessions.has('invalid-key'));
});

test('terminal input enforces a UTF-8 byte limit and caps outstanding writes in order', async () => {
  const callbacks = [];
  const writes = [];
  const channel = {
    destroyed: false,
    write(data, callback) { writes.push(data); callbacks.push(callback); return true; }
  };
  const manager = managerWithChannel(channel);
  const accepted = '界'.repeat(21845) + 'a';
  const first = manager.write('input', accepted); // exactly 65,536 UTF-8 bytes
  assert.throws(() => manager.write('input', '界'.repeat(21846)), /65536 bytes/);

  const chunk = 'x'.repeat(65536);
  const writesAtLimit = [manager.write('input', chunk), manager.write('input', chunk), manager.write('input', chunk)];
  assert.equal(manager.sessions.get('input').inputPendingBytes, 4 * 65536);
  assert.throws(() => manager.write('input', 'x'), /积压过多/);
  assert.deepEqual(writes, [accepted, chunk, chunk, chunk]);

  for (const callback of callbacks) callback();
  await Promise.all([first, ...writesAtLimit]);
  assert.equal(manager.sessions.get('input').inputPendingBytes, 0);
});

test('terminal input reports channel write errors and releases queued-byte accounting', async () => {
  const channel = { destroyed: false, write(_data, callback) { setImmediate(() => callback(new Error('broken pipe'))); return true; } };
  const manager = managerWithChannel(channel);
  await assert.rejects(manager.write('input', 'hello'), /终端输入写入失败：broken pipe/);
  assert.equal(manager.sessions.get('input').inputPendingBytes, 0);

  channel.write = () => { throw new Error('closed channel'); };
  await assert.rejects(manager.write('input', 'again'), /终端输入写入失败：closed channel/);
  assert.equal(manager.sessions.get('input').inputPendingBytes, 0);
});

test('terminal input stops when the SSH channel reports backpressure and resumes on drain', async () => {
  const channel = new EventEmitter();
  channel.destroyed = false;
  const writes = [];
  let completeWrite;
  channel.write = (data, callback) => { writes.push(data); completeWrite = callback; return false; };
  const manager = managerWithChannel(channel);

  const pending = manager.write('input', 'first');
  assert.throws(() => manager.write('input', 'second'), /通道繁忙/);
  assert.deepEqual(writes, ['first']);
  completeWrite();
  channel.emit('drain');
  await pending;
  assert.equal(manager.sessions.get('input').inputBackpressured, false);

  channel.write = (data, callback) => { writes.push(data); callback(); return true; };
  await manager.write('input', 'second');
  assert.deepEqual(writes, ['first', 'second']);
});

function loadMainWithElectronMock({ lock = true } = {}) {
  const app = new EventEmitter();
  let releaseReady;
  const ready = new Promise(resolve => { releaseReady = resolve; });
  let quitCount = 0;
  app.setName = () => {};
  app.setPath = () => {};
  app.requestSingleInstanceLock = () => lock;
  app.quit = () => { quitCount++; };
  app.whenReady = () => ready;
  app.getPath = () => '/tmp/harbor-main-mock';
  app.getVersion = () => 'test';

  const windows = [];
  let focusedWindow = null;
  class FakeBrowserWindow extends EventEmitter {
    static getAllWindows() { return windows.filter(win => !win.destroyed); }
    static getFocusedWindow() { return focusedWindow && !focusedWindow.destroyed ? focusedWindow : null; }
    constructor() {
      super();
      this.id = windows.length + 1;
      this.destroyed = false;
      this.minimized = false;
      this.visible = true;
      this.focusCount = 0;
      this.restoreCount = 0;
      this.showCount = 0;
      const webContents = new EventEmitter();
      webContents.id = this.id;
      webContents.mainFrame = { url: '' };
      webContents.session = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} };
      webContents.setWindowOpenHandler = () => {};
      this.webContents = webContents;
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return this.minimized; }
    isVisible() { return this.visible; }
    restore() { this.minimized = false; this.visible = true; this.restoreCount++; }
    show() { this.visible = true; this.showCount++; }
    focus() { focusedWindow = this; this.focusCount++; }
    loadURL() { return Promise.resolve(); }
  }

  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  const dialog = { showErrorBox() {}, showMessageBoxSync() { return 0; } };
  const Menu = { setApplicationMenu() {}, buildFromTemplate: template => template };
  const electron = { app, BrowserWindow: FakeBrowserWindow, ipcMain, dialog, Menu };
  let storeCreations = 0;
  class FakeStore { constructor() { storeCreations++; } profiles() { return []; } }
  class FakeSSHManager { constructor() { this.sessions = new Map(); } closeAll() {} }

  const mainPath = require.resolve('../desktop/main.cjs');
  delete require.cache[mainPath];
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (parent?.filename === mainPath && request === 'electron') return electron;
    if (parent?.filename === mainPath && request === './store.cjs') return { Store: FakeStore };
    if (parent?.filename === mainPath && request === './ssh.cjs') return { SSHManager: FakeSSHManager };
    return originalLoad.call(this, request, parent, isMain);
  };
  try { require(mainPath); }
  finally { Module._load = originalLoad; }
  delete require.cache[mainPath];
  return { app, windows, handlers, releaseReady, get quitCount() { return quitCount; }, get storeCreations() { return storeCreations; } };
}

test('second Electron launch without the single-instance lock quits without initializing windows', async () => {
  const mock = loadMainWithElectronMock({ lock: false });
  mock.releaseReady();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(mock.quitCount, 1);
  assert.equal(mock.windows.length, 0);
  assert.equal(mock.storeCreations, 0);
  assert.equal(mock.handlers.size, 0);
});

test('second Electron launch focuses an existing window and creates one if none remains', async () => {
  const mock = loadMainWithElectronMock();
  mock.releaseReady();
  await waitFor(() => mock.windows.length === 1);

  const first = mock.windows[0];
  first.minimized = true;
  first.visible = false;
  mock.app.emit('second-instance');
  assert.equal(mock.windows.length, 1);
  assert.equal(first.restoreCount, 1);
  assert.equal(first.focusCount, 1);

  first.destroyed = true;
  mock.app.emit('second-instance');
  assert.equal(mock.windows.filter(win => !win.destroyed).length, 1);
  assert.equal(mock.windows.length, 2);
});

test('second Electron launch arriving before readiness focuses the first created window', async () => {
  const mock = loadMainWithElectronMock();
  mock.app.emit('second-instance');
  assert.equal(mock.windows.length, 0);
  mock.releaseReady();
  await waitFor(() => mock.windows.length === 1 && mock.windows[0].focusCount === 1);
});
