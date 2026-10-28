const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const XLSX=require('xlsx');const {parseImport}=require('../desktop/import-parser.cjs');const {runImport}=require('../desktop/import-service.cjs');const {importProfiles}=require('../desktop/migration.cjs');
const csv=text=>parseImport(Buffer.from(text),'connections.csv');
function workbook(sheets,bookType='xlsx',macro=false){const wb=XLSX.utils.book_new();for(const [name,rows] of sheets)XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);if(macro)wb.vbaraw=Buffer.from('synthetic macro blob, never executed');return XLSX.write(wb,{type:'buffer',bookType});}
test('CSV handles BOM quoted commas escaped quotes and multiline ignored passwords without leaking secrets',async()=>{
 const parsed=await csv('\uFEFF名称,分组,主机地址,端口,用户名,认证方式,密码\r\n"Ops ""Blue"", A",生产,192.0.2.10,2222,ops,密码,"SYNTHETIC_SECRET\nLINE2"\r\n');
 assert.equal(parsed.profiles[0].name,'Ops "Blue", A');assert.equal(parsed.profiles[0].port,2222);assert.ok(parsed.warnings.some(w=>w.includes('忽略密码')));assert.ok(!JSON.stringify(parsed).includes('SYNTHETIC_SECRET'));
});
test('English aliases semicolon sep line TSV and defaults map to validated connection fields',async()=>{
 const parsed=await csv('sep=;\r\nDisplay Name;Environment;IP Address;SSH Port;Login;Auth\r\nApp;Test;app.example;22;ops;SSH Agent\r\n');assert.equal(parsed.profiles[0].authType,'agent');assert.equal(parsed.profiles[0].group,'Test');
 const tab=await parseImport(Buffer.from('主机地址\t用户名\n192.0.2.1\tops\n'),'list.tsv');assert.equal(tab.profiles[0].port,22);assert.equal(tab.profiles[0].authType,'password');
});
test('UTF16 little/big endian and GBK Chinese CSV decode before header detection',async()=>{
 const text='主机地址,用户名\n192.0.2.1,ops\n';const le=Buffer.from(text,'utf16le');const be=Buffer.from(le);be.swap16();
 for(const data of [Buffer.concat([Buffer.from([255,254]),le]),Buffer.concat([Buffer.from([254,255]),be])])assert.equal((await parseImport(data,'list.csv')).profiles[0].host,'192.0.2.1');
 const gbk=await parseImport(Buffer.concat([Buffer.from('d6f7bbfa','hex'),Buffer.from(',username\n192.0.2.2,ops\n')]),'gbk.csv');assert.equal(gbk.profiles[0].host,'192.0.2.2');assert.match(gbk.warnings.join(''),/GB18030/);
});
test('TXT accepts address lists bracketed IPv6 and whitespace/tab tables without running commands',async()=>{
 const parsed=await parseImport(Buffer.from('# sample\nops@app.example:2200\n192.0.2.10\nops@[2001:db8::1]:22\n'),'list.txt');assert.equal(parsed.profiles.length,3);assert.equal(parsed.profiles[1].username,'');assert.equal(parsed.profiles[2].host,'2001:db8::1');
 const table=await parseImport(Buffer.from('主机 用户名 端口\n192.0.2.1 ops 22\n'),'table.txt');assert.equal(table.profiles[0].username,'ops');
 await assert.rejects(parseImport(Buffer.from('ssh ops@host; touch unexpected'),'list.txt'),/有效地址|缺少主机/);
});
test('Markdown extracts its first table supports escaped pipes and warns about additional tables',async()=>{
 const parsed=await parseImport(Buffer.from('# Hosts\n\n| 名称 | 主机地址 | 用户名 |\n| --- | :--- | ---: |\n| A\\|B | `app.example` | ops |\n\n| Host | User |\n| --- | --- |\n| other.example | ops |\n'),'list.md');assert.equal(parsed.profiles[0].name,'A|B');assert.equal(parsed.profiles[0].host,'app.example');assert.equal(parsed.profiles.length,1);assert.match(parsed.warnings.join(''),/第一张/);
});
test('invalid rows duplicate aliases malformed quoting and too many records fail without partial imports',async()=>{
 for(const [text,pattern] of [['主机地址,用户名,端口\n192.0.2.1,ops,70000',/第 2 行/],['host,ip\n192.0.2.1,192.0.2.2',/重复/],['host,user\n"broken,ops',/引号未闭合/],['host,user\n192.0.2.1,ops,extra',/第 2 行/],['name,user\napp,ops',/缺少主机/]])await assert.rejects(csv(text),pattern);
 await assert.rejects(csv('host,user\n'+Array.from({length:1001},()=> '192.0.2.1,ops').join('\n')),/1000/);
});
test('tabular jump names resolve only within a batch and imports preserve existing profiles with fresh IDs',async()=>{
 const parsed=await csv('名称,主机地址,用户名,跳板\nGateway,jump.example,ops,\nTarget,target.example,ops,Gateway');const existing={id:'existing',host:'old.example',username:'ops',revision:3};const imported=importProfiles([existing],parsed.profiles);assert.deepEqual(imported[0],existing);assert.equal(imported[2].jumpProfileId,imported[1].id);assert.equal(imported[2].credentialId,'');
 await assert.rejects(csv('名称,主机地址,跳板\nGateway,a.example,\nGateway,b.example,\nTarget,target.example,Gateway'),/唯一/);
});
test('XLSX and legacy XLS support explicit worksheet choice even when first worksheet is instructions',async()=>{
 const sheets=[['说明',[['Please use Hosts']]],['Hosts',[['名称','IP','用户名','端口'],['App','192.0.2.1','ops',2222]]]];
 for(const [type,ext] of [['xlsx','xlsx'],['xls','xls']]){
  const data=workbook(sheets,type);const initial=await parseImport(data,`list.${ext}`);assert.equal(initial.profiles.length,0);assert.deepEqual(initial.sheets,['说明','Hosts']);
  const selected=await parseImport(data,`list.${ext}`,'Hosts');assert.equal(selected.profiles[0].port,2222);assert.equal(selected.sheet,'Hosts');
  await assert.rejects(parseImport(data,`list.${ext}`,'Missing'),/工作表不存在/);
 }
});
test('Excel formulas are rejected in connection fields but ignored password cells never expose cached values',async()=>{
 const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet([['Host','Username','Password'],['app.example','ops','IGNORED_SECRET']]);ws.A2.f='"app.example"';XLSX.utils.book_append_sheet(wb,ws,'Hosts');
 const rejected=await parseImport(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),'list.xlsx');assert.equal(rejected.profiles.length,0);assert.match(rejected.warnings.join(''),/第 2 行.*公式/);
 delete ws.A2.f;ws.C2.f='"IGNORED_SECRET"';const ignored=await parseImport(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),'list.xlsx');assert.equal(ignored.profiles.length,1);assert.ok(!JSON.stringify(ignored).includes('IGNORED_SECRET'));
});
test('macro workbooks huge decompressed metadata and invalid binary formats are rejected',async()=>{
 await assert.rejects(parseImport(workbook([['Hosts',[['host'],['app.example']]]],'xlsm',true),'list.xlsx'),/宏/);
 const huge=workbook([['Hosts',[['host'],['app.example']]]]);const central=huge.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));assert.ok(central>=0);huge.writeUInt32LE(17*1024*1024,central+24);await assert.rejects(parseImport(huge,'list.xlsx'),/解压内容/);
 await assert.rejects(parseImport(Buffer.from('x'),'bad.xlsx'),/XLSX/);await assert.rejects(parseImport(Buffer.alloc(5*1024*1024+1),'large.csv'),/5 MiB/);
});
test('worker service handles normal Excel import cancellation and deadline without lingering threads',async()=>{
 const data=workbook([['Hosts',[['host','user'],['app.example','ops']]]]);assert.equal((await runImport(data,'list.xlsx')).profiles.length,1);
 const controller=new AbortController();const canceled=runImport(data,'list.xlsx',undefined,controller.signal);controller.abort();await assert.rejects(canceled,/取消/);
 await assert.rejects(runImport(data,'list.xlsx',undefined,undefined,1),/超时/);
});
test('shipped templates all import and contain no credentials or formulas',async()=>{
 for(const extension of ['xlsx','csv','txt','md']){const parsed=await parseImport(fs.readFileSync(path.join(__dirname,`../templates/import-connections.${extension}`)),`template.${extension}`);assert.equal(parsed.profiles.length,1);assert.equal(parsed.profiles[0].host,'192.0.2.10');assert.equal(parsed.profiles[0].username,'ops');assert.equal(parsed.profiles[0].credentialId,undefined);}
});
test('OpenSSH configuration saved as TXT stays compatible and unsupported proxies still fail closed',async()=>{
 const parsed=await parseImport(Buffer.from('Host app\nHostName app.example\nUser ops\n'),'config.txt');assert.equal(parsed.profiles[0].host,'app.example');
 await assert.rejects(parseImport(Buffer.from('Host app\nProxyCommand ssh gateway -W %h:%p\n'),'config.txt'),/无法安全迁移/);
});
