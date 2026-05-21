'use strict';

// プリロードスクリプト
// メインプロセスとレンダラープロセスの安全な橋渡しを担当する

const { contextBridge, ipcRenderer } = require('electron');

// window.companion オブジェクトとしてレンダラーにAPIを公開する
contextBridge.exposeInMainWorld('companion', {
  // メッセージをメインプロセスに送信する (invoke → 応答を待つ)
  sendMessage: (text) => ipcRenderer.invoke('acp:send', text),
  // メインプロセスからの応答を受け取るリスナーを登録する
  onResponse:  (cb)   => ipcRenderer.on('acp:response', (_e, data) => cb(data)),
});
