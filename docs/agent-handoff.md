# vroid-companion — コーディングエージェント引き継ぎ資料

作成日: 2026-05-19 (rev2: ACP stdio対応版)  
プロジェクトディレクトリ: `~/Documents/github/vroid-companion`

---

## プロジェクト概要

VRoid Studio製VRMモデルをウィンドウに表示し、ユーザのテキスト入力をACPエージェント（zeroclaw・opencode・gooseなど）にサブプロセス経由で送信、その返答を受け取って表示・表情制御するElectronアプリケーション。

**このアプリの責務:**
- VRMモデルの表示・制御 (three.js + @pixiv/three-vrm)
- テキスト入出力UI
- **ACPクライアントとしてエージェントをサブプロセス起動し通信する**
- 返答テキストからの感情タグ抽出とBlendShape制御

**このアプリがやらないこと（エージェント側の責務）:**
- MCP管理、記憶・RAG、Discord連携、LLMとの直接通信

---

## 技術スタック・バージョン

```
Node.js          : v22.x LTS (fnm管理, .node-versionファイルあり)
Electron         : ^42.0.0
three.js         : ^0.180.0
@pixiv/three-vrm : ^3.5.2
smol-toml        : (TOML設定読み込み用、要npm install)
```

VRM形式: VRM 1.0 (VRoid Studio 2.x以降のデフォルト出力)

---

## ACPプロトコル仕様 (実装に必要な範囲)

ACP = Agent Client Protocol。JSON-RPC 2.0 over stdio（改行区切り）。  
クライアントがエージェントを `child_process.spawn()` で起動し、stdin/stdoutで通信する。

公式仕様: https://agentclientprotocol.com/protocol/overview

### 通信シーケンス

```
Client                          Agent (subprocess)
  |                                 |
  |-- initialize -----------------> |  バージョン・capability交換
  |<- initialize result ----------- |
  |                                 |
  |-- session/new ----------------> |  セッション作成
  |<- session/new result ---------- |
  |                                 |
  |-- session/prompt -------------> |  ユーザ入力送信
  |<- session/update (通知) ------- |  ストリーミング返答 (複数回)
  |<- session/prompt result ------- |  ターン終了
  |                                 |
  |-- session/cancel (通知) ------> |  中断時のみ
```

### メッセージ形式

すべての行が独立したJSONオブジェクト（NDJSON）。

