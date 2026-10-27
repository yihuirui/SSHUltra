const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (name, ...args) => {
  const result = await ipcRenderer.invoke(`harbor:${name}`, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('harbor', {
  init: () => invoke('init'), saveProfile: p => invoke('save-profile', p), deleteProfile: id => invoke('delete-profile', id),
  pickKey: () => invoke('pick-key'), connect: (id, p, c, g) => invoke('connect', id, p, c, g), disconnect: id => invoke('disconnect', id),
  input: (id, data) => invoke('input', id, data), resize: (id, cols, rows) => invoke('resize', id, cols, rows), ack: (id, bytes) => invoke('ack', id, bytes),
  batch: (ids, command) => invoke('batch', ids, command), list: (id, directory) => invoke('list', id, directory),
  upload: (id, directory) => invoke('upload', id, directory), download: (id, remote) => invoke('download', id, remote),
  exportScrollback: content => invoke('export-scrollback', content), newWindow: () => invoke('new-window'),
  onEvent: listener => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('harbor:event', handler);
    return () => ipcRenderer.removeListener('harbor:event', handler);
  }
});
