# VRoid AIコンパニオン — 概要資料

作成日: 2026-05-19 (rev2: ACP stdio対応版)

---

## このソフトウェアが何をするか

VRoid Studioで作成したVRMモデルをウィンドウに表示し、テキスト入力をACPエージェント（zeroclaw・opencode・gooseなど）に中継するデスクトップアプリケーションです。記憶・MCP・Discord連携はすべてエージェント側の責務であり、このアプリは「顔と窓口」に徹します。

```
テキスト入力
    ↓
[vroid-companion]  ←→ (JSON-RPC 2.0 over stdio)
 ACPクライアント         ↓ サブプロセスとして起動
                    [zeroclaw acp / opencode / goose 等]
                         ↓
                    MCP・Discord・記憶など
                    (エージェント側で処理)
```

---

## ACPについて

**Agent Client Protocol (ACP)** はZed Industriesが策定したオープン標準で、エディタとAIコーディングエージェントをつなぐプロトコルです。

- **トランスポート**: JSON-RPC 2.0 over stdio（改行区切り）
- **接続方式**: クライアントがエージェントをサブプロセスとして起動
- **対応エージェント**: zeroclaw・opencode・goose・Gemini CLI・Claude Code (アダプタ経由) など

### ACP通信フロー

```
1. initialize         クライアント → エージェント (バージョン・capability交換)
2. session/new        クライアント → エージェント (セッション作成)
3. session/prompt     クライアント → エージェント (ユーザ入力送信)
   session/update     エージェント → クライアント (ストリーミング返答・ツール状況)
4. session/cancel     クライアント → エージェント (中断、必要時)
```

### zeroclawのACP対応確認済み

PR #4610がマージされており、以下コマンドでの動作を確認済みです:

```sh
echo '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}' | zeroclaw acp
```

---

## 技術スタック

| 要素 | 採用技術 | バージョン |
|---|---|---|
| デスクトップフレーム | Electron | 42.x |
| VRMレンダリング | @pixiv/three-vrm | 3.5.2 |
| 3Dエンジン | three.js | 0.180.0 |
| エージェント通信 | ACP (JSON-RPC 2.0 over stdio) | プロトコル v1 |
| 設定ファイル | TOML | — |
| Node.js | LTS v22系 (fnm管理) | — |

---

## 対応エージェント（設定で切り替え可能）

| エージェント | 起動コマンド例 |
|---|---|
| zeroclaw | `zeroclaw acp` |
| opencode | `opencode` (ACP対応モード) |
| goose | `goose` (ACP対応モード) |
| その他 | ACP仕様準拠エージェントであれば追加可能 |

`config/companion.toml`に起動コマンドを書くだけで切り替えられます。

---

## 感情タグの仕組み

エージェントのシステムプロンプトに指示を追加することで、エージェントが返答末尾に感情タグを付けます。

```
返答の末尾に必ず以下のJSONを1行で付加してください:
{"emotion":"neutral","intensity":0.8}

emotionの値: neutral / happy / sad / angry / surprised / relaxed
```

クライアントがこれをパースしてVRMのBlendShapeに写像します。

---

## 開発フェーズ

| フェーズ | 内容 |
|---|---|
| 1 | VRMレンダリング確認（モデル表示のみ） |
| 2 | ACPクライアント実装 + エージェントとの疎通確認 |
| 3 | 感情タグパース + 表情制御 |
| 4 | TTS + リップシンク |
| 5 | 設定UI（モデル差し替え・エージェント切り替え） |

フェーズ2が動けば実用的な最小動作品として成立します。

---

## セットアップ手順

```sh
# 1. スクリプト実行 (初回のみ)
sh setup-dev-env.sh

# 2. シェル再起動後
cd ~/projects/vroid-companion

# 3. VRMモデルを配置
cp /path/to/model.vrm src/assets/models/model.vrm

# 4. アプリ起動（エージェントはアプリが自動的にサブプロセス起動）
npm start
```

---

## 既知の注意点

**VRMバージョン**  
VRoid Studio は VRM 1.0 形式でエクスポートします。three-vrm v3系はVRM 1.0に対応済みです。

**Pop!_OS / Linux での Electron + Wayland**  
描画が乱れる場合は`--ozone-platform=x11`フラグを追加してください。

**ACPのsession/request_permission**  
エージェントがシェルコマンド等の実行許可を求めてきた場合、クライアントはUIで承認/拒否を提示する必要があります。初期実装では自動承認にしておき、後から選択UIを追加するのが現実的です。
