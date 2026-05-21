'use strict';

// Electronのメインプロセス
// ウィンドウ管理とレンダラープロセスの起動を担当する

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// メインウィンドウの参照を保持するグローバル変数
let mainWindow;

// メインウィンドウを作成する関数
function createWindow() {
  // BrowserWindow を作成して設定する
  mainWindow = new BrowserWindow({
    width: 800,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // レンダラーから直接Node APIを触れないように分離する
      contextIsolation: true,
      // Node.js integration を無効化してセキュリティを高める
      nodeIntegration: false,
    },
    title: 'VRoid Companion',
    backgroundColor: '#1a1a2e',
  });

  // レンダラー画面の読み込み完了時にログを出力する
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[main] renderer finished load');
  });

  // レンダラー画面の読み込み失敗時にログを出力する
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.log(`[main] renderer failed load: ${errorCode} ${errorDescription}`);
  });

  // Linux環境でのみGPU関連の設定値をデバッグ出力する
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

  // レンダラーHTMLを読み込む
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Electronの準備が完了したらウィンドウを開く
app.whenReady().then(createWindow);

// すべてのウィンドウが閉じられたらアプリケーションを終了する
// macOSではドックアイコンが残るため終了しない
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
