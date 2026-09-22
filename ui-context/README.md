# ui-context

ページ上の要素をクリックで選び、その文脈（CSS セレクタ、outerHTML、主要な computed style、位置、URL、任意コメント、スクリーンショット）をローカルサーバ経由でファイルに書き出す拡張。ターミナルで動く AI コーディングエージェント（Claude Code など）に「この要素を直して」を渡すための入口。ORCA の Design Mode を参考にしている。

**状態: PoC。** 2026-09-22 に別プロファイルの Dia で実機検証済み。v1 の設計と残課題は末尾。

## 構成

```
ui-context/
├── extension/          MV3 拡張（manifest.json / background.js / content.js）
├── server/
│   └── capture_server.py   受け側。標準ライブラリのみ。127.0.0.1:8765
├── test/               CDP 経由の自動検証スクリプトとテストページ
└── captures/           書き出し先（gitignore）
```

## 使い方（PoC）

1. サーバを起動する

   ```sh
   python3 server/capture_server.py
   ```

2. `dia://extensions`（Chrome は `chrome://extensions`）でデベロッパーモードを ON にし、`ui-context/extension/` を unpacked で読み込む
3. 対象ページで `Alt+Shift+U` を押すとキャプチャモード。要素をクリックするとコメント入力（`prompt()`）の後、`captures/<timestamp>.json`（と取れれば `.png`）に書き出される
4. エージェント側は `captures/` の最新ファイルを読む

http(s) ページのみ対象。`file://` は content script が注入されない（拡張設定で「ファイルの URL へのアクセスを許可」が必要）。

## PoC で確認できたこと（Dia、Chromium 153 相当、別プロファイル）

- `--load-extension` で読み込める。CDP の service_worker 一覧に Dia 純正の内部拡張が複数混在するので、`chrome.runtime.getManifest().name` で識別する
- content script は isolated world で動く。CDP の `Runtime.evaluate` 既定コンテキストからは `window` の状態が見えないので、`executionContextCreated` で isolated world の contextId を拾う
- content → background → `fetch(POST)` → サーバでの JSON 保存まで通った
- `chrome.tabs.captureVisibleTab` は自動化環境では `image readback failed` になった。CDP の `Page.captureScreenshot` も同様に失敗しており、検証環境の GPU 制約と判断。実セッションでは未確認
- Native Messaging は使わない。Dia のホスト配置先が Chrome と異なる（`~/Library/Application Support/Dia/NativeMessagingHosts/`）ため、ローカル HTTP の方が簡単

## v1 に向けた設計（決定済み）

- 書き出し先はグローバルの 1 ディレクトリ。サーバにプロジェクト判別を持たせない
- エージェントへの受け渡しは手動のスラッシュコマンド（最新 N 件を読む）。自動添付は並列セッション時に宛先が決まらないので見送り
- コメントはブラウザ側のオーバーレイで任意入力（空でも可）

## 残課題

- [ ] 本体 Dia の拡張画面から unpacked 読み込みして動作確認
- [ ] 実セッションで `captureVisibleTab` が動くか確認。動かなければ画像なしで v1
- [ ] 常駐サーバの起動・停止手順（launchd か手動か）
- [ ] コメント入力を `prompt()` からオーバーレイ UI へ
- [ ] Claude Code 側のスラッシュコマンド

## test/

- `test/cdp_check.mjs`: 拡張がロードされたかを CDP で確認
- `test/cdp_capture_test2.mjs`: `test/testpage.html` を 8766 番で配信し、content script のイベントを発火させてサーバ着弾を確認
- `test/cdp_screenshot_test.mjs`: スクリーンショット失敗の切り分け用

いずれも `open -na Dia --args --user-data-dir=<別ディレクトリ> --remote-debugging-port=9223 --load-extension=<extension の絶対パス>` で起動した Dia を前提にする。本体の Dia プロファイルは使わない。
