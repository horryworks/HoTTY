# HoTTY テーマ設定ガイド

[English version is here](THEMES_GUIDE.md)

このガイドでは、テーマファイルで利用可能なプロパティについて説明します。各テーマはアプリケーションの `resources/` ディレクトリに個別のJSONファイル（例: `dark.json`, `medium.json`, `light.json`）として定義されています。

## 構造の概要

各テーマ（例: `dark`, `light`, `medium`）は、主に次の2つのセクションで構成されています。
1. `variables`: UIコンポーネント全体で使用されるCSSカスタムプロパティ。
2. `terminal`: xterm.js ターミナルインスタンス専用の設定。

---

## 1. 変数セクション (`variables`)

これらの値はCSS変数（例: `--bg-primary`）として適用されます。

### 背景とテキスト
- `bg-primary`: アプリケーションのメイン背景色およびアクティブなペインの背景色。
- `bg-secondary`: サイドバー、ヘッダー、およびUI要素の背景色。
- `bg-tertiary`: 非アクティブなタブやドロップダウンの背景色。
- `panel-bg`: 特定のパネル（ホストツリーなど）の背景色。
- `text-primary`: メインのテキストカラー。
- `text-secondary`: 補助的なテキストやヒントのカラー。
- `text-on-accent`: アクセント色（ボタン等）の上に表示されるテキストの色。

### ボーダーとアクセント
- `border-color`: ペインの境界線や仕切り線の色。
- `accent-color`: ボタン、アクティブインジケーター、リンクに使用される主要なアクセントカラー。
- `accent-hover`: アクセント要素のホバー時の色。
- `accent-light`: アクセント色のライトバリエーション。
- `accent-secondary`: 2つ目のアクセントカラー（補助的な装飾用）。
- `active-pane-color`: 現在アクティブなペインを強調するための色。

### 入力、ボタン、ホバー
- `input-bg`: テキスト入力フィールドや設定項目の背景色。
- `btn-bg`: 一般的なボタンの背景色。
- `btn-hover-bg`: ボタンのホバー時の背景色。
- `btn-secondary-bg`: 二次的なボタン（キャンセル等）の背景色。
- `btn-secondary-hover-bg`: 二次的なボタンのホバー時の背景色。
- `btn-danger-bg`: 危険・破壊的なアクション用ボタンの背景色。
- `btn-danger-hover-bg`: 危険ボタンのホバー時の背景色。
- `hover-bg`: リスト項目などの一般的なホバー背景色。
- `placeholder-color`: 入力欄のプレースホルダーテキストの色。

### 状態とシグナル
- `success-color`: 成功ステータス（完了、接続など）の色。
- `error-color`: 一般的なエラーメッセージの色。
- `color-danger`: 警告や削除などの危険を示す色。
- `color-danger-bg`: 危険要素の背景（半透明など）。
- `color-danger-bg-hover`: 危険要素のホバー時背景。
- `color-danger-border`: 危険要素の境界線。
- `color-warning`: 警告・注意が必要なテキストの色。

### AIチャット (Gemini)
- `chat-msg-user-bg`: ユーザーからのメッセージの背景色。
- `chat-msg-model-bg`: AIからのメッセージの背景色。
- `chat-msg-user-text`: ユーザーメッセージのテキストカラー。
- `chat-msg-model-text`: AI応答のテキストカラー。
- `code-bg`: チャット内のコードブロックの背景色。
- `code-text`: コードブロックのテキストカラー。
- `ai-header-bg`: AIチャットヘッダーの背景色。
- `ai-welcome-text`: ウェルカム画面の見出し色。
- `ai-welcome-subtext`: 空状態での説明文の色。

### UIコンポーネント専用
- `select-arrow`: ドロップダウンの矢印用SVGデータ（URL形式）。
- `sidebar-bg`: 左側サイドバーの背景色。
- `sidebar-btn-color`: サイドバーボタン（通常時）の色。
- `sidebar-btn-hover-bg`: サイドバーボタンのホバー背景色。
- `sidebar-btn-hover-color`: サイドバーボタンのホバー時の色。
- `sidebar-btn-active-bg`: 選択されているサイドバーボタンの背景。
- `tab-bg`: 非アクティブなタブの背景。
- `tab-text`: 非アクティブなタブの文字色。
- `tab-active-bg`: アクティブなタブの背景。
- `tab-active-text`: アクティブなタブの文字色。
- `tab-close-bg`: タブの閉じる「×」ボタンの色。
- `tab-close-hover-bg`: タブの「×」ボタンのホバー色。
- `tab-drag-indicator`: タブ並び替え時の挿入位置インジケーターの色。
- `tab-watching-text`: AI監視中のタブの文字色。
- `tab-watching-bg`: AI監視中のタブアイコンの背景・塗りつぶし色。
- `tab-watching-icon`: AI監視中アイコンのプライマリグローカラー。
- `tab-watching-icon-glow`: AI監視中アイコングラデーションのセカンダリグローカラー。
- `context-menu-bg`: 右クリックメニューの背景。
- `context-menu-border`: 右クリックメニューの枠線。
- `context-menu-text`: 右クリックメニューの文字色。
- `context-menu-hover-bg`: 右クリックメニューの項目ホバー色。
- `hidden-item-bg`: 非表示設定にされている項目の背景（デバッグ等）。
- `hidden-item-bg-hover`: 非表示設定項目のホバー背景。
- `tree-meta-color`: ツリー表示等でのメタ情報（サイズ等）の色。
- `icon-folder`: ホストツリーのフォルダアイコンの色。
- `icon-host`: ホストツリーの接続先アイコンの色。
- `terminal-prompt-default`: ターミナルのプロンプトマーカーブロックのデフォルト色。
- `terminal-prompt-active`: ターミナルのプロンプトマーカーブロックがコマンド入力として検出された際のアクティブ色。

### 検索とハイライト
- `search-highlight-bg`: 検索一致行の背景色（薄いハイライト）。
- `search-highlight-current-bg`: 現在フォーカスしている一致行の背景色。
- `search-highlight-current-border`: 現在フォーカスしている一致行のアウトライン色。
- `search-highlight-mark-bg`: 一致テキストスパンのインラインハイライト背景色。
- `search-highlight-mark-solid`: 現在フォーカス行の一致テキストスパンの不透明背景色。
- `search-highlight-mark-text`: ハイライトされた一致テキストの文字色。

### オーバーレイとモーダル
- `modal-overlay-bg`: ダイアログ表示時の背景遮蔽色。
- `modal-shadow`: モーダルの影。
- `modal-header-info-bg`: 通知モーダルのヘッダー背景。
- (他にも `modal-header-warning-*`, `modal-header-error-*` 等の状態別設定があります)

---

## 2. ターミナルセクション (`terminal`)

ターミナルエミュレータ（xterm.js）に直接適用される設定です。

- `foreground`: 文字のデフォルト色。
- `background`: **フォーカスがある時**の背景色。
- `backgroundInactive`: **フォーカスがない時**の背景色。
- `paneBackground`: ターミナル外側の余白部分の色。

---

## 変更の適用方法

テーマのJSONファイルを変更した後、以下の手順が必要になる場合があります：
1. アプリケーションを再起動するか、開発者ウィンドウをリロード（**Ctrl+R**）する。
2. 変更が反映されない場合は、**Settings**（設定）画面でテーマ（例: 一度 Light にしてから Dark に戻す）を選択し直してください。
3. 開発モードの場合は、ブラウザのコンソールを開いてCSS変数のエラーが出ていないか確認してください。
