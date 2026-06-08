# Kokoro-FastAPI 設定手順

このドキュメントでは、本プロジェクト（vroid-companion）で利用するための Kokoro-FastAPI セットアップ手順を記載する。
Kokoro-FastAPI は、Kokoro-82M テキスト読み上げモデルを OpenAI 互換の Speech API として提供する FastAPI ラッパーである。

---

## 1. 概要

- **リポジトリ**: https://github.com/remsky/Kokoro-FastAPI
- **提供機能**: OpenAI 互換の `POST /v1/audio/speech` エンドポイント
- **対応言語**: 英語 (US/GB)、スペイン語、フランス語、ヒンディー語、イタリア語、日本語、ブラジルポルトガル語、中国語（標準北京語）
- **デフォルトポート**: `8880`
- **Web UI**: `http://localhost:8880/web`
- **API ドキュメント**: `http://localhost:8880/docs`

---

## 2. 推奨環境

Kokoro-FastAPI は Docker イメージとして提供されているため、Docker 環境があればすぐに利用できる。GPU がなくても CPU 版で動作する。

| ハードウェア | 推奨イメージタグ |
|---|---|
| CPU のみ | `kokoro-fastapi-cpu:latest` |
| NVIDIA GPU (GTX/RTX 30xx, 40xx など) | `kokoro-fastapi-gpu:latest` または `latest-cu126` |
| NVIDIA RTX 50 シリーズ / Blackwell | `kokoro-fastapi-gpu:latest-cu128` |
| AMD GPU (ROCm) | `kokoro-fastapi-rocm:latest` |
| Apple Silicon (M1/M2/M3) | CPU 版 Docker イメージ、または UV で `./start-gpu_mac.sh` |

### GPU 利用可否の確認

```bash
# NVIDIA GPU の確認
nvidia-smi

# AMD GPU の確認
lspci | grep VGA
```

---

## 3. セットアップ手順

### 3.1 最速スタート（Docker Run）

Docker がインストール済みであれば、1 コマンドで起動できる。

#### CPU 版
```bash
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

#### NVIDIA GPU 版
```bash
docker run --gpus all -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest
```

#### AMD GPU 版
```bash
docker run --device=/dev/kfd --device=/dev/dri -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-rocm:latest
```

> **Note**: `:latest` は開発中の最新版を指すため、本番運用時はリリースタグを明示的に指定することを推奨する。

### 3.2 Docker Compose を利用する場合

ソースコードも取得し、UI 付きで起動したい場合は Docker Compose を使う。

```bash
git clone https://github.com/remsky/Kokoro-FastAPI.git
cd Kokoro-FastAPI

# 利用環境に応じてディレクトリを選択
cd docker/gpu   # NVIDIA GPU
# cd docker/cpu # CPU のみ
# cd docker/rocm # AMD GPU

docker compose up --build
```

### 3.3 直接実行（UV を利用）

Docker を使わず、ホストマシン上で直接動作させたい場合は `uv` を利用する。

1. **前提条件のインストール**
   - [astral-uv](https://docs.astral.sh/uv/) のインストール
   - `espeak-ng` のインストール（推奨。未知の単語の発音フォールバックとして機能する）
     ```bash
     # Ubuntu/Debian 例
     sudo apt-get install espeak-ng
     ```

2. **リポジトリのクローン**
   ```bash
   git clone https://github.com/remsky/Kokoro-FastAPI.git
   cd Kokoro-FastAPI
   ```

3. **実行**
   ```bash
   # CPU で実行
   ./start-cpu.sh

   # GPU で実行
   ./start-gpu.sh
   ```

---

## 4. OpenAI 互換 API の利用

Kokoro-FastAPI が起動すると、`http://localhost:8880/v1` で OpenAI 互換の Speech API が利用できる。

### 4.1 API エンドポイント

| 項目 | 値 |
|---|---|
| Base URL | `http://localhost:8880/v1` |
| API Key | `not-needed`（任意の文字列で可） |
| Speech Endpoint | `POST /v1/audio/speech` |
| Voices Endpoint | `GET /v1/audio/voices` |

### 4.2 Python クライアント例

`openai` 公式ライブラリを利用する場合：

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8880/v1",
    api_key="not-needed"
)

response = client.audio.speech.create(
    model="kokoro",
    voice="af_bella",      # 単一ボイス、または "af_sky+af_bella" のように組み合わせ可能
    input="Hello world!",
    response_format="mp3"  # mp3, wav, opus, flac に対応
)

response.stream_to_file("output.mp3")
```

### 4.3 requests を利用する場合

```python
import requests

# ボイス一覧の取得
response = requests.get("http://localhost:8880/v1/audio/voices")
voices = [v["id"] for v in response.json()["voices"]]

# 音声生成
response = requests.post(
    "http://localhost:8880/v1/audio/speech",
    json={
        "model": "kokoro",
        "input": "Hello world!",
        "voice": "af_bella",
        "response_format": "mp3",
        "speed": 1.0
    }
)

with open("output.mp3", "wb") as f:
    f.write(response.content)
```

---

## 5. ボイス設定

- **デフォルトボイス**: `af_bella` や `af_sky` などが提供されている。
- **ボイス組み合わせ**: 重み付きで複数のボイスを混ぜることができる。
  - 例: `"af_bella+af_sky"`（等倍ミックス）
  - 例: `"af_bella(2)+af_sky(1)"`（2:1 の比率でミックス）
- **ボイス一覧の確認**:
  ```bash
  curl http://localhost:8880/v1/audio/voices
  ```

---

## 6. 補足

- **音声フォーマット**: `mp3`, `wav`, `opus`, `flac` に対応。
- **日本語対応**: `input` に日本語テキストを渡すことで日本語音声も生成可能。
- **その他の機能**:
  - 単語単位のタイムスタンプ付きキャプション生成
  - フォネムエンドポイント（テキストからフォネム生成、またはフォネムから音声生成）

---

## 7. 本プロジェクトでの統合想定

vroid-companion から Kokoro-FastAPI を利用する際は、上記 Base URL（`http://localhost:8880/v1`）を設定し、エージェントの応答テキストを `input` に渡して音声ファイルを取得し、Electron のメインプロセス側で再生する流れを想定している。

（具体的な統合実装は別途 `src/main.js` またはレンダラー側で行う。）
