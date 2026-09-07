'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  startCall: (data) => ipcRenderer.invoke('start-call', data),
  stopCall: () => ipcRenderer.invoke('stop-call'),
  llmCall: (payload) => ipcRenderer.invoke('llm-call', payload),
  onSessionData: (cb) => ipcRenderer.on('session-data', (_, data) => cb(data)),
  removeSessionDataListener: () => ipcRenderer.removeAllListeners('session-data'),
});
