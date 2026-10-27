const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { Store, validateProfile } = require('../desktop/store.cjs');
const { SSHManager } = require('../desktop/ssh.cjs');
const { createFixture, rsaKey } = require('./fixture.cjs');

const profile = (fixture, extra = {}) => ({ name: 'Test SSH', group: 'Tests', host: '127.0.0.1', port: fixture.port, username: 'ops', authType: 'password', ...extra });
const waitFor = async (predicate, timeout = 6000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (predicate()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('Timed out waiting for evidence'); };
async function setup(t, options = {}) {
  const fixture = await createFixture(options);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-store-'));
  const store = new Store(directory); const events = []; let prompts = 0;
  const manager = new SSHManager({ store, confirmHost: async () => { prompts++; return options.accept !== false; }, emit: event => { events.push(event); if (event.type === 'data') setImmediate(() => manager.ack(event.id, event.bytes)); } });
  t.after(async () => { manager.closeAll(); await fixture.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { fixture, store, manager, events, directory, prompts: () => prompts };
}
test('profile persistence strips secrets, rejects invalid endpoints, and survives restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-profile-'));
  try {
    const store = new Store(root);
    const p = store.save({ host: 'example.test', username: 'ops', password: 'SHOULD_NOT_EXIST', passphrase: 'ALSO_SECRET', group: 'prod' });
    assert.equal(new Store(root).profiles()[0].id, p.id);
    const serialized = fs.readFileSync(store.file, 'utf8');
    assert.ok(!serialized.includes('SHOULD_NOT_EXIST') && !serialized.includes('ALSO_SECRET'));
    assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
    assert.throws(() => validateProfile({ host: 'bad host', username: 'ops' }));
    assert.throws(() => validateProfile({ host: 'example.test', username: 'ops', port: 70000 }));
    store.remove(p.id); assert.equal(new Store(root).profiles().length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('real SSH shell, UTF-8, resizing, and selected-target batch delivery', { timeout: 15000 }, async t => {
  const { fixture, manager, events, prompts } = await setup(t);
  const p = profile(fixture);
  for (const id of ['one', 'two', 'three']) await manager.connect(id, p, { password: fixture.password }, { cols: 90, rows: 28 });
  assert.equal(prompts(), 1);
  await manager.write('one', "printf '中文终端验证\\n'\r");
  await waitFor(() => events.filter(e => e.type === 'data' && e.id === 'one').map(e => Buffer.from(e.data, 'base64').toString()).join('').includes('中文终端验证\r\n'));
  manager.resize('one', 120, 45);
  await waitFor(() => fixture.sizes.some(s => s.cols === 120 && s.rows === 45));
  const before = fixture.inputs.length;
  assert.throws(() => manager.batch(['one', 'missing'], 'echo SHOULD_NOT_SEND'));
  assert.throws(() => manager.batch(['one', 'one'], 'echo duplicate'));
  assert.throws(() => manager.batch(['one'], '\x1b[31m'));
  await new Promise(r => setTimeout(r, 50)); assert.equal(fixture.inputs.length, before);
  const sent = manager.batch(['one', 'two'], 'printf "BATCH_SELECTED_OK\\n"');
  assert.deepEqual(sent.map(r => r.sent), [true, true]);
  await waitFor(() => fixture.inputs.filter(x => x.includes('BATCH_SELECTED_OK')).length === 2);
  assert.ok(!events.filter(e => e.type === 'data' && e.id === 'three').map(e => Buffer.from(e.data, 'base64').toString()).join('').includes('BATCH_SELECTED_OK'));
  manager.disconnect('one'); assert.throws(() => manager.write('one', 'x')); await waitFor(() => manager.sessions.size === 2);
});
test('SFTP list and binary upload/download round trip; refuses overwriting remote files', { timeout: 15000 }, async t => {
  const { fixture, manager, directory } = await setup(t);
  await manager.connect('sftp', profile(fixture), { password: fixture.password });
  const listing = await manager.list('sftp', '.');
  assert.equal(listing.path, '/'); assert.ok(listing.entries.some(e => e.name === 'logs' && e.directory));
  const data = randomBytes(256 * 1024 + 21);
  const source = path.join(directory, 'binary.bin'); fs.writeFileSync(source, data);
  const uploaded = await manager.transfer('sftp', 'upload', source, '/round-trip.bin', randomUUID());
  assert.equal(uploaded.bytes, data.length); assert.deepEqual(fs.readFileSync(path.join(fixture.root, 'round-trip.bin')), data);
  await assert.rejects(manager.transfer('sftp', 'upload', source, '/round-trip.bin', randomUUID()));
  assert.deepEqual(fs.readFileSync(path.join(fixture.root, 'round-trip.bin')), data);
  const destination = path.join(directory, 'download.bin');
  await manager.transfer('sftp', 'download', destination, '/round-trip.bin', randomUUID());
  assert.deepEqual(fs.readFileSync(destination), data);
  await assert.rejects(manager.transfer('sftp', 'download', path.join(directory, 'missing.bin'), '/absent', randomUUID()));
  assert.ok(!fs.readdirSync(directory).some(f => f.endsWith('.part')));
});
test('private-key authentication succeeds, incorrect password and host rejection fail closed', { timeout: 15000 }, async t => {
  const key = rsaKey(); const { fixture, manager, directory } = await setup(t, { clientKey: key });
  const keyFile = path.join(directory, 'client-key'); fs.writeFileSync(keyFile, key, { mode: 0o600 });
  await manager.connect('key', profile(fixture, { authType: 'key', keyPath: keyFile }), {});
  await assert.rejects(manager.connect('wrong', profile(fixture), { password: 'wrong' }), /authentication|认证/i);
  await waitFor(() => !manager.sessions.has('wrong'));
  const rejectStore = new Store(path.join(directory, 'untrusted'));
  const rejected = new SSHManager({ store: rejectStore, emit: () => {}, confirmHost: async () => false });
  await assert.rejects(rejected.connect('denied', profile(fixture), { password: fixture.password }), /未信任/);
  await waitFor(() => rejected.sessions.size === 0);
  assert.equal(rejected.sessions.size, 0); assert.equal(rejectStore.fingerprint('127.0.0.1', fixture.port), undefined);
});
test('changed host key is rejected without another trust prompt', { timeout: 15000 }, async t => {
  const { fixture, manager, store, prompts } = await setup(t);
  store.trust('127.0.0.1', fixture.port, 'SHA256:' + 'A'.repeat(43));
  await assert.rejects(manager.connect('changed', profile(fixture), { password: fixture.password }), /主机密钥已变化/);
  assert.equal(prompts(), 0); await waitFor(() => manager.sessions.size === 0);
});
test('terminal output backpressure pauses and acknowledgement resumes the stream', { timeout: 15000 }, async t => {
  const { fixture, store } = await setup(t);
  const events = [];
  const manager = new SSHManager({ store, emit: e => events.push(e), confirmHost: async () => true });
  t.after(() => manager.closeAll());
  await manager.connect('flow', profile(fixture), { password: fixture.password });
  await manager.write('flow', "head -c 900000 /dev/zero | tr '\\000' x; printf '\\nFLOW_DONE\\n'\r");
  await waitFor(() => manager.get('flow').pending > 512 * 1024);
  assert.equal(manager.get('flow').channel.isPaused(), true);
  manager.ack('flow', manager.get('flow').pending);
  await waitFor(() => events.filter(e => e.type === 'data').map(e => Buffer.from(e.data, 'base64').toString()).join('').includes('\r\nFLOW_DONE\r\n'));
});
