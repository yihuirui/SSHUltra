const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { Store } = require('../desktop/store.cjs'); const { SSHManager } = require('../desktop/ssh.cjs'); const { createFixture } = require('./fixture.cjs');
const profile = fixture => ({ name: 'Password fixture', host: '127.0.0.1', port: fixture.port, username: 'ops', authType: 'password' });
async function setup(t, options = {}) {
 const fixture = await createFixture(options); const directory = fs.mkdtempSync(path.join(os.tmpdir(),'sshultra-password-'));
 const store = new Store(directory); const events = []; const managers = [];
 t.after(async () => { for(const manager of managers) manager.closeAll(); await fixture.close(); fs.rmSync(directory,{recursive:true,force:true}); });
 const manager = overrides => { const m = new SSHManager({ store, emit:e=>events.push(e), confirmHost:async()=>true,...overrides });managers.push(m);return m; };
 return { fixture, store, directory, events, manager };
}
const until = async fn => {const end=Date.now()+4000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,15));}throw new Error('Timed out waiting for password evidence');};
for (const password of ['',undefined]) test(`missing password (${password === '' ? 'empty' : 'omitted'}) waits after host trust before password authentication`,{timeout:10000},async t=>{
 const {fixture,manager,store}=await setup(t); const methods=[];fixture.events.on('authentication',method=>methods.push(method));let trusted=false,prompts=0;
 const m=manager({confirmHost:async()=>{trusted=true;return true;},requestAuth:async info=>{
   prompts++;assert.equal(trusted,true);assert.equal(info.presentation,'terminal');assert.equal(info.username,'ops');assert.equal(info.port,fixture.port);assert.equal(info.prompts[0].echo,false);
   assert.ok(!methods.includes('password'));assert.equal(fixture.inputs.length,0);return [fixture.password];
 }});
 await m.connect('late',profile(fixture),{password});assert.equal(prompts,1);assert.equal(methods.filter(m=>m==='password').length,1);
 await m.write('late',"printf 'PROMPT_CONNECTED\\n'\r");await until(()=>fixture.inputs.length>0);assert.ok(!fixture.inputs.join('').includes(fixture.password));
 assert.ok(!JSON.stringify(store.state).includes(fixture.password));
});
test('provided password skips the prompt; declined host key never asks for a password',{timeout:10000},async t=>{
 const {fixture,manager}=await setup(t);let asked=0;const requestAuth=async()=>{asked++;throw new Error('unexpected prompt');};
 await manager({requestAuth}).connect('filled',profile(fixture),{password:fixture.password});assert.equal(asked,0);
 const m=manager({requestAuth,confirmHost:async()=>false,store:new Store(fs.mkdtempSync(path.join(os.tmpdir(),'sshultra-denied-')))});
 // Keep all test data under cleanup ownership even for the untrusted store.
 t.after(()=>fs.rmSync(m.store.directory,{recursive:true,force:true}));
 await assert.rejects(m.connect('denied',profile(fixture),{}),/未信任/);assert.equal(asked,0);
});
test('cancel and late answer after disconnect release pending session without creating a shell',{timeout:10000},async t=>{
 const {fixture,manager}=await setup(t);
 const canceled=manager({requestAuth:async()=>null});await assert.rejects(canceled.connect('cancel',profile(fixture),{}),/取消|超时/);await until(()=>!canceled.sessions.size);
 let answer;const late=manager({requestAuth:()=>new Promise(resolve=>{answer=resolve;})});
 const pending=late.connect('late',profile(fixture),{});const rejected=assert.rejects(pending,/关闭|取消/);
 await until(()=>Boolean(answer));late.disconnect('late');answer([fixture.password]);await rejected;await until(()=>!late.sessions.size);assert.equal(fixture.inputs.length,0);
});
test('blank jump and target passwords ask independently for the endpoint being authenticated',{timeout:10000},async t=>{
 const gateway=await createFixture({allowForward:true});t.after(()=>gateway.close());const {fixture,manager,store}=await setup(t);
 const jump=store.save(profile(gateway));const seen=[];const m=manager({requestAuth:async info=>{seen.push(info);return [info.port===gateway.port?gateway.password:fixture.password];}});
 const target=store.save({...profile(fixture),jumpProfileId:jump.id});await m.connect('hop',target,{});
 assert.deepEqual(seen.map(p=>p.name),['跳板机密码','服务器密码']);assert.deepEqual(seen.map(p=>p.port),[gateway.port,fixture.port]);assert.equal(gateway.inputs.length,0);
});
test('password-only profile still uses multi-round keyboard-interactive when server requires it',{timeout:10000},async t=>{
 const {fixture,manager}=await setup(t,{keyboard:true});const prompts=[];
 const m=manager({requestAuth:async info=>{prompts.push(info);return prompts.length===1?[fixture.password,'123456']:['654321'];}});
 await m.connect('keyboard',profile(fixture),{});assert.equal(prompts.length,2);assert.ok(prompts.every(p=>p.presentation!=='terminal'));
});
