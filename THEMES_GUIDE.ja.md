# HoTTY テーマ設定ガイド

[English version is here](file:///c:/Users/horry/development/HoTTY/THEMES_GUIDE.md)

このガイドでは、`src/themes.json` で利用可能なプロパティについて説明します。JSON形式はコメントをサポートしていないため、テーマをカスタマイズする際の参考にしてください。

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
- `text-primary`: メインのテキストカラー。
- `text-secondary`: 補助的なテキストやヒントのカラー。

### ボーダーとアクセント
- `border-color`: ペインの境界線や仕切り線の色。
- `accent-color`: ボタン、アクティブインジケーター、リンクに使用される主要な色。
- `accent-hover`: アクセント要素のホッバー時の色。

### 入力とメッセージ
- `input-bg`: テキスト入力フィールドの背景色。
- `success-color`: 成功ステータス（緑系）に使用される色。
- `error-color`: エラーメッセージや破壊的なアクション（赤系）に使用される色。

### AIチャット (Gemini)
- `chat-msg-user-bg`: ユーザーからのメッセージの背景色。
- `chat-msg-model-bg`: AIからのメッセージの背景色。
- `chat-msg-user-text`: ユーザーメッセージのテキストカラー。
- `chat-msg-model-text`: AI応答のテキストカラー。
- `code-bg`: チャット内のコードブロックの背景色。
- `code-text`: コードブロックのテキストカラー。
- `ai-header-bg`: AIチャットヘッダーの背景の彩度。
- `ai-welcome-text`: ウェルカム画面の大きな見出しの色。
- `ai-welcome-subtext`: チャットが空の時の説明文の色。

### UIコンポーネント
- `select-arrow`: ドロップダウンの矢印アイコン用のSVGデータURL。
- `sidebar-bg`: 左側サイドバー専用の背景色。
- `sidebar-btn-color`: サイドバーボタンのアイコン/テキストの色。
- `sidebar-btn-hover-bg`: サイドバーボタンをホバーした時の背景色。
- `sidebar-btn-hover-color`: サイドバーボタンをホバーした時のアイコン/テキストの色。
- `tab-bg`: 非アクティブなタブの背景色。
- `tab-text`: 非アクティブなタブのテキストカラー。
- `tab-active-bg`: 現在選択されているタブの背景色。
- `tab-active-text`: 現在選択されているタブのテキストカラー。
- `tab-close-bg`: タブの閉じるボタンの背景色（デフォルト）。
- `tab-close-hover-bg`: タブの閉じるボタンのホバー時の背景色。
- `tab-drag-indicator`: タブをドロップする場所を示す線の色。

### オーバーレイ
- `pane-overlay-active`: フォーカスされているペインに適用される半透明のレイヤー。
- `pane-overlay-inactive`: フォーカスされていないペインに適用される半透明のレイヤー。

---

## 2. ターミナルセクション (`terminal`)

これらの設定はターミナルエミュレータを直接構成します。

- `foreground`: ターミナル内のデフォルトのテキストカラー。
- `background`: **アクティブ/フォーカス中**のターミナルの背景色。
- `backgroundInactive`: **非アクティブ/フォーカス外**のターミナルの背景色。
- `paneBackground`: ターミナルの背後のスペースの色（パディングや余白がある場合に表示されます）。

---

## 変更の適用方法

`src/themes.json` を変更した後、以下の手順が必要になる場合があります：
1. アプリケーションを再起動するか、開発者ウィンドウをリロード（**Ctrl+R**）する。
2. 変更が反映されない場合は、**Settings**（設定）画面でテーマ（例: 一度 Light にしてから Dark に戻す）を選択し直して、`localStorage` にキャッシュされた値を更新してください。
3. 開発モードの場合は、ブラウザのコンソールを開いてCSS変数のエラーが出ていないか確認してください。
