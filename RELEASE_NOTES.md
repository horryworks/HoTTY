# Release Notes

## v2.0.0-beta8

Connection lifecycle UI, horizontal scrolling for unwrapped lines, and a rebuilt terminal layout that keeps the marker and scrollbar pinned to the right edge.

### New Features

- **Connection lifecycle overlay** — sessions now show a Connecting overlay while the transport is being established, and surface failures via dismissible toast notifications instead of failing silently. Session status gains explicit `connecting` and `error` values, with dedicated theme colors for the tab and pane border.
- **Configurable connect timeout** — SSH and Telnet connections now time out after a user-configurable interval (default 3s) instead of hanging indefinitely.
- **Horizontal scrolling when Line Wrap is off** — disabling Line Wrap re-enables a horizontal scrollbar on terminal panes that grows as the cursor advances past the right edge. Pressing Enter snaps the scroll back to column 0, and the host auto-scrolls to keep the cursor in view as you type.

### Improvements

- **Three-rail terminal layout** — the prompt marker indicator and the vertical scrollbar are now rendered in dedicated DOM rails outside the xterm host. They stay anchored to the pane's right edge regardless of the host's horizontal scroll position, so scrollbar, marker, and text never overlap.
- **Custom vertical scrollbar in terminals** — replaces xterm v6's default Monaco-style scrollbar with one that matches the rest of the app's chrome (driven by the global scrollbar styles).
- **Connecting-state theme colors** — added matching defaults across Dark, Medium, and Light themes for the new connecting tab/pane state.

### Bug Fixes

- **Prompt marker color** — prompts now correctly use the prompt-default theme color (red), with the prompt-active color (blue) reserved for non-prompt content.
- **Prompt marker detection** — replaced a stale buffer-position reference that caused intermittent detection misses, and trailing unused rows no longer carry markers.
- **Prompt marker positioning** — markers are now anchored to the right edge directly, so positioning no longer drifts with the parent's left edge or horizontal scroll. Includes a CSS fallback for overlay scrollbars and a content-based check that survives cursor transitions during startup.
- **Scrollbar corner artifacts** — hides the bottom-right scrollbar corner / resizer / button artifacts that previously appeared in some panes.

## v2.0.0-beta7

Safer in-place upgrades, a dependency security update, and modal stacking fixes.

### Bug Fixes

- **Installer no longer defaults to "Uninstall before installing" on upgrade** — when the installer detects an existing HoTTY installation, the **"Don't uninstall (keep settings)"** radio is now pre-selected and focused for upgrade and downgrade scenarios. Previously the destructive "Uninstall" option was the default, and clicking through could wipe the HostTree and AI provider credentials stored in WebView2 local storage. Same-version reinstall behavior is unchanged.
- **Help modal z-index** — corrected from `10001` to `10000` so it follows the base-modal convention; the previous value risked layering above unrelated nested overlays.
- **Save-confirm modal z-index** — corrected from `10001` to `10000` for the same reason; this dialog is never shown over another modal.

### Security

