# HoTTY Rust/Tauri 移行仕様書

> この文書は、Electron版HoTTYの全機能をRust/Tauri v2で再実装するための完全な設計仕様書です。

---

## 1. プロジェクト概要

- **アプリ名:** HoTTY — AI統合型アドバンスドターミナルエミュレータ
- **ライセンス:** GPL-3.0-or-later
- **対応プラットフォーム:** Windows（優先）、将来的にmacOS/Linux対応可能
- **目的:** Electron版HoTTYのRust/Tauri書き直しによるメモリ使用量の大幅削減
- **元リポジトリ:** `horryworks/HoTTY`（Electron版）

### 1.1 主要機能一覧
1. **マルチプロトコル接続:** SSH, Telnet, Serial, WSL, Local (cmd/PowerShell/Git Bash)
2. **AI統合:** 4プロバイダー対応 (Gemini, Vertex AI, OpenAI, Anthropic)
3. **フレキシブルグリッドレイアウト:** 1x1〜3x2の6パターン + 4サイドバー
4. **統合ツール:** テキストエディタ、ファイルエクスプローラ、ログビューア、Pingモニタ
5. **ホストツリー管理:** フォルダ階層、認証情報暗号化保存
6. **カスタムテーマ:** 107+ CSS変数、3ビルトインテーマ + カスタムテーマ作成
7. **セッションログ:** タイムスタンプ付きログ記録
8. **SSH拡張:** ジャンプボックス、GCP IAPトンネル、known_hosts管理、アルゴリズム設定
9. **AIインタラクティブフロー:** ターミナル出力の自動監視、コマンド自動実行

---

## 2. 技術スタック

### 2.1 フロントエンド（Webview）
| ライブラリ | バージョン | 用途 |
|---|---|---|
| React | 19.x | UIフレームワーク |
| TypeScript | 6.x | 型安全性 |
| Vite | 8.x | ビルドツール |
| @xterm/xterm | 6.0.0 | ターミナルエミュレータ |
| @xterm/addon-fit | 0.11.0 | ターミナル自動リサイズ |
| Zustand | 5.x | 状態管理（persistミドルウェア） |
| DOMPurify | 3.x | HTML/XSSサニタイズ |
| marked | 18.x | Markdownレンダリング |
| @tanstack/react-virtual | 3.x | 仮想スクロール |

### 2.2 バックエンド（Rust/Tauri）
| クレート | 用途 |
|---|---|
| tauri v2 | アプリケーションフレームワーク |
| tauri-plugin-dialog | ファイル/フォルダ選択ダイアログ |
| tauri-plugin-shell | 外部URL開く |
| tauri-plugin-clipboard-manager | クリップボード操作 |
| tauri-plugin-fs | ファイルシステムアクセス |
| tauri-plugin-process | プロセス管理 |
| portable-pty | PTY管理 (WSL/Local) |
| russh / russh-keys | SSHクライアント |
| serialport | シリアルポート通信 |
| tokio | 非同期ランタイム |
| reqwest | HTTP (AIプロバイダー通信、アップデートチェック) |
| windows (cfg(windows)) | Windows DPAPI、LogonUser API |
| aes-gcm / pbkdf2 / sha2 | htreeエクスポート暗号化 |
| encoding_rs | 文字エンコーディング変換 |
| thiserror / anyhow | エラーハンドリング |
| serde / serde_json | シリアライゼーション |

---

## 3. アーキテクチャ

### 3.1 通信フロー
```
[Renderer (React)]
    ↓ invoke('command_name', { args })
[tauriService.ts] ← 型安全ラッパー
    ↓
[Tauri IPC Bridge]
    ↓
[#[tauri::command] fn command_name(...)]  ← src-tauri/src/commands/
    ↓
[Service Layer]  ← src-tauri/src/services/
    ↓
[OS / Network / External]

[バックエンド → フロントエンド イベント]
Service → app.emit_to("main", "event-name", payload)
    ↓
tauriService.ts: listen("event-name", callback)
    ↓
React hook callback
```

### 3.2 Electron IPC → Tauri コマンド マッピング

#### セッション管理
| Electron IPC | Tauri コマンド | 方向 | ペイロード |
|---|---|---|---|
| `connect-session` | `connect_session` | invoke | `{ sessionId, protocol, config }` |
| `disconnect-session` | `disconnect_session` | invoke | `{ sessionId }` |
| `term-input` | `send_input` | invoke | `{ sessionId, data }` |
| `term-resize` | `term_resize` | invoke | `{ sessionId, cols, rows }` |
| `update-session-encoding` | `update_session_encoding` | invoke | `{ sessionId, encoding }` |

#### セッションイベント（バックエンド→フロントエンド）
| Electron Event | Tauri Event | ペイロード |
|---|---|---|
| `session-data` | `session-data` | `{ sessionId, data: string }` |
| `session-status` | `session-status` | `{ sessionId, status: 'connected'\|'disconnected' }` |
| `session-error` | `session-error` | `{ sessionId, error: string }` |

#### AI/チャット
| Electron IPC | Tauri コマンド | 方向 |
|---|---|---|
| `ai-auth-start` | `ai_auth_start` | invoke |
| `ai-auth-auto` | `ai_auth_auto` | invoke |
| `ai-auth-status` | `ai_auth_status` | invoke |
| `ai-auth-logout` | `ai_auth_logout` | invoke |
| `ai-chat-send` | `ai_chat_send` | invoke |
| `ai-chat-cancel` | `ai_chat_cancel` | invoke |
| `ai-chat-clear` | `ai_chat_clear` | invoke |
| `ai-list-models` | `ai_list_models` | invoke |
| `ai-list-locations` | `ai_list_locations` | invoke |
| `ai-set-provider` | `ai_set_provider` | invoke |
| `ai-set-location` | `ai_set_location` | invoke |
| `select-service-account-key-file` | `select_service_account_key_file` | invoke |

#### AIイベント（バックエンド→フロントエンド）
| Electron Event | Tauri Event | ペイロード |
|---|---|---|
| `ai-auth-result` | `ai-auth-result` | `{ success: boolean }` |
| `ai-chat-response` | `ai-chat-response` | `{ sessionId, type: 'chunk'\|'done'\|'error', content, usageMetadata? }` |

