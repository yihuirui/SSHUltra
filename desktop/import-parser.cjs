const path = require('node:path');
const { parseConfig } = require('./migration.cjs');
const { tableProfiles, parseTextTable, decodeText, headerKey, MAX_ROWS, MAX_COLUMNS } = require('./tabular-import.cjs');
const MAX_FILE_BYTES = 5 * 1024 * 1024;
async function checkZip(buffer) {
  const yauzl = require('yauzl');
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) { reject(new Error('Excel 压缩包损坏，无法读取')); return; }
      let entries = 0, declared = 0, actual = 0, failed = false;
      const fail = () => { if (!failed) { failed = true; zip.close(); reject(new Error('Excel 压缩内容损坏、加密或超出限制（最多 2000 个条目、32 MiB 解压内容）')); } };
      zip.on('error', fail); zip.on('end', () => { if (!failed) resolve(); });
      zip.on('entry', entry => {
        if (++entries > 2000 || (entry.generalPurposeBitFlag & 1) || entry.uncompressedSize > 16 * 1024 * 1024 || (declared += entry.uncompressedSize) > 32 * 1024 * 1024) { fail(); return; }
        zip.openReadStream(entry, (error, stream) => {
          if (error) { fail(); return; }
          stream.on('error', fail);
          stream.on('data', chunk => { actual += chunk.length; if (actual > 32 * 1024 * 1024) { stream.destroy(); fail(); } });
          stream.once('end', () => { if (!failed) zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}
async function parseWorkbook(buffer, extension, selectedSheet) {
  const XLSX = require('xlsx');
  if (extension === 'xlsx') {
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('请选择未加密的 XLSX 工作簿；其他文件请另存为 XLSX');
    await checkZip(buffer);
  } else if (buffer.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') throw new Error('请选择 Excel 97–2003 XLS 工作簿，或另存为 XLSX');
  let metadata;
  try { metadata = XLSX.read(buffer, { type: 'buffer', bookSheets: true }); }
  catch { throw new Error('Excel 文件无法读取；请解除文件密码并另存为 XLSX 后重试'); }
  const sheets = metadata.SheetNames;
  if (!sheets?.length || sheets.length > 20 || sheets.some(name => name.length > 160)) throw new Error('工作簿应有 1–20 张工作表');
  const sheet = selectedSheet ?? sheets[0];
  if (typeof sheet !== 'string' || !sheets.includes(sheet)) throw new Error('工作表不存在，请重新选择导入文件');
  let workbook;
  try { workbook = XLSX.read(buffer, { type: 'buffer', sheets: sheet, sheetRows: MAX_ROWS + 2, cellFormula: true, cellHTML: false, cellText: false, cellDates: true, bookVBA: true }); }
  catch { throw new Error('Excel 文件无法读取；请解除文件密码并另存为 XLSX 后重试'); }
  if (workbook.vbaraw) throw new Error('工作簿包含宏；请另存为不含宏的 XLSX 后导入');
  try {
    const ws = workbook.Sheets[sheet];
    if (!ws || !ws['!ref']) throw new Error('当前工作表为空，请选择存放连接的工作表');
    const bounds = XLSX.utils.decode_range(ws['!fullref'] || ws['!ref']);
    if (bounds.e.r > MAX_ROWS || bounds.e.c >= MAX_COLUMNS) throw new Error(`工作表最多 ${MAX_ROWS + 1} 行（含表头）、${MAX_COLUMNS} 列；请清理多余行列或分批导入`);
    const rows = [];
    for (let r=0;r<=bounds.e.r;r++) {
      const row=[];for(let c=0;c<=bounds.e.c;c++)row.push(ws[XLSX.utils.encode_cell({r,c})]?.v ?? '');rows.push(row);
    }
    const header = rows.findIndex(row=>row.some(v=>String(v??'').trim()));
    if(header>=0) for(let c=0;c<rows[header].length;c++) {
      const key=headerKey(rows[header][c]);if(!key || key==='secret')continue;
      for(let r=header;r<rows.length;r++) { const cell=ws[XLSX.utils.encode_cell({r,c})];if(cell && (cell.f || cell.F || cell.t==='e' || cell.t==='d'))throw new Error(`第 ${r+1} 行含公式、错误或日期单元格，请先将连接字段转换为普通文本／数字`); }
    }
    return { ...tableProfiles(rows), sheets, sheet, format: 'Excel' };
  } catch(error) {
    // Keep worksheet selection available even when the first tab is instructions or malformed.
    return { profiles: [], warnings: [error.message], sheets, sheet, format: 'Excel' };
  }
}
async function parseImport(input, filename, selectedSheet) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error('导入文件为空或超过 5 MiB');
  const extension = path.extname(filename).slice(1).toLowerCase();
  if (['xlsx','xls'].includes(extension)) return parseWorkbook(buffer, extension, selectedSheet);
  const { text, warnings } = decodeText(buffer);
  if (text.includes('\0')) throw new Error('文件包含二进制内容；请使用 XLSX/XLS 或 UTF-8 文本');
  let parsed;
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const sshText = extension === 'txt' && (/^(Include|Match|ProxyCommand)\s/i.test(lines[0] || '') ||
    /^Host\s/i.test(lines[0] || '') && !lines[0].split(/\s+/).every(headerKey) && lines.slice(1).some(line => /^(HostName|User|Port|IdentityFile|ProxyJump|ProxyCommand|Include)\s/i.test(line)));
  if (sshText) parsed = parseConfig(text, filename);
  else if (['csv','tsv','txt','md','markdown'].includes(extension)) parsed = parseTextTable(text, extension);
  else {
    if (!['json','ini','conf','config',''].includes(extension)) throw new Error('不支持此格式；请选择 XLSX、XLS、CSV、TSV、TXT、MD、SSHUltra JSON、INI 或 SSH config');
    try { parsed = parseConfig(text, filename); }
    catch(error) { if (extension==='json' && error instanceof SyntaxError) throw new Error('JSON 格式无效，请检查文件结构'); throw error; }
  }
  return { ...parsed, warnings: [...warnings, ...parsed.warnings], format: extension.toUpperCase() || 'OpenSSH config' };
}
module.exports = { parseImport, MAX_FILE_BYTES };
