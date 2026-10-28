const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFixture } = require('./fixture.cjs');
const project = path.resolve(__dirname, '..');
const waitFor = async predicate => {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error('UI workflow evidence timed out');
};
async function run() {
  const mfa = await createFixture({ keyboard: true }); const gateway = await createFixture({ allowForward: true }); const target = await createFixture();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sshultra-workflow-ui-')); const output = path.join(project, 'test-results');
  fs.mkdirSync(output, { recursive: true });
  let app; const report = { checks: [], pageErrors: [] };
  try {
    const env = { ...process.env, HARBOR_TEST_MODE: '1', HARBOR_DATA_DIR: path.join(temp, 'userdata') }; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: [project], env, timeout: 30000 });
    const exportFile = path.join(temp, 'connections.json');
    await app.evaluate(({ dialog }, file) => {
      globalThis.__workflowTest = { file, dialogs: [] };
      dialog.showMessageBox = async (_win, options) => { globalThis.__workflowTest.dialogs.push(options); return { response: 1 }; };
      dialog.showMessageBoxSync = () => 1;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.__workflowTest.file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__workflowTest.file] });
    }, exportFile);
    const page = await app.firstWindow(); page.on('pageerror', e => report.pageErrors.push(e.message));
    await page.getByRole('button', { name: '命令库', exact: true }).click();
    let library = page.getByRole('dialog', { name: '命令库', exact: true });
    await library.getByLabel('命令名称', { exact: true }).fill('参数化巡检');
    await library.getByLabel('命令文件夹', { exact: true }).fill('日常运维');
    await library.getByLabel('命令内容', { exact: true }).fill('printf "{{marker}}\\n"');
    await library.getByRole('button', { name: '保存命令', exact: true }).click();
    await library.getByRole('button', { name: /参数化巡检/ }).waitFor();
    await library.getByRole('button', { name: '填写参数', exact: true }).click();
    await library.getByLabel('参数 marker', { exact: true }).fill('MFA_UI_PROOF');
    await page.screenshot({ path: path.join(output, 'workflows-command-library.png') });
    await library.getByRole('button', { name: '填入命令', exact: true }).click();
    assert.equal(await page.getByLabel('批量命令', { exact: true }).inputValue(), 'printf "MFA_UI_PROOF\\n"');
    assert.equal(mfa.inputs.length, 0); report.checks.push('Command save, folder, parameter form and fill-only behavior');

    await page.getByRole('button', { name: '新建连接' }).click();
    let form = page.getByRole('dialog', { name: 'SSH 连接', exact: true });
    await form.getByLabel('连接名称', { exact: true }).fill('MFA 测试');
    await form.getByLabel('主机地址', { exact: true }).fill('127.0.0.1');
    await form.getByLabel('端口', { exact: true }).fill(String(mfa.port));
    await form.getByLabel('用户名', { exact: true }).fill('ops');
    await form.getByLabel('认证方式', { exact: true }).selectOption('interactive');
    await form.getByLabel('连接后自动记录日志', { exact: true }).check();
    await form.getByRole('button', { name: '保存并连接', exact: true }).click();
    let auth = page.getByRole('dialog', { name: 'SSH 交互认证', exact: true });
    await auth.getByLabel('认证回答 1', { exact: true }).fill(mfa.password);
    await auth.getByLabel('认证回答 2', { exact: true }).fill('123456');
    await auth.getByRole('button', { name: '提交认证', exact: true }).click();
    await auth.getByText('Second verification:', { exact: false }).waitFor();
    await auth.getByLabel('认证回答 1', { exact: true }).fill('654321');
    await auth.getByRole('button', { name: '提交认证', exact: true }).click();
    await page.getByLabel('批量目标 MFA 测试', { exact: true }).check();
    await page.getByRole('button', { name: '预览并发送', exact: true }).click();
    await waitFor(() => mfa.inputs.join('').includes('MFA_UI_PROOF'));
    await page.getByTitle('停止持续日志', { exact: true }).click();
    const logsDir = path.join(temp, 'userdata/logs');
    await waitFor(() => fs.readdirSync(logsDir).some(f => fs.readFileSync(path.join(logsDir, f), 'utf8').includes('MFA_UI_PROOF')));
    const log = fs.readdirSync(logsDir).map(f => fs.readFileSync(path.join(logsDir, f), 'utf8')).join('');
    assert.ok(!log.includes(mfa.password)); assert.ok(!log.includes('123456')); assert.ok(!log.includes('654321'));
    report.checks.push('MFA two rounds, selected batch delivery and opt-in log stop; authentication answers absent from logs');

    await page.getByRole('button', { name: '连接批量管理', exact: true }).click();
    const management = page.getByRole('dialog', { name: '连接批量管理', exact: true });
    await management.getByLabel('管理目标 MFA 测试', { exact: true }).check();
    await management.getByLabel('批量新值', { exact: true }).fill('批量验证');
    await management.getByRole('button', { name: '预览修改并确认', exact: true }).click();
    const workspace = path.join(temp, 'userdata/workspace.json');
    await waitFor(() => JSON.parse(fs.readFileSync(workspace)).profiles[0].group === '批量验证');
    await management.getByRole('button', { name: '导出所选配置', exact: true }).click();
    await waitFor(() => fs.existsSync(exportFile));
    const exported = JSON.parse(fs.readFileSync(exportFile)); assert.equal(exported.profiles[0].username, '');
    await management.getByRole('button', { name: '选择导入文件', exact: true }).click();
    await management.getByLabel('导入默认用户名', { exact: true }).fill('ops');
    await management.getByRole('button', { name: '预览导入并确认', exact: true }).click();
    await waitFor(() => JSON.parse(fs.readFileSync(workspace)).profiles.length === 2);
    assert.equal(JSON.parse(fs.readFileSync(workspace)).profiles[1].logEnabled, false);
    await page.screenshot({ path: path.join(output, 'workflows-connections.png') });
    await management.getByTitle('关闭连接批量管理', { exact: true }).click();
    report.checks.push('Bulk edit native preview, sanitized export, import preview and username completion; existing profile preserved');

    const jump = await page.evaluate(p => window.harbor.saveProfile(p), { name: 'UI Gateway', host: '127.0.0.1', port: gateway.port, username: 'ops', authType: 'password' });
    await page.getByRole('button', { name: '新建连接' }).click();
    form = page.getByRole('dialog', { name: 'SSH 连接', exact: true });
    await form.getByLabel('连接名称', { exact: true }).fill('跳板目标');
    await form.getByLabel('主机地址', { exact: true }).fill('127.0.0.1');
    await form.getByLabel('端口', { exact: true }).fill(String(target.port));
    await form.getByLabel('用户名', { exact: true }).fill('ops');
    await form.getByLabel('密码', { exact: true }).fill(target.password);
    await form.getByLabel('跳板连接', { exact: true }).selectOption(jump.id);
    await form.getByLabel('跳板密码', { exact: true }).fill(gateway.password);
    await form.getByRole('button', { name: '保存并连接', exact: true }).click();
    await page.getByLabel('批量目标 跳板目标', { exact: true }).waitFor();
    await page.getByRole('button', { name: '双栏分屏', exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(output, 'workflows-workspace.png') });
    report.checks.push('Jump host selection and separate ephemeral gateway/target passwords connect through real SSH forwarding');
    const serialized = fs.readFileSync(workspace, 'utf8');
    for (const secret of [mfa.password, gateway.password, target.password, '123456', '654321']) assert.ok(!serialized.includes(secret));
    assert.equal(await page.getByRole('dialog', { name: 'SSH 交互认证' }).count(), 0);
    assert.deepEqual(report.pageErrors, []);
    fs.writeFileSync(path.join(output, 'workflows-ui.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    if (app) {
      const windows = await app.windows();
      if (windows[0]) await windows[0].screenshot({ path: path.join(output, 'workflows-failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    if (app) await app.close();
    await mfa.close(); await gateway.close(); await target.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
