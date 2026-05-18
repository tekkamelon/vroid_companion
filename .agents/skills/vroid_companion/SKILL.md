---
name: vroid-companion
description: >
  Electron + @pixiv/three-vrm + ACP (Agent Client Protocol) を使ったVRoid AIコンパニオンアプリの開発スキル。
  このスキルは以下の場合に必ず参照すること:
  - vroid-companion プロジェクトへの機能追加・修正
  - ACP (JSON-RPC 2.0 over stdio) クライアントの実装
  - three-vrm のBlendShape/expressionManager操作
  - Electronのメインプロセス・レンダラー間IPC実装
  - VRMモデルのロード・制御コード作成
  ファイル名 main.js / preload.js / app.js の編集時も必ず参照すること。
---

# vroid-companion 開発スキル

## アーキテクチャ原則

```
[renderer/app.js]
  window.companion.* API (contextBridge)
      ↕ IPC (ipcRenderer ↔ ipcMain)
[main.js]  ← AcpClient クラスをここに実装
  JSON-RPC 2.0 over stdio (child_process.spawn)
      ↓
[zeroclaw acp / opencode / goose 等]
  ← 対応エージェントはconfig.tomlで切り替え
```

**責務の境界:**
- rendererはNode.js APIを使わない (`require` 禁止)
- mainはDOM操作をしない
- エージェント起動・通信ロジックはmain.jsのAcpClientクラスに集約

---

## ACP実装パターン

### AcpClientクラス (main.js)

```js
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

class AcpClient {
    constructor(command, args = []) {
        this._proc      = null;
        this._buf       = '';
        this._pending   = new Map(); // id -> { resolve, reject }
        this._onUpdate  = null;      // session/update 通知コールバック
        this._command   = command;
        this._args      = args;
        this._sessionId = null;
        this._nextId    = 1;
    }

    start() {
        this._proc = spawn(this._command, this._args, {
            stdio: ['pipe', 'pipe', 'inherit'], // stderrはそのまま流す
        });
        this._proc.stdout.on('data', (chunk) => {
            this._buf += chunk.toString().replace(/\r/g, '');
            const lines = this._buf.split('\n');
            this._buf = lines.pop();
            for (const line of lines) {
                if (line.trim()) this._handleLine(line);
            }
        });
        this._proc.on('exit', (code) => console.log(`[ACP] exit: ${code}`));
    }

    _handleLine(line) {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }

        // エージェント → クライアントの通知
        if (msg.method === 'session/update') {
            if (this._onUpdate) this._onUpdate(msg.params);
            return;
        }
        // エージェント → クライアントのリクエスト (許可要求)
        if (msg.method === 'session/request_permission') {
            // 最低限: 自動承認 (後でUIに置き換える)
            this._send({
                jsonrpc: '2.0', id: msg.id,
                result: { outcome: { selected: { optionId: 'allow' } } },
            });
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
        const result = await this._request('session/new', {
            cwd, mcpServers: [],
        });
        this._sessionId = result.sessionId;
        return result;
    }

    // ストリーミングなしで全文返す版
    async prompt(text) {
        const chunks = [];
        this._onUpdate = (params) => {
            const t = params?.update?.agentMessageChunk?.content?.text;
            if (t) chunks.push(t);
        };
        await this._request('session/prompt', {
            sessionId: this._sessionId,
            messageId: randomUUID(),
            prompt: [{ type: 'text', text }],
        });
        this._onUpdate = null;
        return chunks.join('');
    }

    // ストリーミング版 (onChunk コールバックにchunkを渡す)
    async promptStreaming(text, onChunk) {
        this._onUpdate = (params) => {
            const t = params?.update?.agentMessageChunk?.content?.text;
            if (t) onChunk(t);
        };
        const result = await this._request('session/prompt', {
            sessionId: this._sessionId,
            messageId: randomUUID(),
            prompt: [{ type: 'text', text }],
        });
        this._onUpdate = null;
        return result;
    }

    cancel() {
        if (this._sessionId) {
            // session/cancel は通知 (レスポンス不要)
            this._send({
                jsonrpc: '2.0',
                method: 'session/cancel',
                params: { sessionId: this._sessionId },
            });
        }
    }

    stop() {
        if (this._proc) this._proc.kill();
    }
}
```