#### ファイル操作
| Electron IPC | Tauri コマンド |
|---|---|
| `select-image` | `select_image` |
| `select-folder` | `select_folder` |
| `text-editor-open-file` | `text_editor_open_file` |
| `text-editor-save-file` | `text_editor_save_file` |
| `text-editor-read-file` | `text_editor_read_file` |
| `text-editor-write-file` | `text_editor_write_file` |
| `text-editor-approve-dropped-file` | `text_editor_approve_dropped_file` |
| `file-explorer-list-directory` | `file_explorer_list_directory` |
| `file-explorer-get-drives` | `file_explorer_get_drives` |

#### 暗号化
| Electron IPC | Tauri コマンド |
|---|---|
| `dpapi-encrypt` | `dpapi_encrypt` |
| `dpapi-decrypt` | `dpapi_decrypt` |
| `dpapi-encrypt-batch` | `dpapi_encrypt_batch` |
| `dpapi-decrypt-batch` | `dpapi_decrypt_batch` |
| `dpapi-verify-user` | `dpapi_verify_user` |

#### テーマ
| Electron IPC | Tauri コマンド |
|---|---|
| `get-themes` | `get_themes` |
| `save-custom-theme` | `save_custom_theme` |
| `delete-custom-theme` | `delete_custom_theme` |

#### Pingモニタ
| Electron IPC | Tauri コマンド |
|---|---|
| `ping-monitor-start` | `ping_monitor_start` |
| `ping-monitor-stop` | `ping_monitor_stop` |
| `ping-monitor-update-targets` | `ping_monitor_update_targets` |
| `ping-monitor-update-interval` | `ping_monitor_update_interval` |

#### Pingイベント
| Event | ペイロード |
|---|---|
| `ping-monitor-data` | `{ sessionId, results: [{ target, status, rtt, ttl, timestamp }] }` |
| `ping-monitor-log-file` | `{ sessionId, fileName }` |

#### システム/ユーティリティ
| Electron IPC | Tauri コマンド |
|---|---|
| `list-serial-ports` | `list_serial_ports` |
| `list-wsl-distributions` | `list_wsl_distributions` |
| `detect-git-bash` | `detect_git_bash` |
| `list-system-fonts` | `list_system_fonts` |
| `get-app-version` | `get_app_version` |
| `set-window-size` | `set_window_size` |
| `focus-window` | `focus_window` |
| `write-clipboard` | `write_clipboard` |
| `show-context-menu` | `show_context_menu` |
| `open-external` | `open_external` |
| `open-debug-log-folder` | `open_debug_log_folder` |

#### ログ
| Electron IPC | Tauri コマンド |
|---|---|
| `log-debug` | `log_debug` |
| `update-logging` | `update_logging` |
| `list-log-files` | `list_log_files` |
| `read-log-file` | `read_log_file` |

#### SSH設定
| Electron IPC | Tauri コマンド |
|---|---|
| `get-ssh-algorithms` | `get_ssh_algorithms` |
| `save-ssh-algorithms` | `save_ssh_algorithms` |

#### GCP IAP
| Electron IPC | Tauri コマンド |
|---|---|
| `gce-iap-check-gcloud` | `gce_iap_check_gcloud` |
| `gce-iap-check-auth` | `gce_iap_check_auth` |
| `gce-iap-list-projects` | `gce_iap_list_projects` |
| `gce-iap-list-zones` | `gce_iap_list_zones` |
| `gce-iap-list-instances` | `gce_iap_list_instances` |

#### インポート/エクスポート
| Electron IPC | Tauri コマンド |
|---|---|
| `export-htree` | `export_htree` |
| `select-import-file` | `select_import_file` |
| `decrypt-import-file` | `decrypt_import_file` |

#### その他イベント
| Event | 用途 |
|---|---|
| `terminal-context-paste` | 右クリックメニューからの貼り付け |
| `ask-gemini` | 右クリックメニューからのAI問い合わせ |
| `update-available` | アップデート通知 |
| `open-file-in-editor` | ファイル関連付けからの開く |

### 3.3 状態管理

#### settingsStore（Zustand + persist）
**永続化キー:** `hotty-settings`（バージョン3、マイグレーション付き）

#### paneStore（Zustand + persist）
**永続化キー:** `hotty-pane-layout`
**状態:** `layoutMode: '1x1' | '1x2' | '2x1' | '2x2' | '2x3' | '3x2'`

#### sidebarLayoutStore（Zustand + persist）
**永続化キー:** `hotty-sidebar-layout`
**状態:**
- `showLeftSidebar`, `showRightSidebar`, `showTopBar`, `showBottomBar`: boolean
- `leftSidebarPercent`, `rightSidebarPercent`, `topBarPercent`, `bottomBarPercent`: number (デフォルト20%)

---

## 4. プロトコル詳細仕様

### 4.1 SSH (`services/ssh.rs`)
**Rustクレート:** `russh` + `russh-keys`

**SessionServiceトレイト実装:**
```rust
trait SessionService: Send + Sync {
    async fn connect(&mut self, config: SessionConfig) -> Result<(), SessionError>;
    fn write(&mut self, data: &str);
    fn resize(&mut self, cols: u32, rows: u32);
    fn disconnect(&mut self);
    fn set_encoding(&mut self, encoding: &str);
}
```

**SSH接続フロー:**
1. アルゴリズム設定読み込み（`~/.config/ssh_algorithms.json`）
2. ジャンプボックス経由の場合: 先にジャンプボックスSSH接続→ポートフォワーディング
3. IAP経由の場合: `gcloud compute start-iap-tunnel`でローカルポート取得→localhost接続
4. 接続確立: ユーザー名/パスワード認証 + keyboard-interactive認証
5. ホストキー検証: known_hosts確認、TOFU/MITM警告ダイアログ
6. PTYチャンネル開設: `xterm-256color`、初期サイズ80x24
7. データ送受信: エンコーディング変換（`encoding_rs`使用）

**SSH KeepAlive設定:**
- `sshKeepAliveEnabled`: boolean（デフォルト: true）
- `sshKeepAliveInterval`: 秒（デフォルト: 10）

