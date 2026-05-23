'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { parse: parseToml } = require('smol-toml');
const { randomUUID } = require('crypto');

// ---- 設定読み込み ----
function loadConfig() {
  const cfgPath = path.join(__dirname, '..', 'config', 'companion.toml');
  return parseToml(fs.readFileSync(cfgPath, 'utf8'));
}

// ---- ACPクライアント ----
class AcpClient {
  constructor(command, args = []) {
    this._proc = null;
    this._buf = '';
    this._pending = new Map(); // id -> { resolve, reject }
    this._onUpdate = null;
    this._command = command;
    this._args = args;
    this._sessionId = null;
    this._nextId = 1;
  }

  start() {
    console.log('[ACP] spawning:', this._command, this._args);
    this._proc = spawn(this._command, this._args, {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this._proc.stdout.on('data', (chunk) => {
      // \r を除去してから改行で分割 (ACP line-buffering quirk)
      this._buf += chunk.toString().replace(/\r/g, '');
      const lines = this._buf.split('\n');
      this._buf = lines.pop(); // 未完の行を保持
      for (const line of lines) {
        if (line.trim()) this._handleLine(line);
      }
    });
    this._proc.on('exit', (code) => {
      console.log('[ACP] agent exited: ' + code);
    });
  }

  _handleLine(line) {
    console.log('[ACP] <=', line.substring(0, 200));
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log('[ACP] failed to parse line');
      return;
    }

    if (msg.method === 'session/update' && this._onUpdate) {
      this._onUpdate(msg.params);
      return;
    }
    if (msg.method === 'session/request_permission') {
      this._send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          outcome: {
            selected: {
              optionId: 'allow',
            },
          },
        },
      });
      return;
    }
    if (msg.id !== undefined && this._pending.has(msg.id)) {
      const { resolve, reject } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  }

  _send(obj) {
    if (!this._proc || this._proc.stdin.destroyed) return;
    this._proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  _request(method, params) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async initialize() {
    return this._request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'vroid-companion', version: '0.1.0' },
      clientCapabilities: {},
    });
  }

  async newSession(cwd) {
    const result = await this._request('session/new', { cwd, mcpServers: [] });
    this._sessionId = result.sessionId;
    return result;
  }

  _extractChunk(params) {
    // 複数のACP実装に対応したチャンク抽出
    const u = params?.update;
    if (!u) return null;

    // Pattern A: spec-compliant agentMessageChunk.content.text
    if (u.agentMessageChunk?.content?.text) return u.agentMessageChunk.content.text;
    // Pattern B: snake_case
    if (u.agent_message_chunk?.content?.text) return u.agent_message_chunk.content.text;
    // Pattern C: content.text
    if (u.content?.text) return u.content.text;
    // Pattern D: content as string
    if (typeof u.content === 'string') return u.content;
    // Pattern E: messageChunk.text
    if (u.messageChunk?.text) return u.messageChunk.text;
    // Pattern F: sessionUpdate agent_message_chunk content.text
    if (u.sessionUpdate === 'agent_message_chunk' && u.content?.text) return u.content.text;

    return null;
  }

  async prompt(text, onChunk) {
    const chunks = [];
    this._onUpdate = (params) => {
      const chunk = this._extractChunk(params);
      if (chunk) {
        chunks.push(chunk);
        if (onChunk) onChunk(chunk);
      }
    };
    await this._request('session/prompt', {
      sessionId: this._sessionId,
      messageId: randomUUID(),
      prompt: [{ type: 'text', text }],
    });
    this._onUpdate = null;
    return chunks.join('');
  }

  stop() {
    if (this._proc) this._proc.kill();
  }
}

// ---- グローバルクライアント ----
let acpClient = null;

async function initAcp() {
  const config = loadConfig();
  const cmd = config.agent?.command;
  const args = config.agent?.args ?? [];
  const cwd = config.agent?.cwd ?? process.env.HOME ?? '/tmp';

  if (!cmd) {
    console.error('[ACP] agent.command not set in config/companion.toml');
    return;
  }

  acpClient = new AcpClient(cmd, args);
  acpClient.start();
  await acpClient.initialize();
  await acpClient.newSession(cwd);
  console.log('[ACP] ready');
}

// ---- IPC ----
ipcMain.handle('acp:send', async (_event, text) => {
  if (!acpClient) throw new Error('ACP client not initialized');
  console.log('[IPC] acp:send received, length:', text?.length ?? 0);
  
  const rawText = await acpClient.prompt(text, (chunk) => {
    console.log('[IPC] streaming chunk length:', chunk?.length ?? 0);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('acp:chunk', chunk);
    }
  });
  
  console.log('[IPC] acp:send complete, response length:', rawText?.length ?? 0);
  return rawText;
});

ipcMain.handle('config:get', async () => {
  return loadConfig();
});

// ---- ウィンドウ ----
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
    console.log('[main] renderer failed load: ' + errorCode + ' ' + errorDescription);
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

app.whenReady().then(async () => {
  await initAcp();
  createWindow();
});

app.on('window-all-closed', () => {
  if (acpClient) acpClient.stop();
  if (process.platform !== 'darwin') app.quit();
});