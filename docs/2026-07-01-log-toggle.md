# システム/デバッグログの表示/非表示切り替え機能

## 日付

2026-07-01

## 背景

チャットエリアの会話ログが、VRM ロード処理やデバッグ情報の `System` / `Debug` メッセージで埋もれ、ユーザーが会話を追いにくくなっていた。

## 目的

システム/デバッグメッセージを**デフォルトで非表示**にし、ユーザーの明示的な操作で表示できるようにする。

---

## 採用した方式

**入力欄横のトグルボタン方式**

- 送信ボタンの右隣に `📝` アイコンボタンを配置
- 通常時：`.system` クラスのメッセージ行は非表示
- ボタン押下：`show-logs` クラスを `#log` に付与し、システムログを表示
- 再押下：非表示に戻る

---

## 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `src/renderer/index.html` | 入力欄に `<button id="log-toggle-btn">📝</button>` を追加 |
| `src/renderer/style.css` | `#log:not(.show-logs) .msg-row.system { display: none; }` を追加。ボタンの `.active` スタイルも追加 |
| `src/renderer/app.js` | `logToggleBtn` の参照取得と、クリックイベントで `show-logs` / `active` クラスをトグル |

---

## コードの要点

### style.css

```css
/* システム/デバッグログのデフォルト非表示 */
#log:not(.show-logs) .msg-row.system { display: none; }

/* ボタンがアクティブな時の視覚的フィードバック */
#log-toggle-btn.active {
  background: #0f3460;
  border-color: #8fe3ff;
}
```

### app.js

```js
const logToggleBtn = document.getElementById('log-toggle-btn');

if (logToggleBtn && log) {
    logToggleBtn.addEventListener('click', () => {
        log.classList.toggle('show-logs');
        logToggleBtn.classList.toggle('active');
    });
}
```

---

## Git コミット

```
commit bb24f51
Author: (session agent)
Date:   2026-07-01

    システム/デバッグログの表示/非表示を📝ボタンで切り替えできるよう追加

    - index.html: 送信ボタン横にログトグルボタン(📝)を追加
    - style.css: #log:not(.show-logs) でSystem/Debug行をデフォルト非表示に
    - app.js: トグルボタンクリックで show-logs / active クラスを切り替え
```

---

## 関連

- 本資料は CODEX（以降の開発セッション）への引き継ぎ用です。
