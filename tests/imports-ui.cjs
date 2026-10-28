const {_electron}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const XLSX=require('xlsx');
const {Store}=require('../desktop/store.cjs');const {parseImport}=require('../desktop/import-parser.cjs');const root=path.resolve(__dirname,'..');
const until=async fn=>{const end=Date.now()+10000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw new Error('Import UI evidence timeout');};
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sshultra-import-ui-'));const data=path.join(temp,'userdata');const old=new Store(data).save({name:'Existing',host:'existing.example',username:'ops'});
 const output=path.join(root,'test-results/imports-20261027');fs.mkdirSync(output,{recursive:true});const report={checks:[],pageErrors:[],packaged:Boolean(process.env.HARBOR_PACKAGED_APP)};let app;
 try{
  const env={...process.env,HARBOR_TEST_MODE:'1',HARBOR_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({...(process.env.HARBOR_PACKAGED_APP?{executablePath:process.env.HARBOR_PACKAGED_APP,args:[]}:{args:[root]}),env});
  await app.evaluate(({dialog})=>{
   globalThis.__imports={file:'',save:'',confirm:0,dialogs:[]};dialog.showMessageBoxSync=()=>1;
   dialog.showMessageBox=async(_win,options)=>{globalThis.__imports.dialogs.push(options);return{response:options.message.startsWith('新增 ')?globalThis.__imports.confirm:1};};
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[globalThis.__imports.file]});dialog.showSaveDialog=async()=>({canceled:false,filePath:globalThis.__imports.save});
  });
  const page=await app.firstWindow();page.on('pageerror',error=>report.pageErrors.push(error.message));await page.getByRole('button',{name:'连接批量管理',exact:true}).click();
  const manager=page.getByRole('dialog',{name:'连接批量管理',exact:true});const choose=manager.getByRole('button',{name:'选择导入文件',exact:true});const apply=manager.getByRole('button',{name:'预览导入并确认',exact:true});
  const read=async file=>{await app.evaluate((_e,file)=>{globalThis.__imports.file=file;},file);await choose.click();await until(()=>choose.isEnabled());};
  for(const format of ['xlsx','csv','txt','md']){
   const file=path.join(temp,`template.${format}`);fs.writeFileSync(file,'old');fs.chmodSync(file,0o644);await app.evaluate((_e,file)=>{globalThis.__imports.save=file;},file);
   await manager.getByLabel('导入模板格式',{exact:true}).selectOption(format);await manager.getByRole('button',{name:'保存导入模板',exact:true}).click();await manager.getByRole('status').filter({hasText:'模板已保存'}).waitFor();
   assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal((await parseImport(fs.readFileSync(file),`template.${format}`)).profiles.length,1);
  }
  report.checks.push('All four templates save through real IPC as private files and import successfully');
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['请选择 Hosts 工作表']]),'说明');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['名称','分组','主机地址','端口','用户名','跳板'],['Gateway','Prod','jump.example',22,'ops',''],['Target','Prod','target.example',2222,'ops','Gateway']]),'Hosts');
  const excel=path.join(temp,'list.xlsx');XLSX.writeFile(book,excel);await read(excel);await manager.getByText('将新增 0 个连接',{exact:true}).waitFor();
  await manager.getByLabel('导入工作表',{exact:true}).selectOption('Hosts');await manager.getByText('将新增 2 个连接',{exact:true}).waitFor();await manager.getByRole('table',{name:'导入连接预览'}).getByText('target.example:2222',{exact:true}).waitFor();
  await manager.getByRole('table',{name:'导入连接预览'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,report.packaged?'packaged-preview.png':'preview.png')});
  await apply.click();await until(()=>choose.isEnabled());assert.equal((await page.evaluate(()=>window.harbor.init())).profiles.length,1);
  await app.evaluate(()=>{globalThis.__imports.confirm=1;});await apply.click();await until(async()=>!(await apply.count()));
  const state=(await page.evaluate(()=>window.harbor.init())).profiles;assert.deepEqual(state.find(p=>p.id===old.id),old);assert.equal(state.find(p=>p.name==='Target').jumpProfileId,state.find(p=>p.name==='Gateway').id);
  assert.ok(fs.readdirSync(data).some(f=>f.startsWith('workspace-backup-')));report.checks.push('Binary XLSX sheet selection and row preview work; native cancel writes nothing; confirm appends with valid jump references and private backup');
  const oldXls=path.join(temp,'legacy.xls');
  const legacy=XLSX.utils.book_new();XLSX.utils.book_append_sheet(legacy,XLSX.utils.aoa_to_sheet([['Host','User'],['legacy.example','ops']]),'Hosts');XLSX.writeFile(legacy,oldXls);
  const csv=path.join(temp,'list.csv');fs.writeFileSync(csv,'名称,IP,用户名,密码\nCSV App,csv.example,,IGNORED_IMPORT_SECRET\n');
  const txt=path.join(temp,'list.txt');fs.writeFileSync(txt,'txt.example:2200\n');
  const md=path.join(temp,'list.md');fs.writeFileSync(md,'| 名称 | 主机地址 | 用户名 |\n| --- | --- | --- |\n| Markdown App | md.example | ops |\n');
  for(const file of [oldXls,csv,txt,md]){
   await read(file);await manager.getByText('将新增 1 个连接',{exact:true}).waitFor();
   const defaultUser=manager.getByLabel('导入默认用户名',{exact:true});if(await defaultUser.count())await defaultUser.fill('ops');
   await apply.click();await until(async()=>!(await apply.count()));
  }
  const imported=(await page.evaluate(()=>window.harbor.init())).profiles;assert.equal(imported.length,7);assert.equal(imported.find(p=>p.host==='csv.example').username,'ops');
  assert.ok(!fs.readFileSync(path.join(data,'workspace.json'),'utf8').includes('IGNORED_IMPORT_SECRET'));report.checks.push('Legacy XLS CSV TXT and Markdown import through the desktop; default username completion works and password column is excluded');
  await read(csv);const pending=await page.evaluate(()=>window.harbor.readImport());const invalid=path.join(temp,'invalid.csv');fs.writeFileSync(invalid,'Host,User,Port\ninvalid.example,ops,70000\n');await read(invalid);
  await page.getByRole('status').filter({hasText:'第 2 行'}).waitFor();assert.equal(await apply.count(),0);
  const result=await page.evaluate(async token=>{try{await window.harbor.applyImport(token,'ops');return false;}catch{return true;}},pending.token);assert.equal(result,true);assert.equal((await page.evaluate(()=>window.harbor.init())).profiles.length,7);
  report.checks.push('Invalid rows clear the previous preview and stale token; no partial import occurs');
  assert.deepEqual(report.pageErrors,[]);fs.writeFileSync(path.join(output,report.packaged?'packaged-ui.json':'ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{if(app)await app.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