### 初期化フロー (main.js)

```js
let acpClient = null;

async function initAcp() {
    const config = loadConfig(); // smol-tomlでcompanion.tomlを読む
    acpClient = new AcpClient(config.agent.command, config.agent.args ?? []);
    acpClient.start();
    await acpClient.initialize();
    await acpClient.newSession(config.agent.cwd ?? process.env.HOME);
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

---

## VRMコードパターン

### VRMロード (renderer/app.js)

```js
import * as THREE from '../../node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '../../node_modules/@pixiv/three-vrm/lib/three-vrm.module.js';

let currentVrm = null;

function loadVrm(url) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(url, (gltf) => {
        if (currentVrm) {
            scene.remove(currentVrm.scene);
            VRMUtils.deepDispose(currentVrm.scene);
        }
        currentVrm = gltf.userData.vrm;
        VRMUtils.removeUnnecessaryVertices(currentVrm.scene);
        VRMUtils.combineSkeletons(currentVrm.scene);
        currentVrm.scene.rotation.y = Math.PI; // 正面向き補正
        scene.add(currentVrm.scene);
    });
}
```

### レンダーループ (renderer/app.js)

```js
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (currentVrm) currentVrm.update(delta); // 必須: SpringBone・表情適用
    renderer.render(scene, camera);
}
animate();
```

### 表情制御 (renderer/app.js)

```js
const PRESET_EXPRESSIONS = ['neutral','happy','sad','angry','surprised','relaxed'];

function setExpression(name, intensity) {
    if (!currentVrm?.expressionManager) return;
    PRESET_EXPRESSIONS.forEach(e => currentVrm.expressionManager.setValue(e, 0));
    if (PRESET_EXPRESSIONS.includes(name)) {
        currentVrm.expressionManager.setValue(name, Math.min(1, Math.max(0, intensity ?? 1.0)));
    }
}
```

### 感情タグパース

```js
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
```

---

## セキュリティチェックリスト

```js
new BrowserWindow({
    webPreferences: {
        contextIsolation: true,  // 必須: ON
        nodeIntegration: false,  // 必須: OFF
        preload: '...',
    },
});
```

---

## よくある失敗パターン

| 症状 | 原因 | 対処 |
|---|---|---|
| VRMが表示されない | loadVrm() 未呼び出し | コンソールのGLTFLoaderエラーを確認 |
| 表情が変わらない | キー名誤り or VRM 0.x | VRM 1.0はexpressionManager |
| ACPが応答しない | コマンド誤り or エージェント未対応 | `echo ... | zeroclaw acp` で手動テスト |
| 行バッファが詰まる | \r混入 | `.replace(/\r/g, '')` でトリム |
| 止まる | session/request_permission未応答 | 自動承認レスポンスを実装する |
| SpringBone停止 | vrm.update() 未呼出し | レンダーループ内で毎フレーム呼ぶ |
| Waylandで描画乱れ | ozone設定 | `--ozone-platform=x11` |

---

## 参照ドキュメント

- ACP Overview: https://agentclientprotocol.com/protocol/overview
- ACP Prompt Turn: https://agentclientprotocol.com/protocol/prompt-turn
- ACP Schema: https://agentclientprotocol.com/protocol/schema
- three-vrm API: https://pixiv.github.io/three-vrm/docs/
- Electron IPC: https://www.electronjs.org/docs/latest/tutorial/ipc
- agent-handoff.md: プロジェクト全体の引き継ぎ資料 (同梱)
