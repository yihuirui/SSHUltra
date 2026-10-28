const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('../desktop/store.cjs');
const { SSHManager } = require('../desktop/ssh.cjs');
const { SessionLog } = require('../desktop/logging.cjs');
const { CredentialVault } = require('../desktop/vault.cjs');
const { parseConfig, importProfiles, exportProfiles } = require('../desktop/migration.cjs');
const { createFixture } = require('./fixture.cjs');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sshultra-workflows-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory;
}
const profile = (fixture, extra = {}) => ({ name: 'Fixture', host: '127.0.0.1', port: fixture.port, username: 'ops', authType: 'password', ...extra });
const waitFor = async predicate => {
  const end = Date.now() + 6000;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Timed out waiting for fixture evidence');
};

test('commands survive restart; invalid commands and bulk changes leave the workspace intact', t => {
  const directory = temporary(t); const store = new Store(directory);
  const jump = store.save({ host: 'jump.test', username: 'ops' });
  const target = store.save({ host: 'target.test', username: 'ops', jumpProfileId: jump.id });
  const command = store.saveCommand({ name: 'Disk', folder: '巡检', body: 'df -h {{path}}' });
  assert.deepEqual(new Store(directory).commands(), [command]);
  assert.throws(() => store.remove(jump.id), /引用/);
  assert.throws(() => store.bulkPreview([jump.id], { jumpProfileId: target.id }), /单级/);
  assert.throws(() => store.bulkPreview([jump.id, target.id], { port: 70000 }), /端口/);
  assert.throws(() => store.bulkPreview([jump.id], { password: 'must-not-persist' }), /字段/);
  assert.throws(() => store.saveCommand({ name: 'bad', body: 'echo\x1b[31m' }), /控制字符/);
  const next = store.bulkPreview([target.id], { username: 'deploy', port: 2222 });
  assert.equal(store.profiles().find(p => p.id === target.id).username, 'ops');
  store.replaceProfiles(next);
  assert.equal(new Store(directory).profiles().find(p => p.id === target.id).username, 'deploy');
  assert.equal(new Store(directory).profiles().find(p => p.id === jump.id).port, 22);
});

test('selective exports contain no credential references, trust, log settings or private paths by default', t => {
  const store = new Store(temporary(t));
  const jump = store.save({ host: 'jump.test', username: 'alice', credentialId: 'credential-reference', keyPath: '/private/key' });
  const p = store.save({ host: 'target.test', username: 'alice', jumpProfileId: jump.id, logEnabled: true });
  assert.throws(() => exportProfiles(store.profiles(), [p.id]), /跳板/);
  const exported = exportProfiles(store.profiles(), [jump.id, p.id]);
  const serialized = JSON.stringify(exported);
  for (const secret of ['alice', 'credential-reference', '/private/key', 'knownHosts', 'logEnabled']) assert.ok(!serialized.includes(secret));
  const before = store.profiles();
  const result = importProfiles(before, parseConfig(serialized, 'connections.json').profiles, 'bob');
  assert.equal(result.length, 4); assert.deepEqual(result.slice(0, 2), before);
  assert.equal(result[3].jumpProfileId, result[2].id); assert.equal(result[2].username, 'bob');
  assert.equal(result[2].credentialId, ''); assert.equal(result[3].logEnabled, false);
});

