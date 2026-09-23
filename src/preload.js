// Safe bridge between the UI pages and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  onSettings: on('settings:changed'),

  // timer
  getState: () => ipcRenderer.invoke('state:get'),
  onState: on('state'),
  breakNow: () => ipcRenderer.send('timer:breakNow'),
  skip: () => ipcRenderer.send('timer:skip'),
  snooze: () => ipcRenderer.send('timer:snooze'),
  back: () => ipcRenderer.send('timer:back'),
  pause: (minutes) => ipcRenderer.send('timer:pause', minutes),
  resume: () => ipcRenderer.send('timer:resume'),
  restart: () => ipcRenderer.send('timer:restart'),
  pauseMenu: () => ipcRenderer.send('menu:pause'),

  // stats
  getStats: () => ipcRenderer.invoke('stats:get'),
  clearStats: () => ipcRenderer.invoke('stats:clear'),
  onStats: on('stats:changed'),
  onNavTab: on('nav:tab'),

  // audio
  pickAudio: () => ipcRenderer.invoke('audio:pick'),
  audioUrls: (paths) => ipcRenderer.invoke('audio:urls', paths),
  onPreviewStop: on('preview:stop'),

  // break overlay
  onBreakStart: on('break:start'),
  onBreakWaiting: on('break:waiting'),
  onBreakClosing: on('break:closing'),

  appInfo: () => ipcRenderer.invoke('app:info'),
});
