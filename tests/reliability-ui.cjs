const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFixture } = require('./fixture.cjs');

const project = path.resolve(__dirname, '..');
const waitFor = async (predicate, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('UI reliability evidence timed out');
};

async function run() {
  const fixture = await createFixture();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-ultra-ui-'));
  const checks = [];
  const pageErrors = [];
  let app;
  let page;
  try {
    const env = { ...process.env, HARBOR_TEST_MODE: '1', HARBOR_DATA_DIR: path.join(temp, 'userdata') };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: [project], env, timeout: 30000 });
    await app.evaluate(({ dialog }) => {
      globalThis.__harborTest = { dialogs: [], batchResponse: 1, upload: '', download: '' };
      dialog.showMessageBox = async (_window, options) => {
        globalThis.__harborTest.dialogs.push(options);
        return { response: options.title === '确认批量发送' ? globalThis.__harborTest.batchResponse : 1 };
      };
      dialog.showMessageBoxSync = () => 1;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__harborTest.upload] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.__harborTest.download });
    });
    page = await app.firstWindow();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.getByText('每个连接，都井然有序。').waitFor();

    const createProfile = async name => {
      await page.getByRole('button', { name: '新建连接' }).click();
      const form = page.getByRole('dialog', { name: 'SSH 连接', exact: true });
      await form.getByLabel('连接名称', { exact: true }).fill(name);
      await form.getByLabel('分组', { exact: true }).fill('本机隔离测试');
      await form.getByLabel('主机地址', { exact: true }).fill('127.0.0.1');
      await form.getByLabel('端口', { exact: true }).fill(String(fixture.port));
      await form.getByLabel('用户名', { exact: true }).fill('ops');
      await form.getByLabel('密码', { exact: true }).fill(fixture.password);
      await form.getByRole('button', { name: '保存并连接' }).click();
      await page.getByRole('tab', { name, exact: true }).waitFor();
      await page.getByLabel(`批量目标 ${name}`, { exact: true }).waitFor();
      await waitFor(async () => (await page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected')) === 'true');
    };

    await createProfile('Review B');
    const configPath = path.join(temp, 'userdata', 'workspace.json');
    const originalProfile = JSON.parse(fs.readFileSync(configPath, 'utf8')).profiles.find(profile => profile.name === 'Review B');
    assert.ok(originalProfile?.id);
    await page.getByTitle('编辑 Review B', { exact: true }).click();
    const editForm = page.getByRole('dialog', { name: 'SSH 连接', exact: true });
    await editForm.getByLabel('连接名称', { exact: true }).fill('Would overwrite Review B');
    await page.keyboard.press('Meta+n');
    const newForm = page.getByRole('dialog', { name: 'SSH 连接', exact: true });
    assert.equal(await newForm.locator('.modal-heading h2').innerText(), '新建 SSH 连接');
    assert.equal(await newForm.getByLabel('连接名称', { exact: true }).inputValue(), '');
    assert.equal(await newForm.getByLabel('主机地址', { exact: true }).inputValue(), '');
    await newForm.getByLabel('连接名称', { exact: true }).fill('Review New');
    await newForm.getByLabel('分组', { exact: true }).fill('本机隔离测试');
    await newForm.getByLabel('主机地址', { exact: true }).fill('127.0.0.1');
    await newForm.getByLabel('端口', { exact: true }).fill(String(fixture.port));
    await newForm.getByLabel('用户名', { exact: true }).fill('ops');
    await newForm.getByLabel('密码', { exact: true }).fill(fixture.password);
    await newForm.getByRole('button', { name: '保存并连接' }).click();
    await page.getByRole('tab', { name: 'Review New', exact: true }).waitFor();
    let savedProfiles = JSON.parse(fs.readFileSync(configPath, 'utf8')).profiles;
    assert.equal(savedProfiles.length, 2);
    assert.deepEqual(savedProfiles.find(profile => profile.id === originalProfile.id), originalProfile);
    checks.push('Cmd+N remounts a blank form; saving a new connection preserves the edited profile and creates a second ID');

    await createProfile('Review C');
    await page.getByRole('button', { name: '双栏分屏', exact: true }).click();
    const visibleIds = async () => page.locator('[data-testid="terminal-pane"]:visible').evaluateAll(nodes => nodes.map(node => node.dataset.sessionId));
    const beforeFocus = await visibleIds();
    assert.equal(beforeFocus.length, 2);
    const previouslyFocused = await page.locator('[data-testid="terminal-pane"].focused').getAttribute('data-session-id');
    const clickedId = beforeFocus.find(id => id !== previouslyFocused);
    assert.ok(clickedId);
    await page.locator(`[data-testid="terminal-pane"][data-session-id="${clickedId}"] .pane-header`).click();
    await page.locator(`[data-testid="terminal-pane"].focused[data-session-id="${clickedId}"]`).waitFor();
    assert.deepEqual((await visibleIds()).sort(), beforeFocus.sort());
    checks.push('Clicking a visible split pane changes focus without changing the visible session slots');

    await page.getByRole('button', { name: '单终端', exact: true }).click();
    await page.getByRole('tab', { name: 'Review B', exact: true }).click();
    const bPane = page.locator('[data-testid="terminal-pane"].focused');
    const bId = await bPane.getAttribute('data-session-id');
    assert.ok(bId);
    await waitFor(async () => (await bPane.locator('.connection-label').innerText()) === '已连接').catch(async error => {
      const state = await page.evaluate(() => ({
        tabs: [...document.querySelectorAll('.session-tab')].map(tab => ({ name: tab.querySelector('[role="tab"]')?.innerText, active: tab.querySelector('[role="tab"]')?.getAttribute('aria-selected') })),
        panes: [...document.querySelectorAll('[data-testid="terminal-pane"]')].map(pane => ({ id: pane.dataset.sessionId, visible: pane.style.display, focused: pane.classList.contains('focused'), status: pane.querySelector('.connection-label')?.textContent, error: pane.querySelector('.disconnected-bar')?.innerText || '' }))
      }));
      console.log(`Reconnect precondition diagnostic: ${JSON.stringify(state)}`);
      throw error;
    });
    await page.evaluate(async id => window.harbor.disconnect(id), bId);
    await bPane.locator('.disconnected-bar button').waitFor();
    await bPane.locator('.disconnected-bar button').click();
    await page.getByRole('dialog', { name: 'SSH 连接', exact: true }).waitFor();
    await page.getByTitle('关闭连接设置', { exact: true }).click();
    await page.getByRole('tab', { name: 'Review B', exact: true }).waitFor();
    await page.locator(`[data-testid="terminal-pane"][data-session-id="${bId}"]`).waitFor();
    const canceledTranscript = path.join(temp, 'cancelled-reconnect.txt');
    await app.evaluate((_electron, file) => { globalThis.__harborTest.download = file; }, canceledTranscript);
    const preservedPane = page.locator(`[data-testid="terminal-pane"][data-session-id="${bId}"]`);
    await preservedPane.getByTitle('导出回滚内容', { exact: true }).click();
    await waitFor(() => fs.existsSync(canceledTranscript));
    assert.match(fs.readFileSync(canceledTranscript, 'utf8'), /Connected to isolated loopback SSH server/);
    await preservedPane.getByTitle('搜索终端 ⌘F', { exact: true }).click();
    await preservedPane.getByRole('textbox', { name: '搜索终端', exact: true }).fill('Connected to isolated loopback');
    await preservedPane.getByRole('textbox', { name: '搜索终端', exact: true }).press('Enter');
    assert.equal(await preservedPane.getByText('未找到', { exact: true }).count(), 0);
    checks.push('Canceling reconnect keeps the original tab, terminal ID, searchable scrollback, and exportable output');

    await preservedPane.getByTitle('关闭搜索', { exact: true }).click();
    await preservedPane.locator('.disconnected-bar button').click();
    const reconnectForm = page.getByRole('dialog', { name: 'SSH 连接', exact: true });
    await reconnectForm.getByLabel('密码', { exact: true }).fill(fixture.password);
    await reconnectForm.getByRole('button', { name: '保存并连接' }).click();
    await waitFor(async () => (await page.locator(`[data-session-id="${bId}"] .connection-label`).innerText()) === '已连接');
    assert.ok(await page.getByRole('tab', { name: 'Review B', exact: true }).count() === 1);
    assert.equal(await page.locator(`[data-testid="terminal-pane"][data-session-id="${bId}"]`).count(), 1);
    const reconnectedTranscript = path.join(temp, 'reconnected-scrollback.txt');
    await app.evaluate((_electron, file) => { globalThis.__harborTest.download = file; }, reconnectedTranscript);
    await page.locator(`[data-testid="terminal-pane"][data-session-id="${bId}"]`).getByTitle('导出回滚内容', { exact: true }).click();
    await waitFor(() => fs.existsSync(reconnectedTranscript));
    assert.match(fs.readFileSync(reconnectedTranscript, 'utf8'), /Connected to isolated loopback SSH server/);
    savedProfiles = JSON.parse(fs.readFileSync(configPath, 'utf8')).profiles;
    assert.equal(savedProfiles.length, 3);
    assert.ok(!fs.readFileSync(configPath, 'utf8').includes(fixture.password));
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    checks.push('Successful reconnect reuses the original tab and terminal with retained scrollback; credentials are absent from disk and DOM');

    const pane = page.locator(`[data-testid="terminal-pane"][data-session-id="${bId}"]`);
    await pane.locator('.xterm-helper-textarea').focus();
    const sentBeforePaste = fixture.inputs.length;
    const pasteResult = await pane.locator('.xterm-helper-textarea').evaluate((element, text) => {
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', text);
      const event = new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return { prevented: event.defaultPrevented };
    }, `LONG_PASTE_MARKER${'x'.repeat(70000)}`);
    assert.equal(pasteResult.prevented, true);
    await page.getByRole('status').filter({ hasText: '粘贴内容超过 64 KiB，本次未发送' }).waitFor();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(fixture.inputs.length, sentBeforePaste);
    checks.push('A 70 KB paste is visibly rejected before IPC and sends no partial bytes');

    assert.deepEqual(pageErrors, []);
    checks.push('No renderer JavaScript errors');
    console.log(JSON.stringify({ checks, pageErrors }, null, 2));
  } finally {
    if (app) await app.close();
    await fixture.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
