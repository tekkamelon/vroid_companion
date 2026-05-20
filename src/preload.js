'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companion', {
  sendMessage: (text) => ipcRenderer.invoke('acp:send', text),
  onResponse:  (cb)   => ipcRenderer.on('acp:response', (_e, data) => cb(data)),
});
