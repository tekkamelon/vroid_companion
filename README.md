# vroid_companion

VRoid Studio で作成した VRM 1.0 モデルをウィンドウに表示し、テキスト入力を ACP (Agent Client Protocol) 対応の AI エージェントに中継する Electron デスクトップアプリケーションです。

---

## 概要

エージェント（zeroclaw / opencode / kilocode / goose など）を子プロセスとして起動し、JSON-RPC 2.0 over stdio で通信します。ユーザーのテキスト入力に対しエージェントが返す応答をチャットログに表示し、同時に応答末尾に付与された感情タグをパースして VRM モデルの表情（BlendShape）を制御します。

---

## 機能

- **VRM モデル表示** — Three.js + @pixiv/three-vrm による 3D レンダリング（SpringBone 物理演算対応）
- **ACP クライアント** — JSON-RPC 2.0 over stdio によるエージェント通信（initialize → session/new → session/prompt）
- **ストリーミング応答** — エージェントからのチャンクをリアルタイム表示
- **表情制御** — 応答末尾の JSON タグ `{"emotion":"happy","intensity":0.8}` をパースし VRM の BlendShape に反映
  - 対応表情: `neutral`, `happy`, `sad`, `angry`, `surprised`, `relaxed`
- **テキスト読み上げ (TTS)** — OpenAI TTS API による音声合成（オプション設定）
- **ダークテーマ UI** — チャットパネル + 3D ビューワの一体型インターフェース

---

## 技術スタック

| コンポーネント | バージョン |
|---|---|
| Node.js | v22 LTS (fnm 管理) |
| Electron | ^42.0.0 |
| three.js | ^0.180.0 |
| @pixiv/three-vrm | ^3.5.2 |
| smol-toml | ^1.3.1 |
| electron-builder | ^25.1.8 |
| VRM フォーマット | VRM 1.0 |
| エージェントプロトコル | ACP v1 (JSON-RPC 2.0 over stdio, NDJSON) |
| 設定ファイル | TOML (`config/config.toml`) |

---

## アーキテクチャ

```
メインプロセス (src/main.js)
  ├── AcpClient — エージェント子プロセスの管理・JSON-RPC 通信
  ├── IPC ハンドラ — acp:send / config:get / tts:synthesize
  └── OpenAI TTS — HTTP 経由の音声合成
        │
        │ IPC (contextBridge)
        │
プリロード (src/preload.js)
  └── window.companion.* API を公開
        │
レンダラープロセス (src/renderer/)
  ├── app.js — Three.js シーン, VRM 制御, チャット UI, 表情パース, TTS 再生
  ├── index.html — CSP, レイアウト
  └── style.css — ダークテーマ
```

### セキュリティ

- `contextIsolation: true`, `nodeIntegration: false`
- レンダラーからの Node.js API 直接呼び出し禁止
- レンダラーは `file://` 経由で `node_modules` の ES modules を直接インポート（バンドラー不使用）

---

## セットアップ

### 前提条件

1. Node.js v22（`scripts/setup-dev-env.sh` で fnm + Node + システム依存関係を自動セットアップ可能）
2. VRM 1.0 モデルファイル
3. ACP 対応エージェントのバイナリ

### 手順

```bash
# 1. 依存関係のインストール
npm install

# 2. VRM モデルを配置
#     src/assets/models/model.vrm に VRM 1.0 ファイルを配置

# 3. 設定ファイルを編集
#     config/config.toml でエージェントのコマンド・パスを設定

# 4. 起動
npm start          # 通常起動
npm run dev        # 開発モード（--dev フラグ付き）
```

---

## 設定

`config/config.toml`:

```toml
[agent]
command = "kilocode"        # エージェント実行コマンド
args    = ["acp"]            # コマンドライン引数
cwd     = "/home/yourname"  # ワーキングディレクトリ

[model]
vrm_path = "assets/models/model.vrm"  # VRM ファイルパス

[display]
width  = 800                # ウィンドウ幅
height = 900                # ウィンドウ高さ

[tts]
enabled         = false     # TTS 有効/無効
provider        = "openai"  # プロバイダ
model           = "tts-1"   # モデル
voice           = "alloy"   # 音声 (alloy/echo/fable/onyx/nova/shimmer)
# api_key       = "sk-..."  # 未設定時は環境変数 OPENAI_API_KEY を使用
```

---

## 開発コマンド

| コマンド | 説明 |
|---|---|
| `npm start` | アプリ起動 |
| `npm run dev` | 開発モードで起動 |
| `npm run build` | パッケージング (AppImage + deb) |

---

## ACP 通信シーケンス

```
クライアント ←→ エージェント (子プロセス)

  1. initialize                   — バージョン・機能交換
  2. session/new                  — セッション作成
  3. session/prompt               — ユーザー入力送信
  4. session/update (notification) — ストリーミング応答 (複数回)
  5. session/prompt result        — ターン終了
  6. session/request_permission   — 権限要求（自動許可）
```

---

## 表情タグ契約

エージェントは応答末尾に以下の JSON タグを付与します:

```json
{"emotion":"happy","intensity":0.8}
```

有効な感情キー: `neutral`, `happy`, `sad`, `angry`, `surprised`, `relaxed`

---

## ディレクトリ構造

```
├── config/
│   └── config.toml          設定ファイル
├── docs/
│   ├── agent-handoff.md     実装ガイド
│   └── owner-overview.md    プロダクト概要
├── scripts/
│   └── setup-dev-env.sh     開発環境セットアップ
├── src/
│   ├── main.js              メインプロセス
│   ├── preload.js           プリロードスクリプト
│   ├── assets/models/       VRM モデル配置ディレクトリ
│   └── renderer/
│       ├── app.js           3D シーン・UI
│       ├── index.html       エントリ HTML
│       └── style.css        スタイル
├── package.json
├── AGENTS.md                エージェント向け開発ガイド
└── LICENSE
```

---

## 既知の注意点

| 現象 | 原因と対策 |
|---|---|
| VRM が表示されない | GLTFLoader のエラーを確認、パスが正しいか確認 |
| 表情が変わらない | VRM 1.0 では `expressionManager` を使用（VRM 0.x の `blendShapeProxy` は非対応） |
| ACP が応答しない | エージェントが正しく ACP モードで起動しているか確認 |
| ストリームが途切れる | エージェントの出力に `\r` が含まれる問題 → 自動除去済み |
| 権限要求で停止 | `session/request_permission` は自動許可するよう実装済み |
| SpringBone が動かない | `vrm.update(delta)` が毎フレーム呼ばれているか確認 |
| Wayland で描画が乱れる | `--ozone-platform=x11` フラグを追加 |
