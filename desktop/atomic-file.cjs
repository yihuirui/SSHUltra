const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Commit only a complete private file. On failure, the previous target survives.
function atomicWritePrivate(file, data, io = fs) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let fd; let created = false;
  try {
    fd = io.openSync(temp, 'wx', 0o600); created = true;
    io.fchmodSync(fd, 0o600);
    io.writeFileSync(fd, data, { encoding: 'utf8' });
    io.fsyncSync(fd);
    io.closeSync(fd); fd = undefined;
    io.renameSync(temp, file); created = false;
  } finally {
    if (fd !== undefined) { try { io.closeSync(fd); } catch {} }
    if (created) { try { io.unlinkSync(temp); } catch {} }
  }
}
module.exports = { atomicWritePrivate };