**initialize リクエスト:**
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientInfo":{"name":"vroid-companion","version":"0.1.0"},"clientCapabilities":{}}}
```

**initialize レスポンス:**
```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"zeroclaw","version":"0.7.5"},"agentCapabilities":{}}}
```

**session/new リクエスト:**
```json
{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/home/user","mcpServers":[]}}
```

**session/new レスポンス:**
```json
{"jsonrpc":"2.0","id":2,"result":{"sessionId":"sess-abc123"}}
```

**session/prompt リクエスト:**
```json
{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"sess-abc123","messageId":"msg-001","prompt":[{"type":"text","text":"こんにちは"}]}}
```

**session/update 通知 (ストリーミング):**
```json
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess-abc123","update":{"agentMessageChunk":{"content":{"type":"text","text":"こんにちは"}}}}}
```

**session/prompt レスポンス (ターン終了):**
```json
{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}
```

**session/request_permission (エージェントからの許可要求):**
```json
{"jsonrpc":"2.0","id":10,"method":"session/request_permission","params":{"sessionId":"sess-abc123","toolCall":{"title":"シェルコマンド実行","description":"ls -la"},"options":[{"optionId":"allow","label":"許可"},{"optionId":"deny","label":"拒否"}]}}
```
クライアントはこれに応答する義務がある（最低限、自動承認でもよい）:
```json
{"jsonrpc":"2.0","id":10,"result":{"outcome":{"selected":{"optionId":"allow"}}}}
```

---

## 実装フェーズ

### Phase 1: VRMレンダリング確認

**目標:** VRMモデルがウィンドウに表示される。

`src/renderer/app.js` の `loadVrm()` 呼び出しのコメントを外す:
```js
loadVrm('./assets/models/model.vrm');
```

確認ポイント:
- モデルが表示されること
- `vrm.update(delta)` を毎フレーム呼んでいること（SpringBone動作のため必須）
- キャンバスのリサイズに追従すること

---

### Phase 2: ACPクライアント実装

**目標:** テキスト入力がエージェントに届き、返答が表示される。

実装箇所: `src/main.js`

```js
const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');
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
        this._proc    = null;
        this._buf     = '';
        this._pending = new Map(); // id -> { resolve, reject }
        this._onUpdate = null;
        this._command = command;
        this._args    = args;
        this._sessionId = null;
        this._nextId  = 1;
    }

    start() {
        this._proc = spawn(this._command, this._args, {
            stdio: ['pipe', 'pipe', 'inherit'],
        });
        this._proc.stdout.on('data', (chunk) => {
            this._buf += chunk.toString();
            const lines = this._buf.split('\n');
            this._buf = lines.pop(); // 未完の行を保持
            for (const line of lines) {
                if (line.trim()) this._handleLine(line);
            }
        });
        this._proc.on('exit', (code) => {
            console.log(`[ACP] agent exited: ${code}`);
        });
    }

    _handleLine(line) {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }

        // 通知 (id なし)
        if (msg.method === 'session/update' && this._onUpdate) {
            this._onUpdate(msg.params);
            return;
        }
        // 許可要求 (エージェント → クライアント のリクエスト)
        if (msg.method === 'session/request_permission') {
            // 最低限: 自動承認
            this._send({ jsonrpc:'2.0', id: msg.id, result: { outcome: { selected: { optionId: 'allow' } } } });
            return;
        }
        // レスポンス
        if (msg.id !== undefined && this._pending.has(msg.id)) {
            const { resolve, reject } = this._pending.get(msg.id);
            this._pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
        }
    }

    _send(obj) {
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

    async prompt(text) {
        const chunks = [];
        this._onUpdate = (params) => {
            const chunk = params?.update?.agentMessageChunk?.content?.text;
            if (chunk) chunks.push(chunk);
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
    const cmd    = config.agent.command;       // 例: "zeroclaw"
    const args   = config.agent.args ?? [];    // 例: ["acp"]
    const cwd    = config.agent.cwd ?? process.env.HOME;

    acpClient = new AcpClient(cmd, args);
    acpClient.start();
    await acpClient.initialize();
    await acpClient.newSession(cwd);
    console.log('[ACP] ready');
}

// ---- IPC ----
ipcMain.handle('acp:send', async (_event, text) => {
    if (!acpClient) throw new Error('ACPクライアント未初期化');
    const rawText = await acpClient.prompt(text);
    return rawText;
});

// ---- ウィンドウ ----
let mainWindow;
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800, height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        title: 'VRoid Companion',
        backgroundColor: '#1a1a2e',
    });
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
```

**設定ファイル `config/companion.toml` の対応するフィールド:**
```toml
[agent]
command = "zeroclaw"
args    = ["acp"]
cwd     = "/home/yourname"   # エージェントのワーキングディレクトリ
```

---

### Phase 3: 感情タグパース + 表情制御

エージェントのシステムプロンプトで末尾JSONタグを指示する前提でパースする。

```js
// src/renderer/app.js

const PRESET_EXPRESSIONS = ['neutral','happy','sad','angry','surprised','relaxed'];

function parseAgentResponse(raw) {
    if (typeof raw !== 'string') return { text: String(raw), emotion: null };
    const lines = raw.trim().split('\n');
    const last  = lines[lines.length - 1].trim();
    let emotion = null;
    let text    = raw.trim();
    try {
        const parsed = JSON.parse(last);
        if (parsed && typeof parsed.emotion === 'string') {
            emotion = { name: parsed.emotion, intensity: parsed.intensity ?? 1.0 };
            text = lines.slice(0, -1).join('\n').trim();
        }
    } catch (_) { /* タグなし */ }
    return { text, emotion };
}