test('OpenSSH and SecureCRT import only supported connection fields and never execute directives', () => {
  const parsed = parseConfig('Host gateway\n HostName jump.test\n User ops\nHost web\n HostName web.test\n User deploy\n ProxyJump gateway\n IdentityFile ~/keys/id_ed25519\n', 'config');
  const imported = importProfiles([], parsed.profiles, '', '/fixture-home');
  assert.equal(imported[1].jumpProfileId, imported[0].id);
  assert.equal(imported[1].keyPath, '/fixture-home/keys/id_ed25519');
  assert.throws(() => parseConfig('Host web\nUser ops\nProxyCommand curl https://must-not-run.test\n', 'config'), /无法安全迁移/);
  const crt = parseConfig('S:"Protocol Name"=SSH2\nS:"Hostname"=router.test\nS:"Username"=ops\nD:"[SSH2] Port"=00000016\nS:"Password V2"=secret-ignored\n', 'router.ini');
  assert.equal(crt.profiles[0].port, 22); assert.ok(!JSON.stringify(crt).includes('secret-ignored'));
  assert.throws(() => parseConfig('S:"Hostname"=router.test\nS:"Protocol Name"=Telnet\n', 'router.ini'), /SSH2/);
  assert.throws(() => importProfiles([], [{ name: 'No User', host: 'host.test' }]), /用户名/);
});

test('credential ciphertext persists without plaintext, names only are listed, and unavailable storage fails closed', t => {
  const directory = temporary(t); const key = crypto.randomBytes(32);
  const safe = { isEncryptionAvailable: () => true,
    encryptString(value) { const iv = crypto.randomBytes(16); const cipher = crypto.createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([iv, cipher.update(value), cipher.final()]); },
    decryptString(buffer) { const cipher = crypto.createDecipheriv('aes-256-cbc', key, buffer.subarray(0, 16)); return Buffer.concat([cipher.update(buffer.subarray(16)), cipher.final()]).toString(); }
  };
  const vault = new CredentialVault(directory, safe, 'darwin');
  const entry = vault.save({ name: 'Ops', password: 'private-password', passphrase: 'private-passphrase' });
  assert.deepEqual(vault.list(), [entry]);
  assert.ok(!fs.readFileSync(vault.file, 'utf8').includes('private-password'));
  assert.equal(fs.statSync(vault.file).mode & 0o777, 0o600);
  assert.equal(new CredentialVault(directory, safe, 'darwin').read(entry.id).password, 'private-password');
  const disabled = new CredentialVault(directory, safe, 'linux');
  assert.throws(() => disabled.read(entry.id), /不可用/);
  assert.throws(() => disabled.save({ name: 'x', password: 'x' }), /不可用/);
  vault.save({ ...entry, password: 'rotated' }); assert.equal(vault.list().length, 1); assert.equal(vault.read(entry.id).password, 'rotated');
});

test('streamed logs preserve split UTF-8, strip split ANSI/OSC, rotate, and retain only this profile after opt-in', async t => {
  const directory = temporary(t); const errors = []; const p = { id: 'one', name: 'Log', host: 'example.test', port: 22, username: 'ops', logRetentionDays: 0 };
  const log = new SessionLog(directory, p, error => errors.push(error), { maxBytes: 180 });
  const utf8 = Buffer.from('中文输出\n'); log.write(utf8.subarray(0, 2)); log.write(utf8.subarray(2));
  log.write(Buffer.from('\x1b[')); log.write(Buffer.from('31mRED\x1b[0m\n\x1b]0;HIDDEN'));
  log.write(Buffer.from('\x07VISIBLE\n')); log.close(); await log.flush();
  const files = fs.readdirSync(directory); const contents = files.map(f => fs.readFileSync(path.join(directory, f), 'utf8')).join('');
  assert.match(contents, /中文输出/); assert.match(contents, /RED/); assert.match(contents, /VISIBLE/); assert.ok(!contents.includes('HIDDEN')); assert.ok(!contents.includes('\x1b'));
  assert.ok(files.length >= 2); assert.deepEqual(errors, []);
  const old = new Date(Date.now() - 40 * 86400000); for (const name of files) fs.utimesSync(path.join(directory, name), old, old);
  fs.writeFileSync(path.join(directory, 'unrelated.log'), 'keep'); fs.utimesSync(path.join(directory, 'unrelated.log'), old, old);
  const other = new SessionLog(directory, { ...p, id: 'other' }, () => {}); other.close(); await other.flush();
  const retained = fs.readdirSync(directory).filter(f => !files.includes(f));
  const next = new SessionLog(directory, { ...p, logRetentionDays: 7 }, () => {}); next.close(); await next.flush();
  for (const name of files) assert.equal(fs.existsSync(path.join(directory, name)), false);
  for (const name of retained) assert.equal(fs.existsSync(path.join(directory, name)), true);
});

