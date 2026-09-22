# ui-context

ページ上の要素をクリックで選び、その文脈（CSS セレクタ、outerHTML、主要な computed style、位置、URL、任意コメント、切り抜きスクリーンショット）をローカルサーバ経由でファイルに書き出す拡張。ターミナルで動く AI コーディングエージェント（Claude Code など）に「この要素を直して」を渡すための入口。ORCA の Design Mode を参考にしている。

**状態: v1。** 2026-09-22 に別プロファイルの Dia で PoC 検証済み。本体 Dia での動作確認は未実施（末尾の残課題）。

## 構成

```
ui-context/
├── extension/          MV3 拡張（manifest.json / background.js / content.js / crop.js）
├── server/
│   ├── capture_server.py   受け側。標準ライブラリのみ。127.0.0.1:8765
│   ├── start.sh            サーバ起動（多重起動しない）
│   └── stop.sh             サーバ停止
└── test/               CDP 経由の実機検証スクリプトと単体テスト
```

書き出し先はリポジトリの外。グローバルの 1 ディレクトリに集約する（サーバにプロジェクト判別を持たせない）。

```
~/.local/share/ui-context/captures/
├── <timestamp>.json
└── <timestamp>.png      切り抜き画像（撮れた場合）
```

環境変数 `UI_CONTEXT_CAPTURES_DIR` で変更できる。サーバの PID / ログは `~/.local/state/ui-context/`（`UI_CONTEXT_STATE_DIR` で変更可）。

## 使い方

1. サーバを起動する

   ```sh
   ./server/stop.sh   # 止めるとき
   ./server/start.sh  # 起動。すでに動いていれば何もしない
   ```

   常駐はさせていない。使うときに起動する。将来 launchd に載せる場合は `start.sh` が叩いている `capture_server.py` をそのまま plist の `ProgramArguments` にする。

2. `dia://extensions`（Chrome は `chrome://extensions`）でデベロッパーモードを ON にし、`ui-context/extension/` を unpacked で読み込む
3. 対象ページで `Alt+Shift+U`、またはツールバーの ui-context アイコンをクリックするとキャプチャモード。要素をクリックするとコメント入力のオーバーレイが出て、送信するとキャプチャディレクトリに書き出される

   - 送信: `⌘/Ctrl+Enter` またはボタン。コメントは空でもよい
   - キャンセル: `Esc` / 背景クリック / ボタン。キャンセルすると書き出さない
   - 要素を選ぶ前なら `Esc` でキャプチャモードを抜ける

   拡張を入れる前から開いていたタブには content script が入っていないが、その場合は background が `chrome.scripting.executeScript` で注入してから再送するので、リロードしなくても動く。
4. エージェント側は `/ui-context` スキル（dotfiles の `claude/skills/ui-context/`）で最新のキャプチャを読む

http(s) ページのみ対象。`file://` は content script が注入されない（拡張設定で「ファイルの URL へのアクセスを許可」が必要）。

## 切り抜き画像

`chrome.tabs.captureVisibleTab` はビューポート全体しか撮れないので、拡張側で選択要素だけに切り抜く。

- 要素がビューポートに収まっていない場合、content script が `scrollIntoView` してから撮る
- ハイライトのオーバーレイは撮影前に消す
- background の service worker が `OffscreenCanvas` で切り抜く。矩形計算は `extension/crop.js` の `computeCropRect`（CSS px × `devicePixelRatio`、周囲 8px の余白、画像の外にはみ出す分は詰める）
- 切り抜きに失敗した場合はビューポート全体のまま送る。どちらで保存されたかは JSON の `screenshotKind`（`element` / `viewport`）で分かる

## PoC で確認できたこと（Dia、Chromium 153 相当、別プロファイル）

- `--load-extension` で読み込める。CDP の service_worker 一覧に Dia 純正の内部拡張が複数混在するので、`chrome.runtime.getManifest().name` で識別する
- content script は isolated world で動く。CDP の `Runtime.evaluate` 既定コンテキストからは `window` の状態が見えないので、`executionContextCreated` で isolated world の contextId を拾う
- content → background → `fetch(POST)` → サーバでの JSON 保存まで通った
- `chrome.tabs.captureVisibleTab` は自動化環境では `image readback failed` になった。CDP の `Page.captureScreenshot` も同様に失敗しており、検証環境の GPU 制約と判断。実セッションでは未確認
- Native Messaging は使わない。Dia のホスト配置先が Chrome と異なる（`~/Library/Application Support/Dia/NativeMessagingHosts/`）ため、ローカル HTTP の方が簡単

## 残課題

- [ ] 本体 Dia の拡張画面から unpacked 読み込みして動作確認
- [ ] 実セッションで `captureVisibleTab` が動くか確認。動かなければ画像なしで運用する
- [ ] 溜まったキャプチャの掃除（今は消さない）

## test/

単体テスト:

```sh
node --test test/*.test.mjs
```

`test/cdp_*.mjs` は実機の Dia に繋ぐスクリプトなので、この glob では拾わない。

- `test/crop_rect.test.mjs`: `computeCropRect` の境界条件

実機検証（CDP）:

- `test/cdp_check.mjs`: 拡張がロードされたかを CDP で確認
- `test/cdp_capture_test2.mjs`: `test/testpage.html` を 8766 番で配信し、content script のイベントを発火させてサーバ着弾を確認
- `test/cdp_screenshot_test.mjs`: スクリーンショット失敗の切り分け用

いずれも `open -na Dia --args --user-data-dir=<別ディレクトリ> --remote-debugging-port=9223 --load-extension=<extension の絶対パス>` で起動した Dia を前提にする。本体の Dia プロファイルは使わない。
