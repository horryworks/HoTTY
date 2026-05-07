# Release Notes

## v2.0.0-beta12

A hardening pass before the stable release. Modernised SSH algorithm defaults, a stream-idle watchdog for AI Chat, fixes for several quiet data-integrity bugs (host tree, AI chat history, persona settings), and a sweep of UX polish around modals, focus, and validation.

### New Features

- **AI Chat tab → linked terminal flash** — clicking an AI Chat tab whose conversation is linked to a terminal session briefly highlights that terminal pane so you can tell at a glance which session it belongs to.
- **AI stream idle watchdog** — if an AI provider stops sending data mid-response (network drop, hung backend, etc.), the in-flight request is cancelled after 3 minutes of silence and the chat shows an error instead of staying stuck on "streaming".
- **`diffie-hellman-group-exchange-sha1` confirmation prompt** — enabling this deprecated KEX in **Settings → Protocols → SSH Algorithms** now shows a warning dialog explaining that SHA-1 is broken and offering safer alternatives.
- **OS-locale-aware AI Chat language** — first-run users on Japanese-locale machines now see the AI Chat language set to 日本語 by default instead of English. Existing users keep whatever they had selected.
- **SessionDialog input validation** — the connection form now catches empty hosts, ports outside 1–65535, malformed GCP project IDs, and CRLF/whitespace injection before the connect is attempted.

### Improvements

- **Modern SSH KEX defaults** — `diffie-hellman-group14-sha256` ships enabled and `diffie-hellman-group1-sha1` ships disabled in the bundled algorithm list. Existing users keep their saved choices; algorithms newly added in a release are merged into the user's saved file on load so security improvements aren't blocked behind a manual reset.
- **Jumpbox host-key prompt now times out** — leaving the bastion's host-key prompt unanswered used to hang the whole connect indefinitely. The prompt now disconnects after 5 minutes if no response.
- **Modal Escape stack** — pressing Escape with multiple modals open now only closes the topmost one. Previously every mounted modal's listener fired in parallel and could close background dialogs you didn't see.
- **Focus is restored after a modal closes** — closing a modal returns focus to whatever element had it before the modal opened (input field, terminal, button) instead of leaving focus stranded on a removed button.
- **Multi-byte prompt detection** — terminal text is now NFC-normalised before matching against your prompt-pattern regex, so prompts containing combining marks or full-width characters (Japanese, accented Latin) are detected consistently regardless of how the device sent them.
- **Surfaced silent failures** — clipboard copy and session-logging toggle failures now show as toast notifications instead of being swallowed, and AI Chat surfaces invoke errors that previously left the UI stuck in a "streaming" state.
- **Faster failure on unreachable AI providers** — AI HTTP requests now have a 30-second connect timeout so misconfigured endpoints fail quickly rather than hanging the chat.

### Bug Fixes

- **Session disconnect was leaking background tasks.** SSH/Serial/WSL/Local sessions used `tokio::time::timeout` on the reader/writer/keepalive task handles, but timing out only dropped the JoinHandle (detached the task) instead of aborting it. Long-lived runs slowly accumulated zombie tasks. The grace period is now 1.5 seconds and overruns are explicitly aborted.
- **AI Chat could break after cancelling a response.** Cancelling a stream left the user message in chat history without an assistant reply, violating the user/assistant alternation Anthropic requires. The next request would be rejected by the API. Cancelled turns now record an `[cancelled]` placeholder so subsequent messages send cleanly.
- **`aiCommandIdleTimeoutSecs`, custom AI personas, and other settings could be wiped on upgrade.** The settings migration unconditionally overwrote `aiPersonas` with the bundled defaults at version bumps. Customised prompts and user-added personas are now preserved across upgrades; use **Reset All Personas** in Settings to pull in the latest stock prompts on demand.
- **Update notifier got the order of `beta9` vs `beta10` wrong.** Lexicographic string compare ranked `beta10 < beta9`, so users on `beta10` could be told a `beta9` was newer (or no update was offered). Pre-release tags are now compared numerically when they share the same alphabetic prefix.
- **Host tree edits could be lost under rapid edits.** Encryption is asynchronous, and two quick edits could complete out of order — the older encryption result would overwrite the newer one in `localStorage`. Writes are now guarded by a monotonic counter so only the most recent encryption is persisted.
- **Session status briefly flickered through duplicate error transitions.** Both the connect-promise catch block and the `onSessionError` listener pushed a state update + log entry for the same failure. The redundant path is now suppressed.
- **Re-opening Settings could show a stale "enable SHA-1?" warning dialog.** If the user closed the Settings modal while the confirmation prompt was up, the pending state survived and the dialog reappeared on the next open. The state now resets on tab unmount.
- **Closing an AI Chat pane before its linked terminal leaked watch buffers.** The buffer for the linked session lingered until the session itself was removed. Session removal now always evicts its buffer regardless of which pane was watching.

