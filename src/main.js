'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'VRoid Companion',
    backgroundColor: '#1a1a2e',
  });
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[main] renderer finished load');
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.log(`[main] renderer failed load: ${errorCode} ${errorDescription}`);
  });
  if (process.platform === 'linux') {
    console.log('[main] gpu switches', {
      ozone: app.commandLine.getSwitchValue('ozone-platform'),
      useGl: app.commandLine.getSwitchValue('use-gl'),
      ignoreGpuBlocklist: app.commandLine.hasSwitch('ignore-gpu-blocklist'),
      disableFeatures: app.commandLine.getSwitchValue('disable-features'),
      libglAlwaysSoftware: process.env.LIBGL_ALWAYS_SOFTWARE,
      mesaLoaderDriverOverride: process.env.MESA_LOADER_DRIVER_OVERRIDE,
      galliumDriver: process.env.GALLIUM_DRIVER,
    });
  }
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