test('real multi-round keyboard-interactive authentication and cancellation release session resources', { timeout: 15000 }, async t => {
  const directory = temporary(t); const fixture = await createFixture({ keyboard: true });
  const store = new Store(directory); const prompts = [];
  const manager = new SSHManager({ store, emit: () => {}, confirmHost: async () => true, requestAuth: async info => {
    prompts.push(info); return info.prompts.length === 2 ? [fixture.password, '123456'] : ['654321'];
  } });
  t.after(async () => { manager.closeAll(); await fixture.close(); });
  await manager.connect('mfa', profile(fixture, { authType: 'interactive' }));
  assert.equal(prompts.length, 2); assert.equal(prompts[0].prompts[0].echo, false); manager.disconnect('mfa');
  manager.requestAuth = async () => null;
  await assert.rejects(manager.connect('cancel', profile(fixture, { authType: 'interactive' })), /关闭|取消/);
  await waitFor(() => manager.sessions.size === 0);
});

test('real SSH hop validates both host keys, forwards target shell and records its output', { timeout: 20000 }, async t => {
  const directory = temporary(t); const gateway = await createFixture({ allowForward: true }); const target = await createFixture();
  const store = new Store(directory); const jump = store.save(profile(gateway, { name: 'Gateway' }));
  const endpoint = store.save(profile(target, { name: 'Target', jumpProfileId: jump.id, logEnabled: true }));
  const hostPrompts = []; const output = []; const logs = [];
  const manager = new SSHManager({ store, confirmHost: async info => { hostPrompts.push(info); return true; },
    emit: e => { if (e.type === 'data') { output.push(Buffer.from(e.data, 'base64').toString()); manager.ack(e.id, e.bytes); } },
    logFactory: (p, onError) => { const log = new SessionLog(path.join(directory, 'logs'), p, onError); logs.push(log); return log; }
  });
  t.after(async () => { manager.closeAll(); await manager.flushLogs(); await gateway.close(); await target.close(); });
  await manager.connect('hop', endpoint, { password: target.password, jump: { password: gateway.password } });
  assert.equal(hostPrompts.length, 2); assert.notEqual(hostPrompts[0].port, hostPrompts[1].port);
  await manager.write('hop', 'printf HOP_OUTPUT_VERIFIED\\n\r');
  await waitFor(() => output.join('').includes('HOP_OUTPUT_VERIFIED'));
  manager.setLogging('hop', false); await logs[0].flush();
  const text = fs.readdirSync(path.join(directory, 'logs')).map(f => fs.readFileSync(path.join(directory, 'logs', f), 'utf8')).join('');
  assert.match(text, /HOP_OUTPUT_VERIFIED/); assert.ok(!text.includes(target.password)); assert.ok(!text.includes(gateway.password));
  manager.disconnect('hop'); await waitFor(() => manager.sessions.size === 0);
  store.trust('127.0.0.1', target.port, 'SHA256:' + 'A'.repeat(43));
  await assert.rejects(manager.connect('changed-through-hop', endpoint, { password: target.password, jump: { password: gateway.password } }), /密钥已变化/);
});

test('batch reports asynchronous write errors per destination', async () => {
  const manager = new SSHManager({ store: {}, emit: () => {}, confirmHost: async () => true });
  for (const id of ['ok', 'failed']) manager.sessions.set(id, { id, channel: { destroyed: false, write(_data, callback) { setImmediate(() => callback(id === 'ok' ? undefined : new Error('broken pipe'))); return true; } }, inputPendingBytes: 0, inputBackpressured: false });
  const result = await manager.batch(['ok', 'failed'], 'uname -a');
  assert.equal(result[0].sent, true); assert.equal(result[1].sent, false); assert.match(result[1].message, /broken pipe/);
});