**SSHアルゴリズム設定:**
- KEX: curve25519-sha256, ecdh-sha2-nistp256/384/521, diffie-hellman-group14/16/18-sha256/512, diffie-hellman-group-exchange-sha256
- 暗号: chacha20-poly1305, aes128/192/256-gcm, aes128/192/256-ctr, aes128/192/256-cbc, 3des-cbc, blowfish-cbc, etc.
- ホスト鍵: ssh-ed25519, ecdsa-sha2-nistp256/384/521, rsa-sha2-256/512, ssh-rsa, ssh-dss
- HMAC: hmac-sha2-256/512, hmac-sha1, hmac-md5, hmac-ripemd160

**IPC送信イベント:**
- `session-status: { sessionId, status: 'connected' | 'disconnected' }`
- `session-data: { sessionId, data: string }`
- `session-error: { sessionId, error: string }`

### 4.2 Telnet (`services/telnet.rs`)
**実装:** `tokio::net::TcpStream`ベースのカスタム実装

**接続フロー:**
1. TCP接続
2. ログイン状態マシン: `waitingForUsername` → `waitingForPassword` → `done`
3. ユーザー名/パスワードプロンプト自動検出（正規表現）
4. IAC（Interpret As Command）シーケンスのストリッピング
5. NAWS（Negotiate About Window Size）送信
6. KeepAlive: TCP KeepAlive + IAC NOP定期送信

**Telnet KeepAlive設定:**
- `telnetKeepAliveEnabled`: boolean（デフォルト: true）
- `telnetKeepAliveInterval`: 秒（デフォルト: 30）

**IAC処理:**
- IAC SB (サブネゴシエーション) 除去
- IAC WILL/WONT/DO/DONT 処理
- エスケープされたIAC (0xFF 0xFF) → 単一0xFF

**ジャンプボックス経由接続:**
- ローカルTCPプロキシ（localhost:ランダムポート）を作成
- ジャンプボックスSSHトンネルをプロキシにブリッジ

### 4.3 Serial (`services/serial.rs`)
**Rustクレート:** `serialport`

**接続設定:**
```rust
struct SerialConfig {
    path: String,           // COM1-COM999 (Windows), /dev/tty* (Linux/Mac)
    baud_rate: u32,
    data_bits: DataBits,    // Five, Six, Seven, Eight
    parity: Parity,         // None, Even, Odd, Mark, Space
    stop_bits: StopBits,    // One, OnePointFive, Two
    flow_control: FlowControl, // None, XonXoff, RtsCts
    encoding: Option<String>,
}
```

**パスバリデーション:**
- Windows: `COM\d{1,3}`
- Linux/Mac: `/dev/tty.*`

**注意:** ターミナルリサイズはno-op（シリアルポートにはPTYなし）

### 4.4 WSL (`services/wsl.rs`)
**Rustクレート:** `portable-pty`

**接続フロー:**
1. ディストリビューション名バリデーション: `^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,62}$`
2. `wsl.exe -d <distro_name>` をPTYで起動（またはデフォルト）
3. PTY設定: `xterm-256color`、80x24

**ディストリビューション一覧取得:**
- `wsl.exe --list --quiet` 実行、出力をパース

**環境変数サニタイズ:**
- 以下のパターンにマッチする環境変数を除去:
  `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`, `CREDENTIAL`, `PRIVATE_KEY`, `ACCESS_KEY`

### 4.5 Local Shell (`services/local.rs`)
**Rustクレート:** `portable-pty`

**シェルタイプ:**
| タイプ | 実行パス |
|---|---|
| cmd | `C:\Windows\System32\cmd.exe` |
| powershell | `powershell.exe` |
| git-bash | 自動検出（後述） |

**Git Bash自動検出:**
1. `C:\Program Files\Git\bin\bash.exe` チェック
2. `C:\Program Files (x86)\Git\bin\bash.exe` チェック
3. フォールバック: PATHから`git.exe`を検索 → `bash.exe`パスを導出

**PTY設定:** `xterm-256color`、80x24、CWD=USERPROFILE

### 4.6 ジャンプボックス (`services/jumpbox.rs`)
**機能:** SSH経由のポートフォワーディングトンネル

**フロー:**
1. ジャンプボックスホストにSSH接続
2. `forward_out()` でターゲットホスト:ポートへのトンネル開設
3. ホストキー検証あり
4. keyboard-interactive認証サポート

### 4.7 GCP IAPトンネル (`services/iap_tunnel.rs`)
**前提:** `gcloud` CLI がインストール済み

**バリデーション:**
- プロジェクトID: `^[a-z][a-z0-9-]{4,28}[a-z0-9]$`
- ゾーン: `^[a-z]+-[a-z]+[0-9]+-[a-z]$`
- インスタンス: `^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$`

**トンネル開始フロー:**
1. `gcloud compute start-iap-tunnel <instance> <port> --zone=<zone> --project=<project> --local-host-port=localhost:0`
2. stdout監視: `Listening on port [XXXXX]` を検出
3. `localhost:XXXXX` に対してSSH接続

---

## 5. AI統合仕様

### 5.1 プロバイダーアーキテクチャ
```rust
#[async_trait]
trait AIProvider: Send + Sync {
    fn id(&self) -> &str;
    fn display_name(&self) -> &str;
    fn auth_type(&self) -> AuthType; // OAuth2, ServiceAccount, ApiKey, Adc
    
    async fn authenticate(&mut self, credentials: Value) -> Result<bool, String>;
    async fn auto_auth(&mut self, credentials: Value) -> Result<bool, String>;
    fn get_auth_status(&self) -> AuthStatus;
    fn logout(&mut self);
    
    async fn send_message(&mut self, session_id: &str, message: &str, model: &str, system_instruction: Option<&str>) -> Result<(), String>;
    fn cancel_message(&mut self, session_id: &str);
    fn clear_history(&mut self, session_id: &str);
    async fn list_models(&self) -> Result<Vec<ModelInfo>, String>;
    
    fn set_location(&mut self, _location: &str) {} // オプション（Vertex AI用）
    async fn list_locations(&self) -> Result<Vec<String>, String> { Ok(vec![]) }
}
```

**AuthStatus:**
```rust
struct AuthStatus {
    authenticated: bool,
    email: Option<String>,
}
```

**ModelInfo:**
```rust
struct ModelInfo {
    id: String,
    display_name: String,
}
```

