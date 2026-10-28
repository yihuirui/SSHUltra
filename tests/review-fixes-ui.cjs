const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { createFixture } = require('./fixture.cjs'); const { Store } = require('../desktop/store.cjs');
const root = path.resolve(__dirname, '..');
const until = async fn => { const end = Date.now() + 10000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('UI regression evidence timeout'); };
async function launch(directory) {
  const env = { ...process.env, HARBOR_TEST_MODE: '1', HARBOR_DATA_DIR: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: [root], env });
  await app.evaluate(({ dialog }) => {
    globalThis.__fixesDialogs = { exportPath: '' };
    dialog.showMessageBox = async () => ({ response: 1 }); dialog.showMessageBoxSync = () => 1;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.__fixesDialogs.exportPath });
  });
  return app;
}
(async () => {
  const fixture = await createFixture(); const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sshultra-fix-ui-'));
  const output = path.join(root, 'test-results/fixes-20261027'); fs.mkdirSync(output, { recursive: true });
  let app; const report = { checks: [], pageErrors: [] };
  try {
    app = await launch(path.join(temp, 'primary')); let page = await app.firstWindow(); page.on('pageerror', e => report.pageErrors.push(e.message));
    await page.getByRole('button', { name: '新建连接' }).click(); let form = page.getByRole('dialog', { name: 'SSH 连接', exact: true });
    for (const [label, value] of [['连接名称', 'Fix fixture'], ['分组', 'Old group'], ['主机地址', '127.0.0.1'], ['端口', String(fixture.port)], ['用户名', 'ops'], ['密码', fixture.password]]) await form.getByLabel(label, { exact: true }).fill(value);
    await form.getByRole('button', { name: '保存并连接' }).click(); await page.getByLabel('批量目标 Fix fixture', { exact: true }).waitFor();
    const id = await page.locator('[data-session-id]').first().getAttribute('data-session-id');
    await page.locator('.xterm-helper-textarea').focus(); const sent = fixture.inputs.length;
    await page.keyboard.press('Meta+Shift+P'); const library = page.getByRole('dialog', { name: '命令库', exact: true }); await library.waitFor();
    assert.equal(await library.getByLabel('搜索命令').evaluate(el => document.activeElement === el), true);
    await page.keyboard.type('REVIEW_FOCUS_MARKER'); await page.keyboard.press('Enter');
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press(i < 8 ? 'Tab' : 'Shift+Tab');
      assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.app-body, .titlebar, .statusbar'))), false);
    }
    await new Promise(r => setTimeout(r, 150)); assert.equal(fixture.inputs.length, sent);
    await page.screenshot({ path: path.join(output, 'modal-focus.png') });
    await page.keyboard.press('Escape'); await until(async () => await page.getByRole('dialog', { name: '命令库' }).count() === 0);
    await until(async () => await page.locator('.xterm-helper-textarea').evaluate(el => document.activeElement === el));
    report.checks.push('Shortcut modal focuses search, Tab stays away from background, Enter sends zero SSH bytes, Escape restores terminal focus');

    const saved = (await page.evaluate(() => window.harbor.init())).profiles[0];
    await page.evaluate(id => window.harbor.bulkProfiles([id], { group: 'New bulk group' }), saved.id);
    await page.evaluate(id => window.harbor.disconnect(id), id); await page.getByRole('button', { name: '重新连接', exact: true }).click();
    form = page.getByRole('dialog', { name: 'SSH 连接', exact: true }); assert.equal(await form.getByLabel('分组', { exact: true }).inputValue(), 'New bulk group');
    await page.evaluate(id => window.harbor.bulkProfiles([id], { group: 'Other update' }), saved.id);
    await form.getByRole('button', { name: '仅保存', exact: true }).click(); await form.getByRole('alert').filter({ hasText: '已被其他操作更新' }).waitFor();
    assert.equal((await page.evaluate(() => window.harbor.init())).profiles[0].group, 'Other update');
    await form.getByTitle('关闭连接设置').click(); await page.getByRole('button', { name: '重新连接', exact: true }).click();
    form = page.getByRole('dialog', { name: 'SSH 连接', exact: true }); assert.equal(await form.getByLabel('分组', { exact: true }).inputValue(), 'Other update');
    await form.getByLabel('密码', { exact: true }).fill(fixture.password); await form.getByRole('button', { name: '保存并连接' }).click();
    await page.getByLabel('批量目标 Fix fixture', { exact: true }).waitFor(); report.checks.push('Reconnect reads latest saved profile and stale open editors cannot overwrite newer changes');

    await until(async () => await page.getByLabel('远程路径', { exact: true }).inputValue() === '/');
    fixture.setSftpStall('REALPATH'); await page.getByTitle('刷新文件', { exact: true }).click();
    const cancel = page.getByTitle('取消文件操作', { exact: true }); await until(() => cancel.isEnabled()); await cancel.click();
    await page.locator('.file-error').filter({ hasText: /取消/ }).waitFor();
    assert.equal(await page.getByLabel('批量目标 Fix fixture', { exact: true }).count(), 1);
    fixture.setSftpStall(null); await page.getByTitle('刷新文件', { exact: true }).click(); await page.getByTitle('下载 welcome.txt', { exact: true }).waitFor();
    report.checks.push('Cancel pending file listing preserves SSH terminal and allows a fresh SFTP request');

    const exported = path.join(temp, 'shared.json'); fs.writeFileSync(exported, 'old'); fs.chmodSync(exported, 0o644);
    await app.evaluate((_electron, file) => { globalThis.__fixesDialogs.exportPath = file; }, exported);
    await page.getByRole('button', { name: '连接批量管理', exact: true }).click(); const management = page.getByRole('dialog', { name: '连接批量管理', exact: true });
    await management.getByLabel('管理目标 Fix fixture', { exact: true }).check(); await management.getByRole('button', { name: '导出所选配置', exact: true }).click();
    await until(() => fs.readFileSync(exported, 'utf8').startsWith('{')); assert.equal(fs.statSync(exported).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(exported)).profiles[0].username, ''); await management.getByTitle('关闭连接批量管理').click();
    report.checks.push('Real export IPC atomically replaces an existing shared file with private sanitized output');
    await page.evaluate(id => window.harbor.deleteProfile(id), saved.id); await page.evaluate(id => window.harbor.disconnect(id), id);
    await page.getByRole('button', { name: '重新连接', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '保存的连接已删除' }).waitFor(); assert.equal(await page.getByRole('dialog', { name: 'SSH 连接' }).count(), 0);
    assert.equal((await page.evaluate(() => window.harbor.init())).profiles.length, 0); report.checks.push('Deleted profiles are not silently recreated by reconnect');
    await app.close(); app = null;

    const damaged = path.join(temp, 'damaged'); new Store(damaged).save({ name: 'Damaged vault fixture', host: '127.0.0.1', port: fixture.port, username: 'ops', credentialId: 'unavailable-reference' });
    fs.writeFileSync(path.join(damaged, 'credentials.enc.json'), '{');
    app = await launch(damaged); page = await app.firstWindow(); page.on('pageerror', e => report.pageErrors.push(e.message));
    await page.getByRole('status').filter({ hasText: '安全凭据库无法读取' }).waitFor(); await page.getByTitle('连接 ops@127.0.0.1', { exact: true }).click();
    form = page.getByRole('dialog', { name: 'SSH 连接', exact: true }); await form.getByLabel('连接安全凭据', { exact: true }).selectOption('');
    await form.getByLabel('密码', { exact: true }).fill(fixture.password); await form.getByRole('button', { name: '保存并连接' }).click(); await page.getByLabel('批量目标 Damaged vault fixture', { exact: true }).waitFor();
    assert.equal(fs.readFileSync(path.join(damaged, 'credentials.enc.json'), 'utf8'), '{'); report.checks.push('Damaged optional vault keeps app usable; explicit ephemeral login works without overwriting the damaged file');
    assert.deepEqual(report.pageErrors, []); fs.writeFileSync(path.join(output, 'ui-regression.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { if (app) await app.close(); await fixture.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