### Security

- **Text Editor refuses to approve dropped symlinks.** Dragging a file into the Text Editor now rejects symbolic links directly so a user can't be tricked into approving a link that resolves to a sensitive location.
- **`known_hosts` write failures are now visible to the user.** When SSH cannot save or remove an entry (permission denied, disk full, etc.) the failure is logged and an `ssh-known-hosts-warning` event is emitted so you find out at the time, not on the next connection where the host key prompt reappears unexpectedly.
- **DPAPI passthrough now warns on suspicious input.** When the credential decryptor falls back to plaintext passthrough on input that *looks* prefixed (starts with `[` but with an unknown tag), it now logs a warning so accidental corruption of the encryption tag is visible in logs.

## v2.0.0-beta11

A correctness and security release. The SSH algorithm preferences in Settings now actually drive the handshake (they were previously cosmetic), unblocking legacy devices that need SHA-1 KEX, 3DES, or DSA host keys, and the jumpbox SSH path picks up the same `known_hosts` I/O hardening already applied to the direct path.

### Bug Fixes

- **SSH algorithm preferences from Settings now apply to connections.** Previously the kex / cipher / MAC / host-key toggles in **Settings &rarr; Protocols &rarr; SSH Algorithms** were saved but never read by the SSH client — every session offered russh's hardcoded default list regardless of what was selected in the UI. They now drive the handshake for both direct SSH and jumpbox connections. This unblocks legacy devices (e.g. Cisco Catalyst 3650, older Cisco IOS) that require SHA-1 KEX (`diffie-hellman-group14-sha1`, `diffie-hellman-group1-sha1`, `diffie-hellman-group-exchange-sha1`), `3des-cbc`, or `ssh-dss` host keys — these are now selectable and effective.
- Disabling every algorithm in a category now fails the connection with a clear error rather than silently falling back to library defaults. Unknown algorithm names in the saved config log a warning and are skipped instead of being silently ignored.

### Security

- **Jumpbox known_hosts I/O errors now refuse the connection** instead of treating the host as new. Matches the existing hardening on the direct SSH path; prevents an attacker who can corrupt or chmod-zero the bastion's `known_hosts` from coaxing the user back into a "new host" prompt and accepting an attacker-controlled key.

## v2.0.0-beta10

A major AI Chat UX overhaul: per-pane tabs with smart linking to terminal sessions, an inline execution mode bar with pause/resume, a new device-response idle timeout, and a tightened Network Expert persona prompt.

### New Features

- **AI Chat tabs** — AI Chat panes now host multiple tabs in a top-of-pane tab strip. Toggling **AI Monitor** on a terminal links a tab to that session; turning it on for additional terminals creates a new tab per terminal so concurrent watch streams stay separated. Selecting a terminal mirrors the active AI tab back to the matching link, and the currently linked terminal is shown as a chip next to the input. Use **+ New chat** to start a fresh tab.
- **Inline execution mode bar with pause/resume** — the AI Chat pane now has an Execution Mode chip docked at the bottom of the input card with a dedicated pause/resume control for the auto-run loop. The same controls used to live behind a Settings dialog.
- **AI command idle timeout** — new `aiCommandIdleTimeoutSecs` setting (default 10 seconds, `0` disables, 30-minute hard cap) replaces the previous silent 30-second wall-clock timeout in the AI execute polling loop. When the timeout fires, the captured output and a `[no response from device for N seconds]` note are sent to the AI so the conversation continues instead of stalling.

