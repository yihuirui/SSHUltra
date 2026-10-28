const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { atomicWritePrivate } = require('../desktop/atomic-file.cjs');
const { Store } = require('../desktop/store.cjs');
const { CredentialVault } = require('../desktop/vault.cjs');
const { parseConfig, importProfiles } = require('../desktop/migration.cjs');
const { SSHManager } = require('../desktop/ssh.cjs');
const { createFixture } = require('./fixture.cjs');
const root = path.resolve(__dirname, '..');
function directory(t) { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sshultra-fixes-')); t.after(() => fs.rmSync(p, { recursive: true, force: true })); return p; }
const until = async fn => { const end = Date.now() + 4000; while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 15)); } throw new Error('Fixture evidence timeout'); };

test('failed private exports preserve existing bytes and remove only their own temp file', t => {
  const dir = directory(t); const target = path.join(dir, 'export.json'); fs.writeFileSync(target, 'PREVIOUS BACKUP');
  const io = { ...fs, writeFileSync(fd) { fs.writeFileSync(fd, 'PARTIAL'); throw new Error('ENOSPC synthetic'); } };
  assert.throws(() => atomicWritePrivate(target, 'NEW EXPORT', io), /ENOSPC/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'PREVIOUS BACKUP');
  assert.deepEqual(fs.readdirSync(dir), ['export.json']);
  const renameFails = { ...fs, renameSync() { throw new Error('EACCES synthetic'); } };
  assert.throws(() => atomicWritePrivate(target, 'NEW EXPORT', renameFails), /EACCES/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'PREVIOUS BACKUP'); assert.deepEqual(fs.readdirSync(dir), ['export.json']);
});
test('successful private exports replace 0644 files with 0600 and do not follow a selected symlink', t => {
  const dir = directory(t); const target = path.join(dir, 'export.txt'); fs.writeFileSync(target, 'old'); fs.chmodSync(target, 0o644);
  atomicWritePrivate(target, 'private export'); assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  const original = path.join(dir, 'original.txt'); fs.writeFileSync(original, 'keep original');
  const link = path.join(dir, 'link.txt'); fs.symlinkSync(original, link);
  atomicWritePrivate(link, 'new file'); assert.equal(fs.readFileSync(original, 'utf8'), 'keep original');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), false); assert.equal(fs.statSync(link).mode & 0o777, 0o600);
});
test('v1 migration preserves data, takes an exact private backup once and old reader rejects v2', t => {
  const dir = directory(t); const file = path.join(dir, 'workspace.json');
  const original = JSON.stringify({ version: 1, profiles: [{ id: 'profile', host: 'fixture.test', username: 'ops', logEnabled: true, credentialId: 'ref' }], knownHosts: { fixture: 'synthetic' }, commands: [{ id: 'command', name: 'Inspection', folder: 'Review', body: 'uname -a' }] });
  fs.writeFileSync(file, original);
  const store = new Store(dir); const state = JSON.parse(fs.readFileSync(file));
  assert.equal(state.version, 2); assert.equal(store.commands().length, 1); assert.equal(store.profiles()[0].credentialId, 'ref'); assert.equal(store.profiles()[0].logEnabled, true);
  const backups = fs.readdirSync(dir).filter(f => f.startsWith('workspace-v1-backup-'));
  assert.equal(backups.length, 1); assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), original); assert.equal(fs.statSync(path.join(dir, backups[0])).mode & 0o777, 0o600);
  new Store(dir); assert.equal(fs.readdirSync(dir).filter(f => f.startsWith('workspace-v1-backup-')).length, 1);
  // Frozen shipped legacy code keeps this check independent of Git HEAD and checkout history.
  const LegacyStore = require('./fixtures/store-v1.cjs').Store;
  const before = fs.readFileSync(file);
  assert.throws(() => new LegacyStore(dir), /工作区配置损坏/);
  assert.deepEqual(fs.readFileSync(file), before);
});
test('profile revisions reject stale editors and deleted profiles while current updates succeed', t => {
  const store = new Store(directory(t)); const old = store.save({ host: 'fixture.test', username: 'ops' });
  store.replaceProfiles(store.bulkPreview([old.id], { host: 'updated.test', group: 'New group' }));
  assert.throws(() => store.save({ ...old, group: 'stale' }), /已被其他操作更新/);
  const latest = store.profiles()[0]; assert.equal(latest.host, 'updated.test');
  const updated = store.save({ ...latest, name: 'Current editor' }); assert.equal(updated.revision, latest.revision + 1);
  store.remove(updated.id); assert.throws(() => store.save(updated), /已删除/);
});
test('imports reject unsupported inheritance in every scope and keep JSON IDs separate from names', () => {
  for (const text of ['Include ~/.ssh/conf.d/*\nHost app\nUser ops\n', 'ProxyCommand ssh gateway -W %h:%p\nHost app\nUser ops\n', 'Host *\nProxyCommand ssh gateway -W %h:%p\nHost app\nUser ops\n', 'Host app\nInclude another-file\n', 'Match exec anything\nHost app\nUser ops\n']) assert.throws(() => parseConfig(text, 'config'), /不支持|无法安全迁移/);
  const source = [{ id: 'gateway', name: 'Gateway', host: 'jump.test', username: 'ops' }, { id: 'other', name: 'gateway', host: 'other.test', username: 'ops' }, { id: 'target', name: 'Target', host: 'target.test', username: 'ops', jumpProfileId: 'gateway' }];
  const next = importProfiles([], source); assert.equal(next[2].jumpProfileId, next[0].id); assert.notEqual(next[2].jumpProfileId, next[1].id);
});
test('damaged optional vault preserves the source and disables only saved credentials', t => {
  const dir = directory(t); const file = path.join(dir, 'credentials.enc.json'); fs.writeFileSync(file, '{');
  const vault = new CredentialVault(dir, { isEncryptionAvailable() { throw new Error('must not access Keychain'); } }, 'darwin');
  assert.match(vault.warning, /原文件已保留/); assert.deepEqual(vault.list(), []); assert.equal(vault.available(), false);
  assert.throws(() => vault.read('ref'), /安全凭据库无法读取/); assert.throws(() => vault.remove('ref'), /安全凭据库无法读取/);
  assert.throws(() => vault.save({ name: 'replace', password: 'synthetic' }), /不可用/); assert.equal(fs.readFileSync(file, 'utf8'), '{');
  fs.writeFileSync(file, '[null]'); assert.ok(new CredentialVault(dir, {}, 'darwin').warning);
});
test('application starts with a damaged vault and permits explicit ephemeral credential use', async t => {
  const dir = directory(t); const store = new Store(dir); const profile = store.save({ host: 'fixture.test', username: 'ops', credentialId: 'ref' }); fs.writeFileSync(path.join(dir, 'credentials.enc.json'), '{');
  const app = new EventEmitter(); let quits = 0; const handlers = new Map(); const windows = []; const connections = [];
  Object.assign(app, { setName() {}, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), getPath: () => dir, getVersion: () => 'test', quit() { quits++; } });
  class Window extends EventEmitter { constructor() { super(); this.webContents = new EventEmitter(); Object.assign(this.webContents, { id: 1, mainFrame: { url: '' }, session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }, setWindowOpenHandler() {}, send() {} }); windows.push(this); } isDestroyed() { return false; } loadURL(url) { this.webContents.mainFrame.url = url; } }
  Window.getAllWindows = () => windows;
  class Manager { constructor() { this.sessions = new Map(); } connect(...args) { connections.push(args); return { id: args[0] }; } }
  const electron = { app, BrowserWindow: Window, ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, Menu: { buildFromTemplate: x => x, setApplicationMenu() {} }, dialog: { showErrorBox() { throw new Error('optional vault must not prevent startup'); } }, safeStorage: { isEncryptionAvailable: () => false } };
  const req = createRequire(path.join(root, 'desktop/main.cjs'));
  vm.runInNewContext(fs.readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8'), { require: name => name === 'electron' ? electron : name === './ssh.cjs' ? { SSHManager: Manager } : req(name), __dirname: path.join(root, 'desktop'), process: { env: {}, platform: 'darwin' }, Buffer, setTimeout, clearTimeout });
  await new Promise(r => setImmediate(r)); assert.equal(quits, 0); assert.equal(windows.length, 1);
  const event = { sender: windows[0].webContents, senderFrame: windows[0].webContents.mainFrame };
  const init = await handlers.get('harbor:init')(event); assert.equal(init.ok, true); assert.equal(init.value.profiles.length, 1); assert.match(init.value.vaultWarning, /原文件已保留/);
  const saved = await handlers.get('harbor:save-profile')(event, { ...profile, credentialId: '' });
  assert.equal(saved.ok, true); const connected = await handlers.get('harbor:connect')(event, 'test', saved.value, { password: 'ephemeral' }, {});
  assert.equal(connected.ok, true); assert.equal(connections[0][2].password, 'ephemeral'); assert.equal(fs.readFileSync(path.join(dir, 'credentials.enc.json'), 'utf8'), '{');
});

