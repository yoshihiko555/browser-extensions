# browser-extensions

自作の Chrome / Dia 向けブラウザ拡張をまとめたリポジトリ。拡張ごとにサブディレクトリを持つ。

| ディレクトリ | 内容 | 状態 |
|---|---|---|
| [`tabyank/`](tabyank/) | 選択したタブの URL をクリップボードにコピーする拡張 | 運用中 |
| [`ui-context/`](ui-context/) | ページ上の要素を選んで、セレクタ・HTML・CSS・スクリーンショット・コメントをローカルに書き出し、AI コーディングエージェントへ渡す拡張 | PoC |
| [`bookmark-sorter/`](bookmark-sorter/) | ブックマークバーの各フォルダを、閲覧履歴の訪問回数が多い順に並び替える拡張 | 試用 |

## インストール（共通）

1. ブラウザで `chrome://extensions/` を開く（Dia は `dia://extensions`）
2. 「デベロッパーモード」を ON にする
3. 「パッケージ化されていない拡張機能を読み込む」で **拡張のサブディレクトリ**（例: `tabyank/`、`ui-context/extension/`、`bookmark-sorter/extension/`）を選択する

## 対応ブラウザ

- Google Chrome
- Dia（Chromium ベース。Manifest V3 のみ）
