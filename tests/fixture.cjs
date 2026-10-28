const { Server, utils } = require('ssh2');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const net = require('node:net');
const { STATUS_CODE, flagsToString } = utils.sftp;

// SSH2 supports OpenSSH keys; RSA PEM keeps the fixture portable across library releases.
const rsaKey = () => generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } }).privateKey;
async function createFixture({ port = 0, hostKey = rsaKey(), clientKey, respondToShell = true, keyboard = false, allowForward = false, stallSftp = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-fixture-'));
  fs.mkdirSync(path.join(root, 'logs'));
  fs.writeFileSync(path.join(root, 'welcome.txt'), 'HarborSSH SFTP fixture\n中文文件传输验证\n');
  const clients = new Set(); const children = new Set(); const events = new EventEmitter();
  const inputs = []; const sizes = [];
  let writeDelay = 0; let sftpStall = stallSftp;
  const timers = new Set();
  const publicKey = clientKey ? utils.parseKey(clientKey) : null;
  const password = randomUUID();
  const server = new Server({ hostKeys: [hostKey] }, client => {
    clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client));
    client.on('authentication', ctx => {
      events.emit('authentication', ctx.method);
      const validUser = ctx.username === 'ops';
      if (validUser && keyboard && ctx.method === 'keyboard-interactive') {
        ctx.prompt([{ prompt: 'Password: ', echo: false }, { prompt: 'Verification code: ', echo: false }], answers => {
          if (answers[0] !== password || answers[1] !== '123456') return ctx.reject(['keyboard-interactive']);
          ctx.prompt([{ prompt: 'Second verification: ', echo: false }], next => next[0] === '654321' ? ctx.accept() : ctx.reject(['keyboard-interactive']));
        }); return;
      }
      if (validUser && !keyboard && ctx.method === 'password' && ctx.password === password) return ctx.accept();
      if (validUser && ctx.method === 'publickey' && publicKey && publicKey.getPublicSSH().equals(ctx.key.data) && (!ctx.signature || publicKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo))) return ctx.accept();
      ctx.reject(keyboard ? ['keyboard-interactive'] : ['password', 'publickey']);
    });
    client.on('tcpip', (accept, reject, info) => {
      if (!allowForward || info.destIP !== '127.0.0.1') return reject();
      const socket = net.connect(info.destPort, '127.0.0.1');
      children.add(socket);
      socket.once('connect', () => {
        const stream = accept(); if (!stream) { socket.destroy(); return; }
        stream.on('error', () => socket.destroy());
        stream.once('close', () => socket.destroy());
        socket.pipe(stream).pipe(socket);
      });
      socket.on('error', () => { try { reject(); } catch {} });
      socket.once('close', () => children.delete(socket));
    });
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('pty', (accept, _reject, info) => { sizes.push(info); accept?.(); });
      session.on('window-change', (accept, _reject, info) => { sizes.push(info); accept?.(); });
      session.on('shell', accept => {
        if (!respondToShell) return;
        const channel = accept();
        // Real local POSIX shell; contained in a disposable fixture directory.
        const child = spawn('/bin/sh', [], { cwd: root, env: { PATH: '/usr/bin:/bin', HOME: root, LANG: 'en_US.UTF-8' }, stdio: 'pipe' });
        children.add(child);
        channel.write('\x1b[38;5;79mHarborSSH · integration fixture\x1b[0m\r\nConnected to isolated loopback SSH server.\r\n\r\nops@fixture ~ $ ');
        channel.on('data', data => {
          const value = data.toString('utf8'); inputs.push(value); events.emit('input', value);
          channel.write(value.replace(/\r/g, '\r\n'));
          child.stdin.write(value.replace(/\r/g, '\n'));
        });
        child.stdin.on('error', () => {});
        child.stdout.on('data', data => channel.write(data.toString().replace(/\n/g, '\r\n')));
        child.stderr.on('data', data => channel.stderr.write(data));
        child.on('close', code => { children.delete(child); if (!channel.destroyed) { channel.exit(code || 0); channel.end(); } });
        channel.on('close', () => child.kill());
      });
      session.on('sftp', accept => {
        if (sftpStall === 'INIT') return;
        const ftp = accept(); const handles = new Map(); let nextHandle = 0;
        const safe = remote => {
          const full = path.resolve(root, '.' + path.posix.resolve('/', remote));
          if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Outside fixture');
          return full;
        };
        const attrs = stat => ({ mode: stat.mode, uid: stat.uid, gid: stat.gid, size: stat.size, atime: Math.floor(stat.atimeMs / 1000), mtime: Math.floor(stat.mtimeMs / 1000) });
        const entry = (name, stat) => ({ filename: name, longname: name, attrs: attrs(stat) });
        const addHandle = data => { const h = Buffer.alloc(4); h.writeUInt32BE(++nextHandle); handles.set(h.toString('hex'), data); return h; };
        const getHandle = h => { const found = handles.get(h.toString('hex')); if (!found) throw new Error('Invalid handle'); return found; };
        const respond = (event, fn) => ftp.on(event, (id, ...args) => {
          if (sftpStall === event) return;
          try { fn(id, ...args); } catch (error) { ftp.status(id, error.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : error.code === 'EACCES' ? STATUS_CODE.PERMISSION_DENIED : STATUS_CODE.FAILURE, error.message); }
        });
        respond('REALPATH', (id, remote) => { const local = safe(remote); fs.statSync(local); ftp.name(id, [entry('/' + path.relative(root, local).split(path.sep).join('/'), fs.statSync(local))]); });
        for (const method of ['STAT', 'LSTAT']) respond(method, (id, remote) => ftp.attrs(id, attrs(fs.statSync(safe(remote)))));
        respond('OPENDIR', (id, remote) => { const local = safe(remote); if (!fs.statSync(local).isDirectory()) throw new Error('Not a directory'); ftp.handle(id, addHandle({ directory: local, read: false })); });
        respond('READDIR', (id, handle) => { const h = getHandle(handle); if (h.read) return ftp.status(id, STATUS_CODE.EOF); h.read = true; const rows = fs.readdirSync(h.directory).map(name => entry(name, fs.statSync(path.join(h.directory, name)))); if (!rows.length) return ftp.status(id, STATUS_CODE.EOF); ftp.name(id, rows); });
        respond('OPEN', (id, remote, flags) => ftp.handle(id, addHandle({ fd: fs.openSync(safe(remote), flagsToString(flags), 0o600) })));
        respond('FSTAT', (id, handle) => ftp.attrs(id, attrs(fs.fstatSync(getHandle(handle).fd))));
        respond('READ', (id, handle, offset, length) => { const buffer = Buffer.alloc(Math.min(length, 65536)); const n = fs.readSync(getHandle(handle).fd, buffer, 0, buffer.length, offset); if (!n) return ftp.status(id, STATUS_CODE.EOF); ftp.data(id, buffer.subarray(0, n)); });
        respond('WRITE', (id, handle, offset, data) => {
          fs.writeSync(getHandle(handle).fd, data, 0, data.length, offset);
          if (!writeDelay) return ftp.status(id, STATUS_CODE.OK);
          const timer = setTimeout(() => { timers.delete(timer); if (!ftp.destroyed) ftp.status(id, STATUS_CODE.OK); }, writeDelay);
          timers.add(timer);
        });
        respond('CLOSE', (id, handle) => { const key = handle.toString('hex'); const h = getHandle(handle); if (h.fd !== undefined) fs.closeSync(h.fd); handles.delete(key); ftp.status(id, STATUS_CODE.OK); });
        ftp.on('close', () => { for (const h of handles.values()) if (h.fd !== undefined) { try { fs.closeSync(h.fd); } catch {} } });
      });
    }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { root, password, port: server.address().port, inputs, sizes, events, hostKey, setWriteDelay(ms) { writeDelay = ms; }, setSftpStall(value) { sftpStall = value; },
    async close() {
      for (const timer of timers) clearTimeout(timer);
      for (const client of clients) client.end();
      const exits = [...children].map(child => new Promise(resolve => { child.once('close', resolve); if (child.kill) child.kill(); else child.destroy(); }));
      await Promise.all(exits);
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}
module.exports = { createFixture, rsaKey };