async function setup(t, stallSftp) {
  const fixture = await createFixture({ stallSftp }); const store = new Store(directory(t));
  const events = []; const manager = new SSHManager({ store, emit: e => events.push(e), confirmHost: async () => true, sftpTimeoutMs: 250, transferIdleTimeoutMs: 350 });
  t.after(async () => { manager.closeAll(); await fixture.close(); });
  await manager.connect('files', { host: '127.0.0.1', port: fixture.port, username: 'ops' }, { password: fixture.password });
  return { fixture, manager, events };
}
test('SFTP REALPATH timeout and cancel release requests, preserve shell, and permit retry', { timeout: 10000 }, async t => {
  const { fixture, manager } = await setup(t, 'REALPATH');
  await assert.rejects(manager.list('files'), /超时/);
  assert.equal(manager.get('files').fileRequests.size, 0);
  const second = manager.list('files'); await until(() => manager.get('files').fileRequests.size > 0);
  manager.cancelFiles('files'); await assert.rejects(second, /取消/);
  fixture.setSftpStall(null); assert.equal((await manager.list('files')).path, '/'); assert.equal(manager.get('files').fileRequests.size, 0);
});
test('unresponsive SFTP initialization closes only its SSH connection and can reconnect without leaking reserved IDs', { timeout: 10000 }, async t => {
  const { fixture, manager } = await setup(t, 'INIT'); const old = manager.get('files');
  await assert.rejects(manager.list('files'), /超时|取消|关闭/); await until(() => !manager.sessions.has('files'));
  assert.equal(old.fileRequests.size, 0);
  fixture.setSftpStall(null);
  await manager.connect('files', { host: '127.0.0.1', port: fixture.port, username: 'ops' }, { password: fixture.password });
  assert.equal((await manager.list('files')).path, '/');
});
test('READDIR and download stalls time out without replacing a previous local file or leaving partials', { timeout: 10000 }, async t => {
  const { fixture, manager } = await setup(t, 'READDIR');
  await assert.rejects(manager.list('files'), /超时/);
  fixture.setSftpStall('READ');
  const local = path.join(directory(t), 'download.txt'); fs.writeFileSync(local, 'PREVIOUS DOWNLOAD');
  await assert.rejects(manager.transfer('files', 'download', local, '/welcome.txt', 'stalled-read'), /超时/);
  await until(() => !fs.existsSync(`${local}.harbor-stalled-read.part`));
  assert.equal(fs.readFileSync(local, 'utf8'), 'PREVIOUS DOWNLOAD');
  assert.equal(manager.get('files').transfers.size, 0); assert.equal(manager.get('files').fileRequests.size, 0);
  fixture.setSftpStall(null);
  await manager.transfer('files', 'download', local, '/welcome.txt', 'retry-read');
  assert.deepEqual(fs.readFileSync(local), fs.readFileSync(path.join(fixture.root, 'welcome.txt')));
});
test('transfer idle deadline releases resources and cancel before SFTP initialization is registered', { timeout: 10000 }, async t => {
  const { fixture, manager } = await setup(t, 'WRITE'); const dir = directory(t); const local = path.join(dir, 'file.bin'); fs.writeFileSync(local, Buffer.alloc(65536));
  await assert.rejects(manager.transfer('files', 'upload', local, '/partial.bin', 'idle'), /超时/);
  assert.equal(manager.get('files').transfers.size, 0); assert.equal(manager.get('files').fileRequests.size, 0);
  fixture.setSftpStall(null); assert.equal((await manager.list('files')).path, '/');
  manager.invalidateSftp(manager.get('files')); fixture.setSftpStall('INIT');
  const old = manager.get('files'); const pending = manager.transfer('files', 'upload', local, '/cancel.bin', 'cancel');
  await until(() => old.transfers.size === 1); manager.cancelFiles('files'); await assert.rejects(pending, /取消|关闭/); await until(() => !manager.sessions.has('files'));
  assert.equal(old.transfers.size, 0); assert.equal(old.fileRequests.size, 0);
});
test('packaging rejects a mismatched runtime architecture before creating output', { skip: process.platform !== 'darwin' }, t => {
  const { verifyMacArchitecture } = require('../scripts/verify-mac-arch.cjs'); const { packageMac } = require('../scripts/package-mac.cjs');
  const runtime = path.join(root, 'node_modules/electron/dist/Electron.app'); const { binaries } = verifyMacArchitecture(runtime, process.arch);
  assert.ok(binaries.length > 1);
  const output = path.join(directory(t), 'must-not-exist'); const other = process.arch === 'x64' ? 'arm64' : 'x64';
  assert.throws(() => packageMac([`--arch=${other}`, `--output=${output}`]), /架构不匹配/); assert.equal(fs.existsSync(output), false);
});