- **DOMPurify upgraded to 3.4.0** — addresses [GHSA-39q2-94rc-95cp](https://github.com/advisories/GHSA-39q2-94rc-95cp), where `ADD_TAGS` short-circuit evaluation could bypass `FORBID_TAGS`. AI-rendered markdown is sanitized through DOMPurify, so this hardens that surface.

## v2.0.0-beta6

Sixth beta release, focused on UI polish, futuristic theming effects, customizable empty-pane backgrounds, and continued security hardening.

### New Features

- **Unused pane background** — in **Settings → Appearance**, choose a solid color or custom image to display in empty grid panes
- **Futuristic theme effects** — new **Futuristic Effects** section in the Custom Theme Creator: neon glow on active panes and sidebar icons, glassmorphism backdrop blur on modals, and configurable icon stroke width / glow blur
- **File Explorer sidebar preference** — File Explorer now opens into an empty sidebar slot by default (new `preferSidebar` pane allocation strategy) instead of filling a grid cell
- **Empty pane drop hints** — empty grid cells display their pane number and a "Drop Tab Here" hint to guide tab placement

### Improvements

- **Settings UI redesign** — Appearance, Features, General, and Protocols tabs reorganized into grouped "cards" with section titles (Layout, Theme, Font, Terminal Display) for easier scanning
- **Theme refresh** — brighter `accent-color` (`#00b4ff` in dark) plus new `prompt-highlight-default`, `glow-*`, and `glass-*` theme variables across Dark, Light, and Medium themes
- **Lighter-weight icons** — SVG stroke width reduced from `2` to `1.5` across AI Chat, File Explorer, Log Viewer, Ping Monitor, Help, App Sidebar, Tab Bar, and Sidebar for a more refined look
- **Backdrop blur on modals** — subtle 6px blur behind all modal overlays
- **Prompt highlight default tracks theme** — when unset, the terminal prompt highlight color falls back to `--prompt-highlight-default` so it follows the current theme
- **Ask AI modal styling** — restored primary-button background, padding, and hover state that had regressed
- **Dependency cleanup** — removed unused `@tauri-apps/plugin-shell` npm dependency

### Bug Fixes

- **v1 htree import no longer corrupts credentials** — fixed field-mapping bug where imported usernames and passwords from legacy v1 host trees were mangled
- **About tab GitHub link** corrected and repository URL updated to `horryworks/HoTTY-Rust-Tauri`
- **Duplicate session race** — `connect_session` now re-checks for duplicate session IDs after connect completes and safely disconnects the new service on collision

### Security

- **Text Editor TOCTOU hardening** — `text_editor_read_file` / `write_file` re-validate the resolved path and file size at I/O time, guarding against symlink swaps after the dialog approval
- **Log Viewer TOCTOU fix** — `read_log_file` reads from the re-canonicalized path rather than the originally resolved path
- **HTML sanitizer tightened** — DOMPurify now forbids `svg`, `iframe`, `object`, `embed`, `script`, `link`, `base` tags and a broad set of `on*` event-handler attributes in AI-rendered markdown
- **WSL distribution name validation** — rejects shell metacharacters (`$`, backtick, `;`, `&`, `|`, redirects, quotes, whitespace) before the regex check as defense-in-depth
- **GCP IAP tunnel argv hardening** — gcloud invocations pass arguments as an argv array on Windows (`cmd /C gcloud.cmd <args>`) instead of a manually-escaped shell string, eliminating quoting-based injection risk
- **Asset protocol scoping** — enabled Tauri `protocol-asset` with an explicit CSP `img-src` allowance for `http://asset.localhost` so user-selected pane background images can be served safely

## v2.0.0-beta5

Fifth beta release, focused on security hardening, themeable AI provider branding, and UI polish.

### Improvements

- **Themeable AI provider icons** — the Gemini gradient, OpenAI, Anthropic, and Vertex AI icon colors are now driven by theme variables (`provider-gemini-1/2/3`, `provider-openai`, `provider-anthropic`, `provider-vertex-ai`) and exposed as a new **AI Providers** section in the Custom Theme Creator
- **Shell plugin replaced with opener** — migrated from `tauri-plugin-shell` to the lighter-weight `tauri-plugin-opener` for external URL handling, reducing the allowed capability surface
- **AI provider streaming cleanup** — Anthropic, Gemini, OpenAI, and Vertex AI providers now emit the chat-done event on cancellation/empty responses, avoiding orphaned loading states
- **Modal consistency** — standardized action-button padding (`6px 16px`) and footer gap (`8px`) across ConfirmModal, PasteConfirmationModal, and AskAiModal per the UI conventions

### Security

- **SSH credential zeroization on auth failure** — passwords and key passphrases are now wiped from memory immediately after the authentication attempt, whether it succeeds or fails, closing a window where plaintext secrets could linger on failed login
- **IAP tunnel zone filter hardening** — GCE instance listing now passes the zone via the dedicated `--zones=` flag rather than a `--filter=zone:(…)` expression, eliminating exposure to gcloud filter-syntax edge cases
- **DPAPI unsafe-block documentation** — added explicit SAFETY invariants to both `CryptProtectData` / `CryptUnprotectData` call sites covering buffer initialization, lifetime, and `LocalFree` ownership

## v2.0.0-beta4

Fourth beta release, focused on jumpbox tunneling, auto-update notifications, safer editing workflows, and security hardening.

### New Features

- **SSH/Telnet Jumpbox (bastion) tunneling** — connect through an SSH bastion host to a target SSH or Telnet server via `direct-tcpip` channel forwarding, with its own host-key verification and keyboard-interactive auth
- **Auto-update notification** — on startup, checks the GitHub releases API for a newer version and shows a dismissible notification linking to the release page
- **Unsaved changes prompt** — Text Editor now shows a Save / Discard / Cancel modal when closing a tab or quitting with unsaved edits, backed by a dirty-editor tracker shared across panes
- **AI System Prompt viewer** — inspect the effective system instruction sent to the current AI persona, with copy-to-clipboard support
- **React Error Boundary** — top-level error boundary catches renderer crashes and shows a recoverable fallback instead of a blank window

### Improvements

- **Telnet service** — refactored connection path to share the jumbox tunnel abstraction with SSH, unifying transport handling
- **tauriService** — added typed wrappers for the new updater and jumpbox commands
- **useResize hook** — small ergonomics improvements for pane drag-to-resize
- **App shell** — composed UpdateNotification, SaveConfirmModal, SystemPromptModal, and ErrorBoundary into the top-level layout

### Security

- **SSH credential validation** — added length caps (host, username, password, passphrase) in `SshConfig::validate` to reject malformed or oversized inputs before they reach the SSH stack
- **Log viewer TOCTOU mitigation** — re-canonicalizes the resolved path immediately before reading and re-checks the allowed-directory guard, preventing symlink swap attacks between the check and the read
- **Font enumeration unsafe hardening** — added null-pointer and alignment validation in the Windows font-enumeration callback before dereferencing OS-supplied pointers

### Housekeeping

- **Removed unused asset** — deleted `public/HoTTY_logo.png` (not referenced by the app)
- **Added tests** — new unit tests for the dirty-editor tracker utility

## v2.0.0-beta3

Third beta release, focused on theme customization, UI refinements, and expanded test coverage.

### New Features

- **Custom Theme Creator** — in-app editor to create user-defined themes by adjusting any CSS variable, with save/edit/delete support from the Appearance tab
- **Help Tooltip component** — contextual help hints embedded next to settings and controls
- **Versioned window title** — main window title now includes the current application version

### Improvements

- **Settings modal** — refined styling across all tabs (Appearance, General, Features, Protocols, AI, About) for visual consistency
- **Settings store** — extended with additional feature toggles and configuration options
- **Sidebar icon spacing** — tightened and balanced icon layout in the app sidebar
- **Removed deprecated ConnectForm** — fully superseded by the Session Dialog; legacy component and styles deleted
- **Expanded test coverage** — added tests for AI chat panels, Ask AI modal, authentication panels, theme utilities, and color/HTML helpers
- **Help modal** — documentation updated to cover the new Custom Theme Creator workflow

### Bug Fixes

- **Modal CSS consistency** — unified padding, border-radius, and animation timing across PasteConfirmationModal, SettingsModal, and HelpModal
- **Pane toolbar consistency** — aligned TextEditorPane and PingMonitorPane toolbars with the standard 36px toolbar spec

## v2.0.0-beta2

Second beta release with AI integration, connection management UI, and enhanced utility panes.

### New Features

- **AI Chat pane** — multi-provider AI chat with streaming responses, personas, and token cost tracking
- **AI providers** — support for Google AI Studio (Gemini), Vertex AI, Anthropic (Claude), and OpenAI (GPT) with provider-specific authentication
- **AI backend services** — Rust-based AI provider infrastructure with SSE streaming support
- **Ask AI modal** — right-click terminal text to query AI with built-in or custom commands
- **AI Settings tab** — configure AI provider, model, personas, Ask AI commands, command execution mode, and monitor buffer limits
- **AI Interactive Mode** — AI can suggest and execute terminal commands with safety classification (safe/destructive/unknown)
- **AI Watch Mode** — monitor terminal output and send captured logs to AI for analysis
- **Host Tree** — connection management UI with folders, drag-and-drop reordering, and host tree export/import
- **Session Dialog** — connection dialog for creating and editing SSH, Telnet, Serial, WSL, Local, and Git Bash sessions with jumpbox and IAP tunnel support
- **Help modal** — comprehensive in-app documentation covering all features, shortcuts, and AI setup guides
- **Confirm modal** — reusable confirmation dialog for destructive actions
- **Command classifier** — categorizes terminal commands as safe, destructive, or unknown for AI auto-execution decisions
- **AI token pricing** — per-model pricing data for cost estimation across all supported providers

### Improvements

- **Text Editor** — major enhancement with find & replace, go-to-line, sub-tabs for multiple files, encoding/line-ending selection, line wrap, return code visualization, and file association support
- **File Explorer** — improved navigation with breadcrumb path, hidden file toggle, drive browsing, and double-click to open in editor
- **Ping Monitor** — enhanced with configurable intervals, log output, and improved layout
- **Log Viewer** — improved with search/filter, regex toggle, and better file browsing
- **Tab Bar** — updated with feature pane tab support and improved drag-and-drop
- **Settings store** — extended with AI settings, enabled features, and additional configuration options
- **Session manager** — updated to support AI chat terminal integration
- **App icons** — refreshed application icons across all platforms (Windows, macOS, iOS, Android)
- **New utility hooks** — useFocusTrap, useModalState, useResize for improved UI interactions
- **ANSI utilities** — added ANSI code processing functions for terminal output handling
- **Color and HTML utilities** — added helper functions for color manipulation and HTML processing

## v2.0.0-beta1

First functional beta of the Rust/Tauri rewrite. This release replaces the Electron-based HoTTY with a Tauri v2 backend for improved memory efficiency and performance.

### New Features

- **Multi-protocol connections** — SSH, Telnet, Serial, WSL, and local shell (cmd, PowerShell, Git Bash)
- **SSH host key verification** — fingerprint display with accept/reject prompt for new and changed host keys
- **SSH private key authentication** — support for key file and passphrase
- **SSH algorithm configuration** — configurable KEX, cipher, MAC, and host key algorithms
- **Serial port support** — configurable baud rate, data bits, parity, stop bits, and flow control
- **WSL distribution selection** — connect to any installed WSL distribution
- **Multi-pane layout** — grid layouts (1x1, 1x2, 2x1, 2x2, 2x3, 3x2) with collapsible sidebars on all four edges
- **Tab bar** — drag-and-drop reordering, session and feature pane tabs
- **Log Viewer pane** — browse and read session log files
- **Text Editor pane** — open, edit, and save files with line ending detection
- **File Explorer pane** — browse directories and drives, open files in the text editor
- **Ping Monitor pane** — monitor multiple targets with configurable intervals and log output
- **Theming** — built-in Dark, Medium, and Light themes with custom theme support
- **Settings modal** — tabbed interface with Appearance, General, Features, Protocols, and About sections
- **Windows DPAPI encryption** — secure credential storage for saved connections
- **Paste confirmation** — modal to review clipboard content before pasting into terminal
- **Session logging** — per-session log output to file
- **Host tree export/import** — encrypted .htree format for connection configuration backup
- **GCE IAP tunnel** — connect to Google Cloud instances via Identity-Aware Proxy
- **Encoding support** — UTF-8, Shift_JIS, and EUC-JP per session
- **Keepalive** — configurable keepalive interval for SSH and Telnet connections
- **System font detection** — list and select installed system fonts for terminal rendering
- **Context menu** — right-click context menu support
- **Debug log management** — view and open debug log folder

### Improvements

- **Rust/Tauri v2 backend** — complete rewrite from Electron for lower memory usage and faster startup
- **Zustand state management** — persistent settings via Zustand with localStorage middleware
- **Typed IPC layer** — all Tauri commands wrapped in tauriService.ts with full TypeScript types
- **Comprehensive test coverage** — Vitest tests for all frontend components, hooks, and services

## v0.1.1

Scaffold-only version bump. No functional changes.

## v0.1.0

- Initial Tauri v2 project scaffold with migration spec.
