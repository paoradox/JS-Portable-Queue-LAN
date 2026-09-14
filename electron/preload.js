/*
 * electron/preload.js — Runs in a privileged context before the
 * control window's page loads, and exposes a small, deliberately
 * limited set of functions to it via `window.queueApp`.
 *
 * Why this file exists: Electron's recommended security setup keeps
 * contextIsolation on and nodeIntegration off in every window, which
 * means the page itself (control.html/control.js) can't reach Node.js
 * or Electron APIs directly. This file is the one narrow, explicit
 * bridge — it only exposes exactly the 5 functions the control window
 * actually needs, nothing more (not fs, not require, not ipcRenderer
 * itself).
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('queueApp', {
    getConnectionInfo: () => ipcRenderer.invoke('get-connection-info'),
    copyUrl: (url) => ipcRenderer.invoke('copy-url', url),
    openDisplay: () => ipcRenderer.invoke('open-display'),
    openAdmin: () => ipcRenderer.invoke('open-admin'),
    changePort: (port) => ipcRenderer.invoke('change-port', port)
});
