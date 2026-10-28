const { parentPort, workerData } = require('node:worker_threads');
const { parseImport } = require('./import-parser.cjs');
parseImport(workerData.data, workerData.filename, workerData.sheet)
  .then(value => parentPort.postMessage({ value }))
  .catch(error => parentPort.postMessage({ error: error.message }));
