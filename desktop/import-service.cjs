const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { MAX_FILE_BYTES } = require('./import-parser.cjs');
function runImport(data, filename, sheet, signal, timeoutMs = 8000) {
  if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_FILE_BYTES) return Promise.reject(new Error('导入文件为空或超过 5 MiB'));
  if (signal?.aborted) return Promise.reject(new Error('导入已取消'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'import-worker.cjs'), { workerData: { data, filename, sheet }, resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
    let finished = false;
    const finish = (error, value) => {
      if (finished) return; finished = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      void worker.terminate().then(() => { if (error) reject(error); else resolve(value); }, () => reject(new Error('无法释放导入解析线程，请重试')));
    };
    const abort = () => finish(new Error('导入已取消'));
    const timer = setTimeout(() => finish(new Error('导入解析超时，请简化文件或分批导入')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', message => finish(message.error ? new Error(message.error) : null, message.value));
    worker.on('error', () => finish(new Error('导入解析失败或超出内存限制，请简化文件后重试')));
    worker.on('exit', () => { if (!finished) finish(new Error('导入解析未完成，请检查文件')); });
  });
}
module.exports = { runImport };