### 5.2 プロバイダー別仕様

#### Gemini (`providers/gemini.rs`)
- **ID:** `gemini`
- **表示名:** "Google AI Studio (Gemini)"
- **認証:** OAuth2（ブラウザベース認証フロー）
- **API:** Google AI Generative Language API
- **ストリーミング:** SSE (Server-Sent Events)

#### Vertex AI (`providers/vertexai.rs`)
- **ID:** `vertexai`
- **表示名:** "Google Cloud (Vertex AI)"
- **認証:** サービスアカウントJSON / ADC
- **API:** Vertex AI Generative AI API
- **ストリーミング:** SSE
- **追加機能:** リージョン（ロケーション）選択、プロジェクトID設定
- **GCPリソースIDバリデーション:** プロジェクト/リージョン形式検証

#### OpenAI (`providers/openai.rs`)
- **ID:** `openai`
- **表示名:** "OpenAI (GPT)"
- **認証:** APIキー
- **API:** OpenAI Chat Completions API
- **ストリーミング:** SSE (`stream: true`)

#### Anthropic (`providers/anthropic.rs`)
- **ID:** `anthropic`
- **表示名:** "Anthropic (Claude)"
- **認証:** APIキー
- **API:** Anthropic Messages API
- **ストリーミング:** SSE (`stream: true`)

### 5.3 AIチャットレスポンス形式
```rust
struct ChatResponseData {
    session_id: String,
    response_type: String,  // "chunk" | "done" | "error"
    content: String,
    usage_metadata: Option<UsageMetadata>,
}

struct UsageMetadata {
    prompt_token_count: Option<u32>,
    candidates_token_count: Option<u32>,
    total_token_count: Option<u32>,
}
```

### 5.4 ペルソナシステム
6つのデフォルトペルソナ:

| ID | ラベル | システムプロンプト概要 |
|---|---|---|
| `network-expert` | Network Expert | シニアネットワークエンジニア。OSI層、ルーティングプロトコル（BGP, OSPF）、スイッチング |
| `general-helper` | General Helper | 汎用技術アシスタント |
| `server-expert` | Server Expert | Linux/Windowsサーバー管理者。OS内部、カーネルパラメータ、パフォーマンスチューニング |
| `cloud-expert` | Cloud Expert | クラウドアーキテクト（AWS/Azure/GCP）。IaC、マイクロサービス |
| `coding-expert` | Coding Expert | シニアソフトウェアエンジニア。クリーンコード、Big O |
| `security-analyst` | Security Analyst | サイバーセキュリティアナリスト。NIST/CIS基準 |

各ペルソナは独自の**Ask AIコマンド**（4〜6個）を持つ:
- Network Expert: Explain output, Troubleshoot, Suggest commands, Optimize config, What does it mean?, Compare configs
- General Helper: What is this?, What does it mean?, Summarize, Research root cause, Fix this, Rewrite
- Server Expert: Explain output, Troubleshoot, Suggest commands, Check for issues, Optimize performance, Research root cause
- Cloud Expert: Explain resource, Estimate cost, Review architecture, Convert to IaC, Troubleshoot, What does it mean?
- Coding Expert: Explain code, Fix this, Refactor, Write tests, Optimize, What's the complexity?
- Security Analyst: Analyze threats, Check vulnerabilities, Explain alert, Suggest hardening, Research root cause, Explain IoC

### 5.5 AIシステムプロンプトルール (`buildExecutionRules()`)
全AIリクエストに追加される必須ルール:
1. ユーザーが聞いたことだけに答える。次のステップや追加コマンドを提案しない
2. 回答後、停止する
3. シェルコマンドは必ず1つの ` ```execute ` ブロックに記載
4. 各コマンドは独立した行に記載。`&&` や `;` でチェーンしない
5. ` ```bash ` など他のコードブロックは使用禁止
6. より多くの情報が必要な場合は、`execute`ブロックでコマンドを提案する

### 5.6 コマンド実行モード
```typescript
type CommandExecutionMode = 'ask-before-execute' | 'auto-execute-safe';
```
- `ask-before-execute`: 全コマンド実行前に確認
- `auto-execute-safe`: 安全と判定されたコマンドは自動実行（最大連続実行回数設定あり）
- `maxConsecutiveAutoExecutions`: デフォルト10（0=無制限）
- `customSafeCommands`: ユーザー定義の安全コマンドリスト

### 5.7 トークンコスト計算 (`aiPricing`)
最長プレフィックスマッチでモデル名→料金テーブルを検索。

**Gemini料金（USD/1Mトークン）:**
- gemini-3.1-pro: input=2.00, output=12.00
- gemini-2.5-pro: input=1.25, output=10.00
- gemini-2.5-flash: input=0.30, output=2.50
- gemini-2.0-flash: input=0.10, output=0.40

**OpenAI料金:**
- gpt-4.1: input=2.00, output=8.00
- gpt-4.1-mini: input=0.40, output=1.60
- o3: input=2.00, output=8.00

**Anthropic料金:**
- claude-opus-4: input=15.00, output=75.00
- claude-sonnet-4: input=3.00, output=15.00
- claude-haiku-4: input=0.80, output=4.00

---

## 6. UIコンポーネント仕様

### 6.1 コンポーネント一覧（全34）

