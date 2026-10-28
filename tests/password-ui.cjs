const { _electron } = require('playwright'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { createFixture } = require('./fixture.cjs'); const root = path.resolve(__dirname,'..');
const until = async fn => {const end=Date.now()+10000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw new Error('Password UI evidence timeout');};
(async()=>{
 const fixture=await createFixture();const background=await createFixture();const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sshultra-password-ui-'));
 const output=path.join(root,'test-results/password-20261027');fs.mkdirSync(output,{recursive:true});
 const env={...process.env,HARBOR_TEST_MODE:'1',HARBOR_DATA_DIR:path.join(temp,'userdata')};delete env.ELECTRON_RUN_AS_NODE;
 const checks=[];const pageErrors=[];let app;
 try{
  app=await _electron.launch({...(process.env.HARBOR_PACKAGED_APP?{executablePath:process.env.HARBOR_PACKAGED_APP,args:[]}:{args:[root]}),env});
  await app.evaluate(({dialog},file)=>{dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path.join(temp,'scrollback.txt'));
  const page=await app.firstWindow();page.on('pageerror',e=>pageErrors.push(e.message));
  const create=async(name,server,password)=>{
   await page.getByRole('button',{name:'新建连接'}).click();const form=page.getByRole('dialog',{name:'SSH 连接',exact:true});
   for(const [label,value] of [['连接名称',name],['主机地址','127.0.0.1'],['端口',String(server.port)],['用户名','ops']])await form.getByLabel(label,{exact:true}).fill(value);
   if(password)await form.getByLabel('密码',{exact:true}).fill(password);
   await form.getByLabel('连接后自动记录日志',{exact:true}).check();await form.getByRole('button',{name:'保存并连接'}).click();
  };
  await create('Background',background,background.password);await page.getByLabel('批量目标 Background',{exact:true}).waitFor();
  await create('Deferred',fixture);const prompt=page.getByRole('form',{name:'终端密码认证'});const password=prompt.getByLabel('终端连接密码',{exact:true});
  await prompt.waitFor();assert.equal(await password.getAttribute('type'),'password');await until(()=>password.evaluate(el=>document.activeElement===el));
  await prompt.getByText(`ops@127.0.0.1:${fixture.port}`,{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,process.env.HARBOR_PACKAGED_APP?'packaged-prompt.png':'prompt.png')});
  await page.getByRole('tab',{name:'Background',exact:true}).click();
  const active=page.locator('[data-testid="terminal-pane"].focused');await active.locator('.xterm-helper-textarea').focus();await page.keyboard.type("printf 'BACKGROUND_STAYS_USABLE\\n'");await page.keyboard.press('Enter');
  await until(()=>background.inputs.join('').includes('BACKGROUND_STAYS_USABLE'));
  await page.getByRole('tab',{name:'Deferred',exact:true}).click();await until(()=>password.evaluate(el=>document.activeElement===el));
  const previous=background.inputs.join('');await password.fill(fixture.password);await page.keyboard.press('Enter');await page.getByLabel('批量目标 Deferred',{exact:true}).waitFor();
  assert.equal(background.inputs.join(''),previous);assert.equal(fixture.inputs.length,0);assert.equal(await page.getByLabel('终端连接密码').count(),0);
  checks.push('Empty configuration opens a masked prompt inside the correct terminal; tab switching keeps other sessions usable and password reaches neither shell');
  const pane=page.locator('[data-testid="terminal-pane"].focused');const id=await pane.getAttribute('data-session-id');
  await pane.locator('.xterm-helper-textarea').focus();await page.keyboard.type("printf 'DEFERRED_LOGIN_OK\\n'");await page.keyboard.press('Enter');await until(()=>fixture.inputs.join('').includes('DEFERRED_LOGIN_OK'));
  await pane.getByTitle('导出回滚内容',{exact:true}).click();await until(()=>fs.existsSync(path.join(temp,'scrollback.txt')));
  for(const server of [fixture,background]){
   assert.ok(!fs.readFileSync(path.join(temp,'userdata/workspace.json'),'utf8').includes(server.password));
   assert.ok(!fs.readFileSync(path.join(temp,'scrollback.txt'),'utf8').includes(server.password));
   assert.ok(!(await page.content()).includes(server.password));
  }
  const logDir=path.join(temp,'userdata/logs');await until(()=>fs.readdirSync(logDir).some(f=>fs.readFileSync(path.join(logDir,f),'utf8').includes('DEFERRED_LOGIN_OK')));
  assert.ok(!fs.readdirSync(logDir).map(f=>fs.readFileSync(path.join(logDir,f),'utf8')).join('').includes(fixture.password));
  checks.push('Successful login supports shell input and logging; password absent from profile, logs, scrollback export and DOM');
  await page.evaluate(id=>window.harbor.disconnect(id),id);await pane.getByRole('button',{name:'重新连接',exact:true}).click();
  await page.getByRole('dialog',{name:'SSH 连接',exact:true}).getByRole('button',{name:'保存并连接'}).click();await prompt.waitFor();
  assert.equal(await pane.getAttribute('data-session-id'),id);await page.keyboard.press('Escape');await pane.locator('.disconnected-bar').filter({hasText:'密码输入已取消或超时'}).waitFor();assert.equal(await prompt.count(),0);
  checks.push('Reconnect asks again with the same terminal; Escape cancels without losing prior output');
  // Accelerate only the existing authentication timeout, keeping normal product timing unchanged.
  await app.evaluate(()=>{const original=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>original(fn,ms===60000?100:ms,...args);});
  await pane.getByRole('button',{name:'重新连接',exact:true}).click();await page.getByRole('dialog',{name:'SSH 连接',exact:true}).getByRole('button',{name:'保存并连接'}).click();
  await pane.locator('.disconnected-bar').filter({hasText:'密码输入已取消或超时'}).waitFor();assert.equal(await prompt.count(),0);
  checks.push('Expired authentication removes the prompt and releases the connection');
  assert.deepEqual(pageErrors,[]);const report={checks,pageErrors,packaged:Boolean(process.env.HARBOR_PACKAGED_APP)};
  fs.writeFileSync(path.join(output,report.packaged?'packaged-ui.json':'ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{if(app)await app.close();await fixture.close();await background.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