### Improvements

- **AI Chat UX redesign** — chip-style mode picker, linked-terminal chip, empty-state onboarding, send-disabled hints, and live streaming-token feedback.
- **Unified AI Chat input** — input, attachments, and the execution-mode chip are now part of a single rounded card with the chip right-aligned for a cleaner footprint.
- **AI Chat header settings popover** — settings previously scattered across the AI Chat header are consolidated into a popover triggered from the input toolbar; the standalone System Prompt button is removed and now lives inside the popover.
- **Collapsible terminal output blocks** — terminal output captured into AI Chat messages renders as a collapsible block with the first command line, line count, and character count visible in the header. Click or press <kbd>Enter</kbd>/<kbd>Space</kbd> to expand.
- **Network Expert persona prompt** — rewritten with a leading mandatory start-of-session protocol (REPLY 1: show-version equivalent, REPLY 2: terminal-length-0 equivalent, REPLY 3+: address user) so paginated devices no longer stall the AI response loop.
- **SSH/Telnet connect timeout default** — bumped from 3 seconds to 5 seconds, more forgiving to slower jumpbox / IAP-tunnel paths.

### Bug Fixes

- **AI Chat target chip stuck** — the linked-terminal chip now clears when its session is removed or **AI Monitor** is turned off, instead of staying displayed against a non-existent session.
- **AI execute output truncation** — fixed a path where long terminal output captured for the AI execute loop was truncated before reaching the model.

## v2.0.0-beta9

Automatic v1→v2 host-tree credential migration, paste-flow fixes, and security hardening around the asset protocol and SSH known-hosts handling.

### Improvements

- **Automatic v1→v2 host-tree credential migration** — host trees imported or carried over from the previous Electron build of HoTTY (v1) used `[SAFE]` + base64(`v10` + DPAPI blob) for `username` / `password`. On first load, those entries are now upgraded in place to the v2 format (`[SAFE]` + base64(DPAPI blob)). The migration runs in the Rust backend, is idempotent (v2 entries pass through byte-for-byte), and plaintext credentials never cross the IPC boundary.

### Bug Fixes

- **Ctrl+V pasted clipboard content twice** — pressing Ctrl+V used to insert the clipboard content once before the paste-confirmation dialog opened, and again when the user clicked "Paste". xterm.js's internal `paste` DOM listener was firing independently of our keydown interceptor. The terminal host now suppresses the native paste event so the confirmation dialog is the sole paste path. Right-click paste was unaffected.
- **Terminal lost focus after the paste-confirmation dialog closed** — confirming or cancelling the paste dialog left focus stranded on the (now-removed) Paste button, requiring an extra click before the keyboard worked again. Focus is now restored to the originating terminal pane after the dialog unmounts.

### Security

- **Tighter Tauri asset protocol scope** — the `assetProtocol.scope` in `tauri.conf.json` was widened to `**` (any path) earlier in the v2 line. It is now restricted to image extensions only (`.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.svg`). The pane-background-image feature continues to work; defense-in-depth against renderer compromise.
- **SSH refuses connection on known_hosts I/O errors** — previously, *any* error reading `known_hosts` (permission denied, disk failure, partial read) was silently treated as "this is a new host" and the user was re-prompted. An attacker who could corrupt or chmod-zero the file could exploit this to coax the user into accepting a substituted host key for an already-trusted host. Real I/O errors now log and refuse the connection; "file not found" still correctly returns the new-host prompt for first-time users.

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
- **Terminal viewport could rewind on output** — in the three-rail layout introduced in this release, fast terminal output (e.g. `dir` listings) could leave the viewport one line behind, hiding the latest prompt until the next keypress forced a re-scroll. The custom scrollbar rail now updates its spacer geometry synchronously with terminal scroll events, so the viewport stays aligned with the newest output.

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