| # | コンポーネント | 種別 | 主要機能 |
|---|---|---|---|
| 1 | **Terminal** | Feature | @xterm/xterm ラッパー。リサイズ、行折り返し、プロンプトハイライト |
| 2 | **GridLayout** | Container | メイングリッド。1x1〜3x2レイアウト描画 |
| 3 | **TabBar** | Container | タブ管理。ドラッグ並替え、監視インジケータ、機能メニュー |
| 4 | **PaneContent** | Router | セッション種別に応じて適切なコンポーネントを描画 |
| 5 | **PaneLines** | Visual | タブ→ペインを接続するSVGライン（6色） |
| 6 | **AIChatPane** | Feature | AIチャットUI。Markdown表示、コード実行、モデル選択、認証パネル |
| 7 | **AuthenticationPanel** | Sub | Gemini OAuth2認証UI |
| 8 | **VertexAIAuthPanel** | Sub | Vertex AI GCPプロジェクト設定UI |
| 9 | **OpenAIAuthPanel** | Sub | OpenAI APIキーUI |
| 10 | **AnthropicAuthPanel** | Sub | Anthropic APIキーUI |
| 11 | **LogViewerPane** | Feature | ログファイルビューア。検索（正規表現/リテラル）、仮想スクロール |
| 12 | **TextEditorPane** | Feature | マルチタブテキストエディタ。行番号、検索置換、Go To Line、エンコーディング選択 |
| 13 | **FileExplorerPane** | Feature | ツリー型ファイルブラウザ。パンくず、ドライブ選択、隠しファイル表示 |
| 14 | **PingMonitorPane** | Feature | マルチターゲットICMP Pingモニタ。CSV出力 |
| 15 | **SessionDialog** | Modal | 接続ダイアログ。プロトコル選択、ホストツリー、クイック接続 |
| 16 | **HostTree** | Sub | ホスト/フォルダツリーUI。右クリックメニュー、ドラッグ移動 |
| 17 | **SettingsModal** | Modal | 設定モーダル（5タブ） |
| 18 | **AppearanceTab** | Sub | テーマ選択、背景設定 |
| 19 | **GeneralTab** | Sub | エンコーディング、フォント、ログ、スクロールバック |
| 20 | **ProtocolsTab** | Sub | SSHアルゴリズム、KeepAlive設定 |
| 21 | **FeaturesTab** | Sub | 機能トグル（LogViewer, PingMonitor等） |
| 22 | **AISettingsTab** | Sub | AIプロバイダー選択、ペルソナ管理、実行モード |
| 23 | **CustomThemeCreator** | Modal | インタラクティブテーマエディタ。107+変数、ライブプレビュー |
| 24 | **ConfirmModal** | Modal | 確認ダイアログ。ドラッグ可能 |
| 25 | **MessageModal** | Modal | 情報/エラー/成功メッセージ |
| 26 | **PasteConfirmationModal** | Modal | 貼り付け確認（改行警告） |
| 27 | **SaveConfirmModal** | Modal | 未保存変更確認（3ボタン: Cancel/Discard/Save） |
| 28 | **AskAiModal** | Modal | フリーフォーマットAI質問 |
| 29 | **HelpModal** | Modal | ヘルプ・ドキュメント |
| 30 | **HelpTooltip** | Utility | インラインヘルプアイコン（ポータル描画） |
| 31 | **UpdateNotification** | Banner | アップデート通知バナー |
| 32 | **LayoutSelector** | Utility | レイアウトモード選択、サイドバートグル |
| 33 | **ResizeGrip** | Utility | ウィンドウリサイズハンドル |
| 34 | **ErrorBoundary** | Container | エラーバウンダリ（リトライボタン） |

### 6.2 コンポーネント階層
```
App
├── ErrorBoundary
│   ├── GridLayout
│   │   ├── PaneContent × 6スロット
│   │   │   ├── Terminal
│   │   │   ├── AIChatPane (+ 4認証パネル)
│   │   │   ├── LogViewerPane
│   │   │   ├── TextEditorPane
│   │   │   ├── FileExplorerPane
│   │   │   └── PingMonitorPane
│   │   ├── TabBar
│   │   └── PaneLines
│   ├── ResizeGrip
│   ├── UpdateNotification
│   ├── SessionDialog → HostTree
│   ├── SettingsModal → 5タブ
│   ├── CustomThemeCreator
│   ├── HelpModal
│   ├── ConfirmModal / MessageModal / PasteConfirmationModal / SaveConfirmModal / AskAiModal
│   └── HelpTooltip
```

---

## 7. カスタムフック仕様

### 7.1 useSessionManager
**公開API:**
- `sessions: Session[]` — 全セッション
- `tabOrder: string[]` — タブ順序
- `terminalRegistry: Ref<{[sessionId]: Terminal}>` — xtermインスタンス管理
- `createSession(config)` — 接続セッション作成
- `createAISession()` — AIチャットセッション作成
- `createLogViewerSession()` — ログビューアセッション
- `createPingMonitorSession()` — Pingモニタセッション
- `createTextEditorSession(filePath?)` — テキストエディタセッション
- `createFileExplorerSession()` — ファイルエクスプローラセッション
- `closeSession(sessionId)` — セッション閉じる
- `closeAllAISessions()` — 全AIセッション閉じる
- `toggleWatch(sessionId, aiSessionId?)` — AI監視トグル
- `getWatchBuffer(sessionId)` / `clearWatchBuffer(sessionId)` — 監視バッファ

**セッション種別:** ssh, telnet, serial, wsl, cmd, powershell, git-bash, ai, log-viewer, ping-monitor, text-editor, file-explorer

**監視バッファ:** ANSI除去済みテキスト、サイズ上限 `watchBufferLimit`（デフォルト500KB）

### 7.2 usePaneManager
**公開API:**
- `layoutMode`, `setLayoutMode(mode)` — レイアウト管理
- `activePaneId`, `setActivePaneId(id)` — アクティブペイン
- `paneAllocations: {[paneId]: sessionId}` — ペイン割り当て
- `handleDropSession(sessionId, targetPaneId)` — ドラッグ&ドロップ
- `handleTabClick(sessionId)` — タブクリック
- `visibleSessionIds`, `activeSessionId` — 可視セッション

**ペイン番号:** グリッドペイン(0〜5) + sidebar-left, sidebar, top-bar, bottom-bar

### 7.3 useSettings
settingsStoreのラッパーフック。全設定値と40+更新メソッドを公開。

### 7.4 useAiChat
- `sendMessage(aiSessionId, text)` — メッセージ送信
- `askAi(selection, type, targetSessionId?)` — コンテキストメニューからのAI問い合わせ
- `showPromptMenu(aiSessionId)` — プロンプトメニュー表示
- `askAiFreeFormatData` / `handleFreeFormatSubmit` — フリーフォーマット質問

### 7.5 useInteractiveFlow
- `trackings: {[termSessionId]: InteractiveSessionTracking}` — 追跡状態
- `startTracking(termSessionId, aiSessionId, command)` — コマンド実行追跡開始
- `cancelTracking(termSessionId)` — キャンセル
- `sendNow(termSessionId)` — 即時送信