function setExpression(name, intensity) {
    if (!currentVrm?.expressionManager) return;
    PRESET_EXPRESSIONS.forEach(e => currentVrm.expressionManager.setValue(e, 0));
    if (PRESET_EXPRESSIONS.includes(name)) {
        currentVrm.expressionManager.setValue(name, Math.min(1, Math.max(0, intensity)));
    }
}
```

---

### Phase 4: ストリーミング表示 (改善)

Phase 2では`session/update`通知を内部で結合してから表示している。  
ストリーミング表示にするには `session/update` を受け取るたびにIPC push する:

`src/main.js`:
```js
acpClient._onUpdate = (params) => {
    const chunk = params?.update?.agentMessageChunk?.content?.text;
    if (chunk && mainWindow) {
        mainWindow.webContents.send('acp:chunk', chunk);
    }
};
```

`src/preload.js`:
```js
onChunk: (cb) => ipcRenderer.on('acp:chunk', (_e, text) => cb(text)),
```

`src/renderer/app.js`:
```js
window.companion.onChunk((text) => appendToLastMessage(text));
```

---

### Phase 5: TTS + リップシンク (オプション)

TTS: Style-Bert-VITS2 をローカルREST APIとして起動し、返答テキストをPOST → WAV受信  
リップシンク: Web Audio APIでRMSを取得し `aa` 表情のintensityに写像

---

## ファイル編集ガイド

### src/main.js
Electronメインプロセス + ACPクライアント全体をここに書く。  
IPC handler: `acp:send` (ユーザ入力送信), `config:get`, `dialog:openVrm`

### src/preload.js
contextBridgeでrendererに安全なAPIを公開。Node.js APIをrendererから直接呼ばない。

```js
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('companion', {
    sendMessage:   (text) => ipcRenderer.invoke('acp:send', text),
    onChunk:       (cb)   => ipcRenderer.on('acp:chunk', (_e, t) => cb(t)),
    getConfig:     ()     => ipcRenderer.invoke('config:get'),
    openVrmDialog: ()     => ipcRenderer.invoke('dialog:openVrm'),
});
```

### src/renderer/app.js
UIイベント・three.js・three-vrmのロジックをすべてここに書く。  
`require` は禁止。`window.companion.*` 経由でmainと通信する。

---

## セキュリティ設定

```js
webPreferences: {
    contextIsolation: true,  // 必須: ON
    nodeIntegration: false,  // 必須: OFF
}
```

---

## よくある落とし穴

| 症状 | 原因 | 対処 |
|---|---|---|
| VRMが表示されない | loadVrm() 未呼び出し or パス誤り | コンソールのGLTFLoaderエラーを確認 |
| 表情が変わらない | expressionManagerがnull or キー名誤り | VRM 1.0はexpressionManager、0.xはblendShapeProxy |
| ACPが応答しない | エージェントが起動していない or コマンド誤り | `config/companion.toml`のcommand/argsを確認 |
| 行が来ない | エージェントが\rを使う場合 | `chunk.toString().replace(/\r/g, '')` でトリム |
| Waylandで描画乱れ | Electronデフォルト | `--ozone-platform=x11` フラグを追加 |
| SpringBoneが動かない | vrm.update() を呼んでいない | レンダーループ内で毎フレーム呼ぶ |
| session/request_permissionで止まる | 応答していない | 自動承認レスポンスを返す実装が必要 |

---

## 設定ファイル (config/companion.toml)

```toml
[agent]
# ACPサーバとして動作するエージェントの起動コマンドと引数
# zeroclaw の場合:
command = "zeroclaw"
args    = ["acp"]
# opencode の場合:
# command = "opencode"
# args    = []
# goose の場合:
# command = "goose"
# args    = ["--acp"]  # 要確認
cwd = "/home/yourname"  # エージェントのワーキングディレクトリ (絶対パス)

[model]
vrm_path = "assets/models/model.vrm"

[display]
width  = 800
height = 900
```

---

## 参考リンク

- claudeとのやり取り: https://claude.ai/share/5cbee744-17de-48d9-a2be-7d5bcde1d433
- @pixiv/three-vrm: https://pixiv.github.io/three-vrm/
- Electron IPC: https://www.electronjs.org/docs/latest/tutorial/ipc
- ACP仕様 Overview: https://agentclientprotocol.com/protocol/overview
- ACP仕様 Prompt Turn: https://agentclientprotocol.com/protocol/prompt-turn
- ACP仕様 Schema: https://agentclientprotocol.com/protocol/schema
- zeroclaw リポジトリ: https://github.com/zeroclaw-labs/zeroclaw
