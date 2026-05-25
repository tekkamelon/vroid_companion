#!/bin/sh
# VRoid AIコンパニオン (vroid-companion) 開発環境セットアップスクリプト
# 対象OS: Pop!_OS 24.04 LTS (Ubuntu 24.04ベース), Debian 13
set -eu

# --------------------------------------------------------------------------
# 変数の宣言
# --------------------------------------------------------------------------
PROJECT_DIR=""

# --------------------------------------------------------------------------
# 関数の宣言
# --------------------------------------------------------------------------

# 情報メッセージの出力
log() {

    printf '\033[1;32m[INFO]\033[0m  %s\n' "$*"

}

# 警告メッセージの出力
warn() {

    printf '\033[1;33m[WARN]\033[0m  %s\n' "$*"

}

# エラーメッセージの出力と終了
die() {

    printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2
    exit 1

}

# OSの確認
check_os() {

    if [ ! -f /etc/os-release ]; then
        die "/etc/os-release が見つかりません。Ubuntu/Pop!_OS 24.04 上で実行してください。"
    fi

    # shellcheck source=/dev/null
    . /etc/os-release

    case "${ID} ${VERSION_ID}" in
        "ubuntu 24.04" | "pop 24.04" | "debian 13")
            log "OS確認OK: ${PRETTY_NAME}"
            ;;
        *)
            warn "未確認のOS: ${PRETTY_NAME}。続行しますが動作は保証されません。"
            ;;
    esac

}

# root実行の防止
check_not_root() {

    if [ "$(id -u)" -eq 0 ]; then
        die "rootで実行しないでください。sudoが必要な箇所は自動的に呼び出します。"
    fi

}

# fnmのインストール
install_fnm() {

    if command -v fnm > /dev/null 2>&1; then
        log "fnm は既にインストール済みです: $(fnm --version)"
        return 0
    fi

    log "fnm (Fast Node Manager) をインストールしています..."
    curl -fsSL https://fnm.vercel.app/install | sh

    shell_rc=""
    case "${SHELL:-}" in
        */bash)  shell_rc="${HOME}/.bashrc" ;;
        */zsh)   shell_rc="${HOME}/.zshrc" ;;
        */fish)  shell_rc="${HOME}/.config/fish/config.fish" ;;
        */mksh)  shell_rc="${HOME}/.mkshrc" ;;
        */ksh)   shell_rc="${HOME}/.kshrc" ;;
        */yash)  shell_rc="${HOME}/.yashrc" ;;
        *)       shell_rc="${HOME}/.profile" ;;
    esac

    log "fnm の初期化を ${shell_rc} に追記しています..."
    if ! grep -F 'fnm env' "${shell_rc}" > /dev/null 2>&1; then
		# .bashrc 等に ${PATH} と $(fnm env) をそのまま文字列として書き込むためシングルクォートを使用(このスクリプト実行時に展開させない)
        # shellcheck disable=SC2016
        printf '\n# fnm\nexport PATH="%s/.local/share/fnm:${PATH}"\neval "$(fnm env --use-on-cd)"\n' "${HOME}" >> "${shell_rc}"
    fi

    export PATH="${HOME}/.local/share/fnm:${PATH}"
    eval "$(fnm env --use-on-cd 2>/dev/null || true)"

}

# Node.js LTSのインストール
install_node() {

    log "Node.js LTS (v22系) をインストールしています..."
    fnm install "lts-latest"
    fnm use "lts-latest"
    fnm default "lts-latest"
    node --version
    npm --version
    log "Node.js インストール完了"

}

# gitのインストール
install_git() {

    if command -v git > /dev/null 2>&1; then
        log "git は既にインストール済みです: $(git --version)"
        return 0
    fi

    log "git をインストールしています..."
    sudo apt-get update -qq
    sudo apt-get install -y git

}

# システム依存ライブラリのインストール
install_system_deps() {

    log "Electronのシステム依存ライブラリをインストールしています..."
    sudo apt-get update -qq
    sudo apt-get install -y \
        libnss3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libgbm1 \
        libasound2t64 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libcairo2 \
        libgdk-pixbuf2.0-0 \
        libgtk-3-0 \
        libxshmfence1 \
        build-essential \
        shellcheck
    log "システム依存ライブラリのインストール完了"

}

# プロジェクトの初期化
init_project() {

    if [ -d "${PROJECT_DIR}" ]; then
        warn "ディレクトリが既に存在します: ${PROJECT_DIR}"
        warn "スキップします。クリーンインストールの場合は手動で削除してください。"
        return 0
    fi

    log "プロジェクトディレクトリを作成しています: ${PROJECT_DIR}"
    mkdir -p "${PROJECT_DIR}"
    cd "${PROJECT_DIR}" || die "ディレクトリへの移動失敗: ${PROJECT_DIR}"

    cat > package.json << 'PKGJSON'
{
  "name": "vroid-companion",
  "version": "0.1.0",
  "description": "VRoid AIコンパニオン — ACPエージェントフロントエンド",
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "dev":   "electron . --dev",
    "build": "electron-builder"
  },
  "devDependencies": {
    "electron": "^42.0.0",
    "electron-builder": "^25.1.8"
  },
  "dependencies": {
    "three": "^0.180.0",
    "@pixiv/three-vrm": "^3.5.2"
  },
  "build": {
    "appId": "com.local.vroid-companion",
    "linux": {
      "target": ["AppImage", "deb"],
      "category": "Utility"
    }
  }
}
PKGJSON

    mkdir -p src/renderer src/assets/models config

    cat > src/main.js << 'MAINJS'
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
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
MAINJS

    cat > src/preload.js << 'PRELOAD'
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companion', {
  sendMessage: (text) => ipcRenderer.invoke('acp:send', text),
  onResponse:  (cb)   => ipcRenderer.on('acp:response', (_e, data) => cb(data)),
});
PRELOAD

    cat > src/renderer/index.html << 'HTML'
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';">
  <title>VRoid Companion</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1a1a2e; color: #e0e0ff; font-family: sans-serif; display: flex; flex-direction: column; height: 100vh; }
    #canvas-area { flex: 1; position: relative; }
    canvas { width: 100%; height: 100%; display: block; }
    #chat-area { height: 200px; background: #16213e; display: flex; flex-direction: column; padding: 8px; gap: 8px; }
    #log { flex: 1; overflow-y: auto; font-size: 13px; line-height: 1.5; }
    #input-row { display: flex; gap: 8px; }
    #msg-input { flex: 1; background: #0f3460; border: 1px solid #533483; color: #e0e0ff; border-radius: 4px; padding: 6px 10px; font-size: 14px; }
    #send-btn { background: #533483; color: #fff; border: none; border-radius: 4px; padding: 6px 16px; cursor: pointer; }
  </style>