**動作:**
- ターミナル出力をリアルタイム監視
- プロンプトパターン検出でバッファ末尾を確認
- 400ms安定化タイムアウト後にAIへフィードバック送信
- 15分TTLでクリーンアップ

### 7.6 useSidebarLayout
サイドバーの可視性制御とドラッグリサイズ（最小5%、最大80%）。

### 7.7 useHostManager
- `tree: HostTreeNode[]` — ホストツリー
- CRUD操作: `addFolder`, `addHost`, `editNode`, `deleteNode`, `moveNode`, `sortFolder`
- `importData(nodes, folderName?, parentId?)` — インポート

**HostEntry:**
```typescript
interface HostEntry {
    protocol: 'ssh' | 'telnet';
    host: string;
    port: number;
    username?: string;
    password?: string;  // DPAPI暗号化済み ([SAFE]prefix)
    isJumpbox?: boolean;
    jumpboxId?: string;
    iapTunnel?: { project, zone, instance, port };
}
```

**暗号化:** 認証情報はDPAPI暗号化で保存。`[SAFE]`プレフィックス。レガシー`[DPAPI]`からの自動マイグレーション。

### 7.8〜7.11 ユーティリティフック
- **useDraggable:** モーダルドラッグ
- **useFocusTrap:** モーダルフォーカストラップ
- **useModalState:** モーダル開閉状態管理
- **useResize:** ウィンドウリサイズイベント

---

## 8. Tauriコマンド実装仕様

### 8.1 セッション管理 (`commands/session.rs`)
```rust
#[tauri::command]
async fn connect_session(
    app: AppHandle,
    session_id: String,
    protocol: String,   // "ssh" | "telnet" | "serial" | "wsl" | "cmd" | "powershell" | "git-bash"
    config: Value,      // プロトコル固有の設定
) -> Result<(), String>;

#[tauri::command]
fn disconnect_session(session_id: String) -> Result<(), String>;

#[tauri::command]
fn send_input(session_id: String, data: String) -> Result<(), String>;

#[tauri::command]
fn term_resize(session_id: String, cols: u32, rows: u32) -> Result<(), String>;

#[tauri::command]
fn update_session_encoding(session_id: String, encoding: String) -> Result<(), String>;
```

### 8.2 セッション状態管理
Rustバックエンドで管理する状態:
```rust
struct AppState {
    sessions: Mutex<HashMap<String, Box<dyn SessionService>>>,
    ai_service: Mutex<Option<AIService>>,
    log_manager: Mutex<LogManager>,
    ping_monitors: Mutex<HashMap<String, PingMonitorService>>,
    allowed_log_dirs: Mutex<HashSet<PathBuf>>,
    media_tokens: Mutex<HashMap<String, PathBuf>>,
}
```

### 8.3 各コマンドモジュール概要

**`commands/ai.rs`:** AIプロバイダー認証、チャット送信/キャンセル/クリア、モデル一覧、プロバイダー切替、ロケーション管理

**`commands/dpapi.rs`:** 暗号化/復号化（単一・バッチ）、Windowsユーザー検証（LogonUser API）

**`commands/themes.rs`:** ビルトインテーマ読み込み（`resources/`）、カスタムテーマ保存/削除（`~/.config/themes/`）

**`commands/ping_monitor.rs`:** 開始/停止/ターゲット更新/間隔更新。ICMPレスポンスをイベントで配信。

**`commands/system.rs`:** シリアルポート一覧、WSLディストリビューション一覧、Git Bash検出、システムフォント一覧、アプリバージョン、ウィンドウリサイズ、クリップボード、コンテキストメニュー、外部URL、デバッグログフォルダ

**`commands/ssh_algorithms.rs`:** アルゴリズム設定読み込み/保存（`~/.config/ssh_algorithms.json`）

**`commands/iap_tunnel.rs`:** gcloud CLI検出/認証チェック/プロジェクト一覧/ゾーン一覧/インスタンス一覧

**`commands/host_tree.rs`:** htreeエクスポート（AES-256-GCM + PBKDF2暗号化）/インポート/復号化

**`commands/log_viewer.rs`:** ログファイル一覧/読み込み

**`commands/file_explorer.rs`:** ディレクトリ一覧/Windowsドライブ一覧

**`commands/text_editor.rs`:** ファイル開く/保存/読み込み/書き込み/ドロップ承認

---

## 9. イベント仕様（バックエンド→フロントエンド）

| イベント名 | ペイロード | 説明 |
|---|---|---|
| `session-data` | `{ sessionId, data }` | ターミナルデータ |
| `session-status` | `{ sessionId, status }` | 接続状態変更 |
| `session-error` | `{ sessionId, error }` | エラー通知 |
| `ai-auth-result` | `{ success }` | AI認証結果 |
| `ai-chat-response` | `{ sessionId, type, content, usageMetadata? }` | AIレスポンス（ストリーミング） |
| `ping-monitor-data` | `{ sessionId, results[] }` | Ping結果 |
| `ping-monitor-log-file` | `{ sessionId, fileName }` | Pingログファイル名 |
| `terminal-context-paste` | なし | 右クリック貼り付け |
| `ask-gemini` | `{ selection, type }` | 右クリックAI問い合わせ |
| `update-available` | `{ version, releaseUrl }` | アップデート通知 |
| `open-file-in-editor` | `{ filePath }` | ファイル関連付け |

---

## 10. テーマシステム

### 10.1 CSS変数一覧（107+変数）
テーマJSONファイル（`resources/dark.json`, `medium.json`, `light.json`）に定義。

**セクション1: 背景とテキスト**
- `--bg-primary`, `--bg-secondary`, `--bg-tertiary`
- `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-on-accent`

**セクション2: ボーダーとアクセント**
- `--border-color`, `--accent-color`, `--accent-hover`, `--accent-light`, `--accent-secondary`

**セクション3: 入力・ボタン・ホバー**
- `--input-bg`, `--btn-bg`, `--btn-hover-bg`, `--btn-secondary-bg`, `--btn-secondary-hover-bg`, `--btn-danger-bg`, `--btn-danger-hover-bg`

**セクション4: ステータス**
- `--success-color`, `--status-success`, `--status-error`, `--color-danger`, `--color-warning`

