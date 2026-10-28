const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Run only against an explicitly selected, locally built app and disposable profiles.
(async () => {
  const executablePath = process.env.HARBOR_PACKAGED_APP;
  if (!executablePath || !path.isAbsolute(executablePath)) throw new Error('Set HARBOR_PACKAGED_APP to the built executable');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sshultra-package-'));
  const env = { ...process.env, HARBOR_TEST_MODE: '1', HARBOR_DATA_DIR: path.join(temp, 'userdata') };
  delete env.ELECTRON_RUN_AS_NODE;
  let primary;
  let second;
  try {
    primary = await _electron.launch({ executablePath, args: [], env, timeout: 30000 });
    const first = await primary.firstWindow();
    await first.getByRole('button', { name: '新建连接' }).waitFor();
    const meta = await primary.evaluate(({ app }) => ({ name: app.getName(), version: app.getVersion(), userData: app.getPath('userData') }));
    assert.equal(meta.name, 'SSHUltra');
    assert.equal(meta.version, require('../package.json').version);
    assert.equal(meta.userData, env.HARBOR_DATA_DIR);
    const profile = await first.evaluate(() => window.harbor.saveProfile({ name: 'Package test', host: 'example.test', username: 'test' }));
    const focusEvents = await primary.evaluate(({ app }) => {
      globalThis.__packageSecondInstances = 0;
      app.on('second-instance', () => globalThis.__packageSecondInstances++);
      return globalThis.__packageSecondInstances;
    });
    assert.equal(focusEvents, 0);
    second = spawn(executablePath, [], { env, stdio: 'ignore' });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Second instance did not exit')), 8000);
      second.once('exit', code => { clearTimeout(timer); resolve(code); });
      second.once('error', error => { clearTimeout(timer); reject(error); });
    });
    assert.equal(code, 0);
    assert.equal(await primary.evaluate(() => globalThis.__packageSecondInstances), 1);
    assert.equal(await primary.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    const nextWindow = primary.waitForEvent('window');
    await first.evaluate(() => window.harbor.newWindow());
    const next = await nextWindow;
    await next.getByRole('button', { name: '新建连接' }).waitFor();
    assert.ok((await next.evaluate(() => window.harbor.init())).profiles.some(p => p.id === profile.id));
    const bundleResources = path.resolve(path.dirname(executablePath), '../Resources');
    for (const name of ['SSHUltra-LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'Electron-LICENSE.txt', 'LICENSES.chromium.html']) {
      assert.ok(fs.statSync(path.join(bundleResources, name)).size > 100);
    }
    console.log(JSON.stringify({ checks: ['Packaged identity and isolated data directory', 'Real second process exits and notifies first without opening a duplicate window', 'New window shares saved profiles in one main process', 'Application, runtime and Chromium notices included'], version: meta.version, pageErrors: [] }, null, 2));
  } finally {
    if (second && second.exitCode === null) second.kill();
    if (primary) await primary.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