</head>
<body>
  <div id="canvas-area"><canvas id="vrm-canvas"></canvas></div>
  <div id="chat-area">
    <div id="log"></div>
    <div id="input-row">
      <input id="msg-input" type="text" placeholder="メッセージを入力...">
      <button id="send-btn">送信</button>
    </div>
  </div>
  <script type="module" src="./app.js"></script>
</body>
</html>
HTML

    cat > src/renderer/app.js << 'APPJS'
// VRoid Companion — レンダラープロセス
// three.js + @pixiv/three-vrm はnpmからbundleせず、
// 開発中はCDNまたはnode_modules直参照を使うこと。
// (Electronはfile://でnode_modulesにアクセス可能)

import * as THREE from '../../node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '../../node_modules/@pixiv/three-vrm/lib/three-vrm.module.js';

const canvas = document.getElementById('vrm-canvas');
const log    = document.getElementById('log');
const input  = document.getElementById('msg-input');
const btn    = document.getElementById('send-btn');

// ---- Three.js セットアップ ----
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 20);
camera.position.set(0, 1.4, 3);

const light = new THREE.DirectionalLight(0xffffff, 1.0);
light.position.set(1, 2, 3);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

let currentVrm = null;

// ---- VRMロード ----
function loadVrm(url) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(url, (gltf) => {
        if (currentVrm) { scene.remove(currentVrm.scene); VRMUtils.deepDispose(currentVrm.scene); }
        currentVrm = gltf.userData.vrm;
        VRMUtils.removeUnnecessaryVertices(currentVrm.scene);
        VRMUtils.combineSkeletons(currentVrm.scene);
        currentVrm.scene.rotation.y = Math.PI;
        scene.add(currentVrm.scene);
    });
}

// ---- レンダーループ ----
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (currentVrm) currentVrm.update(delta);
    renderer.render(scene, camera);
}
animate();

// ---- 表情制御ユーティリティ ----
function setExpression(name, weight) {
    if (!currentVrm?.expressionManager) return;
    currentVrm.expressionManager.setValue(name, weight);
}

// ---- チャットUI ----
function appendLog(who, text) {
    const p = document.createElement('p');
    p.textContent = `[${who}] ${text}`;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
}

async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendLog('You', text);
    const resp = await window.companion.sendMessage(text);
    if (resp?.text) appendLog('AI', resp.text);
    if (resp?.emotion) setExpression(resp.emotion, resp.intensity ?? 1.0);
}

btn.addEventListener('click', sendMessage);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

window.companion.onResponse((data) => {
    if (data?.text) appendLog('AI', data.text);
    if (data?.emotion) setExpression(data.emotion, data.intensity ?? 1.0);
});

// ---- 初期VRMロード (モデルがあれば) ----
// loadVrm('./assets/models/model.vrm');
APPJS

    cat > config/companion.toml << 'TOML'
# VRoid Companion 設定ファイル

[agent]
# zeroclawのgateway REST APIエンドポイント
# (ACPサーバモードが実装されるまではgateway経由を使用)
gateway_url = "http://localhost:8080"
# セッションキー (複数クライアントで共有する場合に指定)
session_key = ""

[model]
# VRMファイルのパス (絶対パスまたはassets/models/からの相対)
vrm_path = "assets/models/model.vrm"

[display]
width  = 800
height = 900
TOML

    log "npm install を実行しています..."
    npm install

    log "プロジェクト初期化完了: ${PROJECT_DIR}"

}

# .node-versionファイルの作成
write_node_version() {

    cd "${PROJECT_DIR}" || die "ディレクトリへの移動失敗: ${PROJECT_DIR}"
    node --version | sed 's/^v//' > .node-version
    log ".node-version を作成しました: $(cat .node-version)"

}

# メイン処理
main() {

    PROJECT_DIR="${1:-${PWD}}"

    log "=== vroid-companion 開発環境セットアップ開始 ==="
    check_not_root
    check_os
    install_git
    install_system_deps
    install_fnm
    install_node
    init_project
    write_node_version

    log ""
    log "=== セットアップ完了 ==="
    log ""
    log "次のステップ:"
    log "  1. シェルを再起動 (または 'source ~/.bashrc') してfnmを有効化"
    log "  2. cd ${PROJECT_DIR}"
    log "  3. VRMモデルを src/assets/models/model.vrm に配置"
    log "  4. config/companion.toml でzeroclawのエンドポイントを設定"
    log "  5. npm start で起動"

}

# --------------------------------------------------------------------------
# 関数の宣言ここまで
# --------------------------------------------------------------------------

main "$@"