**セクション5: AIチャット**
- `--chat-msg-user-bg`, `--chat-msg-user-text`, `--chat-msg-model-text`, `--code-bg`, `--code-text`, `--ai-header-bg`, `--ai-welcome-text`, `--ai-welcome-subtext`

**セクション6: UIコンポーネント**
- `--sidebar-*`, `--tab-*`, `--context-menu-*`, `--hidden-item-*`, `--tree-meta-color`, `--icon-folder`, `--icon-host`, `--terminal-prompt-*`, `--pane-color-1`〜`--pane-color-6`

**セクション7: 検索**
- `--search-highlight-*`

**セクション8: オーバーレイ・モーダル**
- `--modal-overlay-bg`, `--modal-shadow`, `--modal-border-*`, `--modal-header-*-bg/text`, `--update-notification-*`

**セクション9: ターミナル**（JSONの`terminal`セクション）
- `foreground`, `background`, `backgroundInactive`, `paneBackground`

### 10.2 カスタムテーマ機能
- `CustomThemeCreator`コンポーネントで全変数を視覚的に編集
- `THEME_SECTIONS`配列でセクション分け
- `VAR_DESCRIPTIONS`でツールチップ表示
- カスタムテーマはユーザーデータフォルダ（`~/.config/themes/`）に保存
- ビルトインテーマ（dark, medium, light）は編集不可

---

## 11. 型定義

### 11.1 TypeScript型
```typescript
type ProtocolId = 'ssh' | 'telnet' | 'serial' | 'wsl' | 'cmd' | 'powershell' | 'git-bash';
type FeatureId = 'ai-chat' | 'log-viewer' | 'ping-monitor' | 'text-editor' | 'file-explorer';
type CommandExecutionMode = 'ask-before-execute' | 'auto-execute-safe';

interface AskAiCommand { id: string; label: string; promptTemplate: string; }
interface PromptPattern { id: string; name: string; pattern: string; }
interface PersonaDefinition { id: string; label: string; systemPrompt: string; askAiCommands: AskAiCommand[]; }
```

### 11.2 対応Rust構造体
```rust
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AskAiCommand {
    pub id: String,
    pub label: String,
    pub prompt_template: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PromptPattern {
    pub id: String,
    pub name: String,
    pub pattern: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonaDefinition {
    pub id: String,
    pub label: String,
    pub system_prompt: String,
    pub ask_ai_commands: Vec<AskAiCommand>,
}
```

---

## 12. セキュリティ仕様

### 12.1 認証情報暗号化
**方式:** Windows DPAPI → Electron `safeStorage` → Tauri: `windows`クレート直接呼び出し

```rust
// Windows DPAPI via windows crate
use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};
```

**プレフィックス:**
- `[SAFE]` — 現行暗号化形式（base64エンコード済み）
- `[DPAPI]` — レガシー形式（互換性のため復号のみサポート）

### 12.2 Windowsユーザー検証
Win32 `LogonUser` API呼び出し:
- LogonType: `LOGON32_LOGON_INTERACTIVE (3)`
- LogonProvider: `LOGON32_PROVIDER_DEFAULT (0)`

### 12.3 パス検証
- シリアルポート: `COM\d{1,3}` (Windows) / `/dev/tty.*` (Unix)
- Pingターゲット: `^[a-zA-Z0-9:][a-zA-Z0-9.:-]{0,251}[a-zA-Z0-9.:]?$`（最大253文字）
- WSLディストリビューション: `^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,62}$`
- GCPプロジェクト: `^[a-z][a-z0-9-]{4,28}[a-z0-9]$`
- GCPゾーン: `^[a-z]+-[a-z]+[0-9]+-[a-z]$`
- GCPインスタンス: `^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$`

### 12.4 htreeエクスポート暗号化
- **アルゴリズム:** AES-256-GCM
- **鍵導出:** PBKDF2-SHA256
- **フォーマット:** salt + nonce + ciphertext

### 12.5 環境変数サニタイズ
PTY起動時に以下パターンにマッチする環境変数を除去:
`API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`, `CREDENTIAL`, `PRIVATE_KEY`, `ACCESS_KEY`

### 12.6 外部URL
`open_external`コマンドはHTTPSスキームのみ許可。

---

## 13. ログ・デバッグ

### 13.1 アプリケーションログ (`services/logger.rs`)
- **シングルトン** パターン
- **出力先:** `<userData>/logs/hotty-debug-<date>.log`
- **ローテーション:** 日次（午前0時切替）
- **保持期間:** 7日
- **フォーマット:** `[YYYY-MM-DD HH:MM:SS.mmm] [LEVEL] [CATEGORY] message | key=value`
- **レベル:** DEBUG, INFO, WARN, ERROR

### 13.2 セッションログ (`services/log_manager.rs`)
- **ファイル名:** `YYYYMMDDHHMMSS-PROTOCOL-HOST.txt` + `.tslog`（タイムスタンプ）
- **処理:** ANSIコード除去、CRLF→LF正規化
- **タイムスタンプ:** 各行の開始時刻を`.tslog`ファイルに並行記録

---

## 14. ビルド・配布

### 14.1 Tauri v2ビルド設定
**tauri.conf.json:**
- `productName`: "HoTTY"
- `identifier`: "com.hotty.terminal"
- `bundle.targets`: "nsis"（Windows）
- `bundle.icon`: アイコンファイルパス

**NSISインストーラー設定:**
- oneClick: false
- perMachine: false
- デスクトップショートカット作成
- スタートメニューショートカット作成

### 14.2 アップデートチェック
GitHub API (`https://api.github.com/repos/horryworks/HoTTY/releases/latest`) をポーリング。セマンティックバージョン比較で新バージョン検出。

---

## 15. 設定デフォルト値

