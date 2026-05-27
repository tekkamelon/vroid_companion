'use strict';

// プリロードスクリプト
// メインプロセスとレンダラープロセスの安全な橋渡しを担当する

const { contextBridge, ipcRenderer } = require('electron');

// window.companion オブジェクトとしてレンダラーにAPIを公開する
contextBridge.exposeInMainWorld('companion', {
  // メッセージをメインプロセスに送信する (invoke → 応答を待つ)
  sendMessage: (text) => ipcRenderer.invoke('acp:send', text),
  // ストリーミング応答のチャンクを受け取る (Phase 4)
  onChunk:     (cb)   => ipcRenderer.on('acp:chunk', (_e, text) => cb(text)),
  // メインプロセスからの応答を受け取るリスナーを登録する (Phase 2 完了通知用)
  onResponse:  (cb)   => ipcRenderer.on('acp:response', (_e, data) => cb(data)),
  // 設定を取得する
  getConfig:   ()     => ipcRenderer.invoke('config:get'),
  // TTS 音声を生成する (Phase 5a)
  synthesizeSpeech: (text) => ipcRenderer.invoke('tts:synthesize', text),
});
