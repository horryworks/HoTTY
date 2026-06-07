# HoTTY

**AI統合型 高機能ターミナルエミュレータ** — Rust (Tauri v2) + React + TypeScript で構築。

HoTTY は、SSH、Telnet、シリアル、WSL、ローカルシェル (cmd / PowerShell / Git Bash) 接続に対応した Windows 向けマルチプロトコルターミナルエミュレータです。マルチペインレイアウト、統合ユーティリティツール、テーマ機能、セッションログなどを備えています。

> これは [HoTTY (Electron版)](https://github.com/horryworks/HoTTY) を Tauri v2 でフルスクラッチで書き直したバージョンです。メモリ効率とパフォーマンスが大幅に向上しています。

## 機能

### マルチプロトコル接続
- **SSH** — ホスト鍵検証、秘密鍵認証、アルゴリズム設定対応
- **Telnet** — エンコーディング対応 (UTF-8, Shift_JIS, EUC-JP)
- **シリアル** — ボーレート、データビット、パリティ、ストップビット、フロー制御の設定対応
- **WSL** — ディストリビューション選択対応
- **ローカルシェル** — cmd、PowerShell、Git Bash

### マルチペインレイアウト
- 柔軟なグリッドレイアウト: 1x1, 1x2, 2x1, 2x2, 2x3, 3x2
- 四辺 (左・右・上・下) に折りたたみ可能なサイドバー
- キーボードによるペインフォーカス移動 (`Ctrl+Tab` / `Ctrl+Shift+Tab`)
- ドラッグ＆ドロップによるタブの並べ替えとペイン割り当て
- セッションタブとフィーチャーペインタブの管理

### 統合ユーティリティツール
- **ログビューア** — セッションログファイルの閲覧・表示
- **テキストエディタ** — ファイルの表示・編集・保存 (改行コード対応)
- **ファイルエクスプローラ** — ディレクトリ・ドライブの参照、エディタでファイルを開く
- **Pingモニター** — 複数ターゲットの監視 (間隔設定可能)

### テーマ・外観
- 組み込みテーマ: Dark、Medium、Light
- CSS変数によるカスタムテーマ対応
- フォントファミリー・フォントサイズの設定

### セキュリティ・認証情報
- Windows DPAPI による認証情報の暗号化
- SSH ホスト鍵検証 (フィンガープリント表示)
- クリップボード内容の貼り付け確認モーダル

### セッション管理
- セッションごとのエンコーディング選択
- セッションログのファイル出力
- 接続ホストツリーのエクスポート・インポート (暗号化 .htree 形式)

### AI 統合
- マルチプロバイダー対応: Google AI Studio (Gemini)、Vertex AI、Anthropic (Claude)、OpenAI (GPT)
- AI チャットペイン — ストリーミングレスポンス、ペルソナ、トークンコスト追跡
- Ask AI — ターミナル出力を右クリックして、組み込みまたはカスタムコマンドで AI に問い合わせ
- インタラクティブモード — AI がターミナルコマンドを提案・実行 (安全性分類付き)
- ウォッチモード — ターミナル出力を監視し、キャプチャしたログを AI に送信して分析
- カスタマイズ可能なペルソナと Ask AI コマンド

### その他の機能
- Google Cloud インスタンス向け GCE IAP トンネル
- SSH アルゴリズム設定 (KEX, 暗号, MAC, ホスト鍵)
- システムフォント検出
- コンテキストメニュー
- デバッグログ管理

## インストール

[Releases](https://github.com/horryworks/HoTTY/releases) ページから最新のインストーラーをダウンロードしてください。

## 開発

### 前提条件
- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://www.rust-lang.org/tools/install) (1.77.2+)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### コマンド

```bash
npm install              # フロントエンド依存パッケージのインストール
npm run tauri:dev        # 開発サーバー + Tauri ウィンドウの起動
npm run tauri:build      # インストーラー付きプロダクションビルド
npm run test             # フロントエンドテスト実行 (Vitest)
npm run lint             # ESLint 実行
cd src-tauri && cargo test   # バックエンドテスト実行
cd src-tauri && cargo clippy # Clippy リント実行
```

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React, TypeScript, Vite |
| バックエンド | Rust, Tauri v2 |
| ターミナル | @xterm/xterm |
| 状態管理 | Zustand (persist ミドルウェア) |
| テスト | Vitest (フロントエンド), cargo test (バックエンド) |

## ライセンス

GPL-3.0-or-later