### 15.1 全設定項目
| 設定 | デフォルト値 |
|---|---|
| globalEncoding | `"utf8"` |
| fontSize | `14` |
| fontFamily | `'Consolas, "Courier New", monospace'` |
| theme | `"dark"` |
| terminalForeground | `"#ffffff"` |
| terminalBackground | `"#1e1e1e"` |
| terminalBackgroundInactive | `"#121212"` |
| paneBackground | `"#000200"` |
| paneBackgroundMode | `"color"` |
| paneBackgroundImage | `""` |
| sshKeepAliveEnabled | `true` |
| sshKeepAliveInterval | `10` |
| telnetKeepAliveEnabled | `true` |
| telnetKeepAliveInterval | `30` |
| loggingEnabled | `false` |
| loggingPath | `""` |
| lineWrapEnabled | `true` |
| scrollback | `10000` |
| watchBufferLimit | `500000` |
| backspaceSendsDel | `false` |
| rightClickPaste | `true` |
| showSystemPrompt | `false` |
| enablePromptHighlight | `true` |
| promptHighlightColor | `"rgba(255, 255, 255, 0.15)"` |
| sidebarPosition | `"left"` |
| interactiveStabilizationTimeout | `10000` |
| activeAiProvider | `"vertexai"` |
| activePersonaId | `"network-expert"` |
| commandExecutionMode | `"ask-before-execute"` |
| maxConsecutiveAutoExecutions | `10` |
| customSafeCommands | `[]` |

### 15.2 デフォルトプロンプトパターン（8パターン）
| ID | 名前 | パターン |
|---|---|---|
| cisco | Cisco / Allied Telesis | `^([a-zA-Z0-9_\-\./]+(?:\([a-zA-Z0-9_\-\./]+\))?[>#])\s*` |
| fortigate | Fortigate | `^([a-zA-Z0-9_\-\.]+(?:\s\([a-zA-Z0-9_\-\.]+\))?[#$])\s*` |
| huawei | Huawei / Yamaha | `^((?:HRP_[AMSB])?[<\[][a-zA-Z0-9_\-\./]+[>\]])\s*` |
| juniper | Juniper | `^([-_\w]+@[-_\w]+[>#])\s*` |
| paloalto | Palo Alto / Arista | `^([-_\w.]+@[-_\w.]+[>#])\s*` |
| linux | Linux | `^([-_\w]+@[-_\w]+:[^$# ]*[$#])\s*` |
| cmd | Command Prompt | `^([A-Za-z]:.*>)\s*` |
| powershell | PowerShell | `^(PS\s+.*>)\s*` |

### 15.3 プロトコル/機能トグルデフォルト
**プロトコル:** 全て有効 (ssh, telnet, serial, wsl, cmd, powershell, git-bash)
**機能:** 全て有効 (ai-chat, log-viewer, ping-monitor, text-editor, file-explorer)

---

## 16. 定数・ユーティリティ

### 16.1 STORAGE_KEYS（localStorage キー）
```
UI_GRID_COL_SIZES(cols)    → hterm_ui_gridColSizes_{cols}
UI_GRID_ROW_SIZES(rows)    → hterm_ui_gridRowSizes_{rows}
THEME                      → hterm_theme
HOST_TREE                  → hterm_host_tree
HOST_HISTORY               → hterm_host_history
USERNAME_MAP               → hterm_username_map
GEMINI_CLIENT_ID           → hotty_gemini_client_id
GEMINI_CLIENT_SECRET       → hotty_gemini_client_secret
GEMINI_LANGUAGE            → hotty_gemini_language
AI_SELECTED_MODEL          → hotty_ai_selected_model
AI_SELECTED_MODEL_PER_PROVIDER(p) → hotty_ai_selected_model_{p}
VERTEXAI_PROJECT_ID        → hotty_vertexai_project_id
VERTEXAI_LOCATION          → hotty_vertexai_location
VERTEXAI_AUTH_TYPE         → hotty_vertexai_auth_type
VERTEXAI_KEY_FILE_PATH     → hotty_vertexai_key_file_path
VERTEXAI_SELECTED_REGION   → hotty_vertexai_selected_region
PING_MONITOR_STATE         → hotty_ping_monitor_state
FILE_EXPLORER_STATE        → hotty_file_explorer_state
TEXT_EDITOR_STATE           → hotty_text_editor_state
AI_EXPLICIT_LOGOUT         → hotty_ai_explicit_logout
SKIPPED_UPDATE_VERSION     → hotty_skipped_update_version
NEVER_NOTIFY_UPDATE        → hotty_never_notify_update
SYSTEM_FONTS_CACHE         → hotty_system_fonts_cache
```

### 16.2 ターミナルシーケンス
```
LINE_WRAP_ENABLED  = '\x1b[?7h'
LINE_WRAP_DISABLED = '\x1b[?7l'
```

### 16.3 ANSIユーティリティ (`ansiUtils.ts`)
`stripAnsiCodes(data)`:
1. OSCシーケンス除去（ウィンドウタイトル）
2. CSIエスケープシーケンス除去
3. CRLF/CR → LF正規化

### 16.4 HTMLユーティリティ (`htmlUtils.ts`)
`sanitizeHtml(html)`:
- DOMPurify使用
- 禁止タグ: style, form, input, meta
- 禁止属性: style

### 16.5 Zustand persistミドルウェア設定
- settingsStore: バージョン3（v0→v1→v2→v3マイグレーション）
- paneStore: バージョンなし
- sidebarLayoutStore: バージョンなし

---

## 補足: 実装優先順位の推奨

### Phase 1: コア基盤
1. Tauri コマンド登録・tauriService.ts基盤
2. Terminal コンポーネント + xtermインスタンス管理
3. Local Shell (cmd/PowerShell) 接続
4. GridLayout + TabBar + PaneContent
5. settingsStore + paneStore + sidebarLayoutStore

### Phase 2: プロトコル
6. SSH接続（基本認証）
7. WSL接続
8. Telnet接続
9. Serial接続
10. ジャンプボックス + IAPトンネル

### Phase 3: AI統合
11. AIプロバイダー基盤（trait + registry）
12. OpenAI/Anthropicプロバイダー（APIキー認証で簡単）
13. Geminiプロバイダー
14. Vertex AIプロバイダー
15. AIChatPane + useAiChat
16. useInteractiveFlow

### Phase 4: 統合ツール
17. TextEditorPane
18. FileExplorerPane
19. LogViewerPane
20. PingMonitorPane

### Phase 5: 管理機能
21. SessionDialog + HostTree + useHostManager
22. SettingsModal（5タブ）
23. CustomThemeCreator
24. DPAPI暗号化
25. htreeエクスポート/インポート

### Phase 6: 仕上げ
26. HelpModal
27. UpdateNotification
28. ContextMenu
29. テスト（Vitest + cargo test）
30. ビルド・インストーラー
