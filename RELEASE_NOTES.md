# Release Notes - HoTTY

## [v1.0.9-beta3] - 2026-04-15

### Bug Fixes
- **Host Tree Export Portability**: Fixed `.htree` files produced by the export feature being unusable on other machines (or after reinstall). Credentials in exported files were doubly-wrapped — the inner `safeStorage` layer was bound to the original machine's Windows DPAPI key, so usernames and passwords decrypted back into the literal ciphertext string (`[SAFE]...`) on import. The export now decrypts credentials to plaintext inside the file before applying the user-supplied password's AES-256-GCM container, making `.htree` files portable while remaining encrypted at rest. Importing a pre-fix `.htree` file on a different machine now safely clears the unrecoverable credential fields and shows a notice prompting re-entry instead of storing garbage values.

## [v1.0.9-beta2] - 2026-04-11

### Improved
- **Simplified AI Settings**: Removed the "Proactive Investigation Instruction" textarea from Settings → AI. The proactive command suggestion behavior is now built-in and always active, reducing configuration complexity without changing functionality.
- **Multi-Line Command Safety Classifier**: The auto-execution command classifier now evaluates multi-line execute blocks line-by-line. If any individual line is unsafe, the entire block requires manual confirmation. Previously, multi-line blocks were treated as a single command string.
- **Credential Decryption Performance**: Migrated credential encryption from PowerShell-based DPAPI to Electron's built-in `safeStorage` API. This eliminates the ~300-500ms PowerShell process spawn overhead per operation, making host selection and connection in the Session Dialog near-instant. Existing credentials are automatically migrated on first launch.

---

## [v1.0.8] - 2026-04-11

### Bug Fixes
- **SSH Crash on Unsupported Algorithm**: Fixed a crash when connecting to SSH servers where the configured algorithm list included ChaCha20-Poly1305 or other ciphers not supported by the runtime's OpenSSL/BoringSSL build. Algorithm lists are now validated against the ssh2 library's runtime-supported algorithms before connecting, silently filtering out unavailable ones. Also added error handling around `conn.connect()` to prevent unhandled promise rejections.

### Improved
- **Pane Toolbar Consistency**: Aligned TextEditorPane toolbar dimensions (`min-height`, `padding`) with LogViewerPane and PingMonitorPane for a consistent look across all pane toolbars.

---

## [v1.0.7] - 2026-04-09

### Improved
- **Expanded SSH Algorithm Support**: Added ChaCha20-Poly1305 cipher, Diffie-Hellman Groups 14-sha256, 15–18-sha512, ETM (Encrypt-then-MAC) HMAC variants (hmac-sha2-256-etm, hmac-sha2-512-etm, hmac-sha1-etm), and legacy algorithms (Arcfour, Blowfish-CBC, CAST128-CBC, HMAC-MD5, HMAC-RIPEMD160, truncated HMAC variants). This significantly improves compatibility with both modern and legacy SSH servers.
- **DPAPI Batch Credential Operations**: Credential encryption and decryption for batch operations (e.g., host tree export/import) now use a single PowerShell invocation instead of spawning one process per credential, significantly reducing processing time for large host trees.
- **Modal Padding Consistency**: Standardized padding in PasteConfirmationModal's warning and preview sections to match the modal convention used across all other modals.

---

## [v1.0.6] - 2026-04-08

### Improved
- **SSH Algorithm Mismatch Diagnostics**: When an SSH connection fails due to a "no matching" algorithm error, the error message now includes the server-offered algorithms (e.g., "Their offer: diffie-hellman-group14-sha1, ..."), making it much easier to identify which algorithms to enable without needing external tools like Wireshark.
- **Modal Body Padding Consistency**: Unified modal body padding across AskAiModal, ConfirmModal, MessageModal, and SaveConfirmModal to a consistent `15px 20px` layout.

### Bug Fixes
- **Telnet Auto-Login for Cisco ASA**: Fixed auto-login failing on devices that use "Username:" prompt instead of "login:". Also fixed the login password being incorrectly auto-typed at the `enable` password prompt. Replaced the telnet-client library's built-in login handler with a custom state machine that supports both prompt styles and stops auto-input after login completes.

---

## [v1.0.5] - 2026-04-07

### New Features
- **AI Command Auto-Execution**: AI-suggested read-only commands (ls, cat, show, ping, etc.) can now be executed automatically when auto-execute mode is enabled. A command safety classifier using a whitelist + danger-pattern approach ensures only safe commands run without confirmation. Toggle with the lightning bolt button in the AI Chat header, or configure in Settings → AI → Command Execution Mode.
- **Custom Safe Command Whitelist**: Add your own commands to the auto-execute whitelist in Settings → AI. Built-in safe commands include common Unix utilities, network diagnostics, and network device CLI commands (Cisco show, Huawei display, etc.).
- **Consecutive Execution Limit**: Set a maximum number of consecutive auto-executions (default: 10, 0 = unlimited). After the limit is reached, commands require manual confirmation until you click Run.

### Improved
- **Inline Help Tooltips**: Replaced paragraph-style help text across all Settings tabs and the Session Dialog with compact hover tooltips (HelpTooltip component), reducing visual clutter while keeping descriptions accessible.
- **Settings UX Overhaul**: Reorganized the General tab into clear sections (Storage, Input, Diagnostics) with descriptive headers. Renamed settings for clarity: "Watch Buffer Limit" → "AI Monitor Buffer Limit", "Interactive Flow Stabilization Timeout" → "Command Output Wait Time", "Local Log Buffer" → "Terminal Scrollback Buffer", "Empty Pane Background" → "Unused Pane Background". Improved AI settings descriptions throughout.
- **Session Dialog Help Text**: Added inline help descriptions for Google Cloud IAP, Jumpbox (Bastion), Serial port, and Flow Control settings. Renamed "Jumpbox" label to "Jumpbox (Bastion)" for clarity.
- **SSH Algorithms Collapsible**: The SSH Algorithms section in the Protocols tab is now collapsible, reducing visual clutter when not needed.
- **Terminal Constructor Settings**: New terminal instances now read font family, font size, and theme colors from the settings store instead of relying on hardcoded defaults.
- **Drag-and-Drop Visual Feedback**: The Ask AI command list now shows an accent-colored border highlight on the drop target while dragging.
- **Update Notification Theme Variables**: Added 8 new `update-notification-*` theme variables for full customization of the update notification banner appearance.
- **Icon Format**: Updated favicon and Electron window icon from PNG to ICO format for better Windows compatibility.
- **UI Consistency**: Standardized disabled button cursor to `not-allowed` across all pane toolbars (LogViewer, PingMonitor, TextEditor), normalized modal overlay positioning and footer button styles (AskAiModal, CustomThemeCreator, PasteConfirmationModal), and replaced hardcoded colors with theme variables in the loading fallback and FileExplorerPane.
- **Dead Code Cleanup**: Removed 43 unused localStorage keys, unused `hexToRgba` utility, `aiListProviders` IPC handler, and un-exported internal-only symbols across multiple modules.

### Bug Fixes
- **IAP Tunnel Zone Filter**: Fixed the gcloud zone filter syntax from `--filter=zone:${zone}` to `--filter=zone:(${zone})`, which could cause instance lookup failures.
- **IAP Tunnel Path Quoting**: Simplified gcloud path handling by removing fragile manual quoting that could break paths with special characters.
- **Drag-and-Drop Flickering**: Fixed the Ask AI command drag-and-drop highlight flickering when dragging over child elements, caused by `onDragLeave` firing on child element boundaries.
- **CSS Fallback Color Mismatch**: Fixed gradient fallback colors in TabBar and border fallback color in LayoutSelector to match the actual dark theme values.

### Security
- **IPC Input Validation**: Added type checking and size limits to IPC handlers: `term-input` (string validation), `term-resize` (integer range clamping 1–1000 cols, 1–500 rows), `write-clipboard` (10 MB limit), `ai-chat-send` (string validation + 1 MB message limit), and `export-htree` (password length + data array size validation).
- **File Editor Path Blocking**: Extended the text editor's blocked directory list to include user-sensitive paths (`.ssh`, `.gnupg`, Windows credential stores) on both Windows and non-Windows platforms.
- **Log Folder Access Hardening**: The `list-log-files` handler now only allows access to directories that were previously registered by logging or ping monitor, preventing arbitrary directory listing.

---

## [v1.0.4] - 2026-04-05

### Improved
- **Connection Error Details**: Connection errors in the session dialog are now displayed in a dedicated scrollable panel above the Connect button, showing both a friendly message and the raw error details. This makes it much easier to diagnose SSH handshake failures with legacy devices (e.g., Cisco ASA algorithm negotiation issues).
- **Prompt Pattern Settings**: Simplified the prompt pattern configuration UI — removed the per-pattern enable/disable checkbox in favor of a cleaner single-row layout, and added a "Reset to Default" button to quickly restore built-in patterns.
- **Huawei Prompt Detection**: Updated the Huawei/Yamaha prompt pattern to recognize HRP (High Reliability Platform) prefixes used in HA cluster configurations.

### Bug Fixes
- **Jumpbox Checkbox**: Fixed the "Use as Jumpbox" checkbox incorrectly appearing when manually entering session details without selecting a host from the tree.

### Security
- **Dependency Vulnerability Fixes**: Resolved high-severity XML injection in `@xmldom/xmldom`, high-severity code injection and prototype pollution in `lodash`, and moderate HTTP response header injection and use-after-free in `electron` via `npm audit fix`.

---

## [v1.0.3] - 2026-03-28

### New Features
- **GCE IAP Tunnel**: SSH connections can now be established to Google Compute Engine VMs via Identity-Aware Proxy (IAP), eliminating the need to expose VMs to the public internet. The session dialog integrates with the gcloud CLI to provide autocomplete for GCP projects, zones, and instances. Enable via the "Connect via Google Cloud IAP" checkbox in the SSH connection form.
- **File Explorer**: Added a built-in file browser pane (accessible via **⊞** Features menu → **File Explorer**). Browse drives and directories in a tree structure with lazy-loading expansion, toggle hidden files, and double-click files to open them directly in the Text Editor. Virtual scrolling ensures smooth performance with large directories.
- **Git Bash Connection**: Added Git Bash as a new connection type. HoTTY auto-detects Git Bash installations and provides an interactive login shell session. Selectable from the protocol dropdown in the session dialog.

### Improved
- **Settings Restructured**: The Settings modal has been reorganized into specialized tabs — **General** (logging, keyboard, buffer), **Protocols** (protocol toggles, SSH/Telnet KeepAlive, SSH algorithms), **Features** (enable/disable AI Chat, Log Viewer, Ping Monitor, Text Editor, File Explorer), **Appearance**, and **AI** — for easier navigation and configuration.

### Bug Fixes
- **Text Editor Tab Sync**: Fixed an issue where text editor sub-tab state could become stale due to a closure bug, causing tabs to display outdated content.

---

## [v1.0.2] - 2026-03-26

### Improved
- **Session Dialog Auto-Center**: The New Session dialog now automatically re-centers itself when the application window is resized, keeping it accessible at all times.
- **Session Dialog Form Locking**: The connection form (including the Save and Connect buttons) is now fully disabled immediately upon submission, preventing accidental double-clicks.
- **Theming Compliance**: Replaced 19 hardcoded inline colors, font families, and font sizes across 10 components with CSS theme variables (`--bg-primary`, `--font-family`, `--font-size-base`), ensuring all UI elements respect the active theme.
- **UI Consistency**: Unified modal header/footer padding, button transition speed, background color, and header border-radius across all modal components (SettingsModal, CustomThemeCreator, PasteConfirmationModal, AskAiModal).

### Security
- **Dependency Vulnerability Fixes**: Resolved a high-severity ReDoS vulnerability in `picomatch` and a moderate stack-overflow vulnerability in `yaml` via `npm audit fix`.

---

## [v1.0.1] - 2026-03-25

### Improved
- **Text Editor: Return Code Display**: Return codes (newline characters) are now rendered as visible symbols in the editor. A new **View** menu lets you toggle this display on or off.
- **Text Editor: Line Selection**: Double-clicking a line now selects the entire line content without including the return code character.
- **UI Consistency**: Standardized modal z-index layering, header padding, pane toolbar button padding, disabled button cursors, and font-weight patterns across all components for a more uniform look and feel.

### Security
- **Text Editor File Access Restriction**: The text editor's IPC file read/write handlers now only accept file paths that were previously approved through a native file dialog or drag-and-drop. This prevents potential unauthorized file access if the renderer process were compromised.

### Bug Fixes
- **About Tab Icon**: Fixed the icon background color in the About settings tab.

---

## [v1.0.0] - 2026-03-22

### First Stable Release

HoTTY v1.0.0 marks the first stable release — a fully-featured AI-integrated terminal emulator for Windows supporting SSH, Telnet, Serial, WSL, and Local shell connections.

> ⚠️ **Note:** The OpenAI provider integration has not been fully tested. Google AI Studio (Gemini), Vertex AI, and Anthropic are the recommended options.

### New Features (since v1.0.0-beta10)
- **Show Password**: Added a password visibility toggle to the host tree, allowing you to reveal saved passwords when needed.

### Bug Fixes (since v1.0.0-beta10)
- **Host Tree Import/Export**: Fixed a bug in the host tree import/export functionality.
- **Tab Tooltip**: Fixed an issue where the tab tooltip did not disappear when closing the tab while the tooltip was displayed.

---

## [v1.0.0-beta10] - 2026-03-22

> ⚠️ **Preview Release** — AI provider integrations (Vertex AI, Anthropic, OpenAI) are not fully tested. Gemini remains the recommended production option.

### New Features
- **Jumpbox (Bastion Host) Tunneling**: SSH and Telnet connections can now be routed through an intermediate SSH jumpbox host. Key capabilities:
    - Mark any SSH host in the host tree as a **jumpbox** (displayed with a 🔗 link icon).
    - Assign a jumpbox to target hosts — the connection form shows "via [jumpbox-name]" metadata.
    - Tunneled connections use ssh2 `forwardOut()` to create a secure TCP tunnel through the jumpbox.
    - Full host key verification on jumpbox connections via the existing known_hosts infrastructure.
    - Session tab titles automatically append "via [jumpbox-host]" for tunneled sessions.
- **Tab Tooltip**: Tab titles now show a tooltip when the text overflows, making it easy to see the full connection name on narrow tabs.

### Improved
- **Telnet Authentication**: Telnet connections now support automatic username/password authentication, with parsing delegated to the telnet-client library.
- **Terminal Markers**: Adjusted marker positioning to sit 2px left of the vertical scrollbar, preventing overlap.
- **Terminal Scrollbar**: Improved vertical scrollbar appearance and styling consistency.
- **UI Consistency**: Consolidated duplicate `@keyframes` animations into a shared `animations.css` file. Unified modal shadows, border-radius, and input styling across all dialog components.
- **Theme Cleanup**: Removed obsolete theme variables (`error-color`, `chat-msg-model-bg`, `panel-bg`, `active-pane-color`, `select-arrow`) and added new variables for tab watching states and terminal prompt indicators.

---

## [v1.0.0-beta9] - 2026-03-21

> ⚠️ **Preview Release** — AI provider integrations (Vertex AI, Anthropic, OpenAI) are not fully tested. Gemini remains the recommended production option.

### New Features
- **Text Editor**: Added a built-in text editor as a new pane type (accessible via the **⊞** Features menu → **Text Editor**). Key capabilities:
    - Multi-tab editing — open multiple files in independent sub-tabs within a single pane.
    - File open and save with encoding support (UTF-8, ASCII, Latin-1) and line ending display (LF / CRLF).
    - **Find & Replace** toolbar with case-sensitive search and occurrence count.
    - **Go to Line** dialog for fast navigation in large files.
    - Visual line numbers that correctly account for wrapped lines.
    - Unsaved changes indicator (`•`) on sub-tab titles.
    - **File association** — files passed as command-line arguments open directly in the Text Editor.

### Improved
- **Theme Completeness**: Eliminated all remaining hardcoded colors from the UI. New CSS variables added across all built-in themes:
    - `text-tertiary` — for dimmed/muted text (drag handles, hints).
    - `status-success` / `status-error` — for authentication status indicator dots.
    - `link-color` — for hyperlinks in the About panel.
    - `pane-color-1` through `pane-color-6` — for tab-to-pane connection line colors.
    - `resize-grip-shadow` — for the resize grip handle stripe pattern.
- **UI Consistency**: Aligned modal padding, font sizes, and spacing across all dialog components.
- **Line Wrap Performance**: Rewrote visual line number computation to use a single DOM layout pass instead of per-line reflows, eliminating lag on large files when line wrap is enabled.
- **Code Quality**: Extracted duplicate terminal color application logic; replaced stringly-typed tab type checks with a typed Set constant.

### Security
- **DPAPI Batch Validation**: Added array length guard (max 1,000 entries) to `dpapi-encrypt-batch` and `dpapi-decrypt-batch` IPC handlers to prevent memory exhaustion from unbounded input.

---

## [v1.0.0-beta8] - 2026-03-21

> ⚠️ **Preview Release** — AI provider integrations (Vertex AI, Anthropic, OpenAI) are not fully tested. Gemini remains the recommended production option.

### New Features
- **Ping Monitor**: Added a built-in ICMP ping monitoring pane as a new session type. Monitor multiple hosts simultaneously with:
    - Configurable ping intervals (1s, 3s, 5s, 10s, 30s, 60s).
    - Real-time RTT (Round-Trip Time) and TTL display per target.
    - Visual status indicators (OK, Fail, DNS error).
    - Optional CSV log export to the configured logging folder.
    - Input validation to prevent shell injection via target hostnames.

### Improved
- **Persona-Specific Ask AI Commands**: Each AI persona now has its own independent set of Ask AI commands. Switching personas automatically loads the corresponding command set, enabling tailored quick actions per role (e.g., Network Expert vs. Security Analyst). AI settings have been extracted into a standalone modal for easier access.
- **Graphics Performance**: Improved rendering performance across the UI:
    - Optimized grid layout recalculations and resize handling with `requestAnimationFrame`.
    - Reduced unnecessary re-renders in terminal panes, AI chat, and log viewer components.
    - Improved sidebar resize smoothness with throttled updates.

---

## [v1.0.0-beta7] - 2026-03-20

> ⚠️ **Preview Release** — AI provider integrations (Vertex AI, Anthropic, OpenAI) are not fully tested. Gemini remains the recommended production option.

### Improved
- **Vertex AI Implementation**: Comprehensive improvements to the Vertex AI provider:
    - **Region-Aware Model Discovery**: Added `ai-list-locations` and `ai-set-location` IPC channels, enabling dynamic region selection for Vertex AI model retrieval.
    - **Global Endpoint Support**: The Vertex AI provider now correctly handles the `global` location, routing requests to `aiplatform.googleapis.com` instead of region-prefixed endpoints.
    - **Publisher-Specific Routing**: Vertex AI chat requests are now routed through publisher-specific implementations to handle API format differences between Google and third-party Model Garden publishers.
- **Multi-Provider Cost Tracking**: Replaced the Gemini-only `calcGeminiCost` with a unified `calcAICost` function that supports pricing tables for Gemini, OpenAI, and Anthropic models. Per-response cost is now accumulated and displayed in the AI chat pane.
- **Help Modal Rewrite**: The Help modal's AI section has been rewritten as an "AI Quick Start Guide" with a streamlined 3-step onboarding flow and a new "AI Provider Comparison" section.
- **Provider Switch Cleanup**: Switching the active AI provider now clears chat history, streaming state, and token counters to prevent stale data from carrying over.

### Changed
- **Legacy Gemini IPC Removed**: All backward-compatible `gemini-*` IPC aliases (`gemini-auth-start`, `gemini-auth-auto`, `gemini-auth-status`, `gemini-auth-logout`, `gemini-chat-send`, `gemini-list-models`, `gemini-chat-cancel`, `gemini-chat-clear`) and their preload bindings have been removed. All AI communication now uses the unified `ai-*` channels exclusively.
- **Direct API Access Cleanup**: Replaced remaining direct `window.electronAPI` calls in `HostTree`, `SessionDialog`, and `AppearanceTab` with the typed `electronService` wrapper, ensuring consistent API access patterns across the codebase.

### Security
- **Log Folder Access Hardened**: The `list-log-files` IPC handler now only allows reading from directories that were previously registered via `update-logging`, preventing arbitrary directory listing.

### Bug Fixes
- **AI Pane Focus on Re-login**: Fixed an issue where the AI chat pane lost focus after logging out and logging back in to an AI provider.
- **AI Tab Name**: Fixed a hard-coded AI tab name that was not reflecting the selected provider.

---

## [v1.0.0-beta6] - 2026-03-18

### New Features
- **Multi-Provider AI Support**: The AI backend has been fully generalized. You can now select your AI provider from Settings > AI:
    - **Google Gemini** (Google AI Studio) — existing Gemini OAuth flow, unchanged.
    - **Vertex AI** (Google Cloud) — supports Application Default Credentials (ADC) and Service Account Key File authentication.
    - **OpenAI** — connect using an OpenAI API key.
    - **Anthropic** — connect using an Anthropic API key.
- **Provider-Specific Auth Panels**: Each provider has a dedicated authentication panel with the appropriate credential fields.

### Changed
- **AI Architecture Refactored**: Internal AI communication has been unified under a provider-agnostic `AIService` / `IAIProvider` abstraction. All IPC channels now use the new `ai-*` prefix; legacy `gemini-*` aliases are retained for backward compatibility.
- **`useGeminiChat` replaced by `useAiChat`**: The front-end AI chat hook has been rewritten as a provider-agnostic `useAiChat`, and the old `AskGeminiModal` has been replaced by `AskAiModal`.

---

## [v1.0.0-beta5] - 2026-03-17

### Improved
- **Update Notification**: Enhanced the update notification banner with two new action buttons:
    - **Skip this version**: Dismisses the banner and suppresses it for the current version only. The notification will reappear if a newer version is released.
    - **Never Notify**: Permanently disables all update notifications. This preference is saved to localStorage.
- **Update Notification in Settings**: When an update is available, a download button for the new version now also appears in **Settings > About**, giving quick access to the latest release from within the settings dialog.

---

## [v1.0.0-beta4] - 2026-03-17

### Bug Fixes
- **Update Notification**: Fixed a bug where the update notification was not displayed when a newer version used a pre-release version string (e.g., `1.0.0-beta3` vs `1.0.0-beta2`). The version comparison logic now correctly handles pre-release suffixes such as `-beta3`.

### Security
- **Deserialization Hardening**: Strengthened input validation in `GeminiService.loadToken()`. Each field from the decrypted token file is now extracted individually with explicit type checks, preventing unexpected properties from being assigned.

---

## [v1.0.0-beta3] - 2026-03-16

### Improved
- **Test Coverage**: Achieved 100% test coverage for all functional code. Added unit tests for all previously untested modules including Electron main-process services (`Logger`, `LogManager`, `dpapi`, `knownHosts`, `GeminiService`, `SshService`, `TelnetService`, `SerialService`, `WslService`, `LocalService`), the `geminiPricing` utility, and the root `App` component. Total test count: 701 tests across 58 files.
- **ESLint Config**: Added a test-file override to allow `@typescript-eslint/no-explicit-any` in test files, which is necessary for accessing TypeScript private members in unit tests.

---

## [v1.0.0-beta2] - 2026-03-16

### New Features
- **Update Notification**: The app now automatically checks for new releases on GitHub at startup. When a newer version is available, a non-blocking banner is displayed at the top of the window with a download link. Pre-release versions are excluded from this check.

### Security
- **XSS Fix**: Replaced the custom HTML sanitization function with [DOMPurify](https://github.com/cure53/DOMPurify) for AI chat output rendering. This eliminates potential XSS attack vectors via SVG `onload`, data URIs, and other bypass techniques not covered by the previous implementation.

### Bug Fixes
- **Watch Tab Switch**: Fixed a bug where switching the watched tab caused incorrect behavior in the AI session state.

### Changed
- **Generalized AI Feature Names**: AI-related features and UI labels are no longer tied to a specific provider name. The app now uses generic terms (e.g., "AI Chat" instead of "Gemini Chat", "AI Monitor" instead of "Gemini Monitor") to better reflect future multi-provider support.

---

## [v1.0.0-beta1] - 2026-03-14
### Official Release
We are proud to announce the formal v1.0.0 release of HoTTY! This milestone represents a stable, feature-rich terminal experience with deep Gemini AI integration.

### Core Architecture & Stability
- **Massive Refactoring**: Completed a major deconstruction of the core `App.tsx`, reducing complexity by over 50% and improving long-term maintainability.
- **Hook-based State**: Migrated all major logic (Settings, Gemini, Terminal Flow) to specialized custom hooks for better performance and debugging.
- **Theme Engine**: A robust, variable-based theme engine with full documentation and a visual Custom Theme Creator.

### AI Capabilities
- **Gemini 2.0 Integration**: Native support for the latest Gemini models with dynamic model discovery.
- **Interactive Investigation**: Proactive AI that can propose terminal commands and analyze results in real-time.
- **Watch & Analyze**: Ability to monitor terminal output and request instant analysis for debugging and learning.

### User Experience
- **Advanced Grid**: Industry-leading 2D intersection resizing and persistent layout management.
- **Broad Protocol Support**: SSH, Telnet, Serial, WSL, and local Windows shells (CMD/PowerShell).
- **Log Management**: Built-in Log Viewer and dedicated millisecond-precision timestamp logging.

### Security
- **IPC Input Validation**: Added allowlist validation for the `update-session-encoding` IPC handler, rejecting unrecognized encoding values before they reach session services.

---

## [v0.1.15] - 2026-03-14
### Added
- **Custom Theme Creator**: Added a built-in visual theme editor in Settings > Appearance. Users can now create and fine-tune custom color schemes directly within the app without editing JSON files manually.
- **Log Viewer**: Added a built-in log file viewer as a new session type (`Log Viewer`). Select it from the protocol dropdown in the New Connection dialog to open a dedicated pane for browsing and viewing saved session log files. The viewer reads log files from the configured logging folder.
- **Timestamp Log (`.tslog`)**: Each log session now generates a companion `.tslog` file alongside the main `.txt` log. The `.tslog` file records the precise timestamp (millisecond precision) for each line of output, enabling accurate post-session time analysis.

### Changed
- **Full Theme Enforcement**: All UI components now consistently use CSS variables (`var(--xxx)`) for colors and fonts. Eliminated all hard-coded color values and font sizes across the entire codebase for complete theme compliance.
- **Gemini Command Response Behavior**: Improved how Gemini detects and handles the end of its responses, making AI command execution more reliable and predictable.
- **Gemini System Prompt Adjustment**: Refined the built-in system prompt for clearer, more consistent AI behavior in terminal-integrated workflows.
- **New Session Icon**: Updated the "New Session" button icon for improved visual clarity.
- **Tab Bar Improvements**: Refined tab bar styling and interaction for a cleaner, more theme-consistent appearance.

### Fixed
- **Sidebar/Bar Toggle**: Fixed a bug where clicking the toggle icon for Left Sidebar, Right Sidebar, Top Bar, or Bottom Bar a second time did not hide the panel.
- **Tab-Pane Mapping Arrows**: Fixed stale arrows remaining in the "Show Tab-Pane Mapping" overlay after a bar was hidden.

## [v0.1.15-beta9] - 2026-03-13
### Added
- **Log Viewer**: Added a built-in log file viewer as a new session type (`Log Viewer`). Select it from the protocol dropdown in the New Connection dialog to open a dedicated pane for browsing and viewing saved session log files. The viewer reads log files from the configured logging folder.
- **Timestamp Log (`.tslog`)**: Each log session now generates a companion `.tslog` file alongside the main `.txt` log. The `.tslog` file records the precise timestamp (millisecond precision) for each line of output, enabling accurate post-session time analysis.

## [v0.1.15-beta8] - 2026-03-13
### Fixed
- **Sidebar/Bar Toggle**: Fixed a bug where clicking the toggle icon for Left Sidebar, Right Sidebar, Top Bar, or Bottom Bar a second time did not hide the panel. The root cause was passing a function updater (`prev => !prev`) to Zustand setters that only accept a plain boolean value.
- **Tab-Pane Mapping Arrows**: Fixed stale arrows remaining in the "Show Tab-Pane Mapping" overlay after a bar was hidden. The `computeLines` function now depends on all four bar visibility flags (`showLeftSidebar`, `showRightSidebar`, `showTopBar`, `showBottomBar`) and re-runs whenever any of them change.

### Changed
- **Hidden AI Tab Indicator**: When a Gemini AI pane becomes hidden due to a layout reduction (fewer panes or bars), the corresponding tab now displays a reddish gradient (dark red → crimson) instead of the normal rainbow gradient, making it immediately clear that the AI session is not currently visible.

## [v0.1.15-beta7] - 2026-03-11
### Changed
- **Major Refactoring & Architectural Simplification**:
    - **App.tsx Deconstruction**: Reduced the main `App.tsx` from 1953 lines to ~900 lines (54% reduction), significantly improving maintainability and reducing the "God Object" complexity.
    - **Custom Hooks Extraction**:
        - **`useInteractiveFlow`**: Centralized terminal output tracking, prompt detection, and AI feedback stabilization logic.
        - **`useGeminiChat`**: Unified Gemini API interactions, "Ask AI" command resolution, and context management.
        - **`useSettings`**: Consolidated 40+ application settings into a single state with automated localStorage synchronization.
    - **`PaneContent` Component**: Unified rendering logic for Terminal and AI Chat panes across all 5 possible workspace positions (Left/Right Sidebars, Top/Bottom Bars, and Main Grid).

### Fixed
- **Theme Synchronization**: Fixed a bug where theme changes were incomplete after the settings hook migration.
- **Code Hygiene**: Resolved multiple unused variables, lint warnings, and type inconsistencies across the codebase.

## [v0.1.15-beta6] - 2026-03-09
### Added
- **Interactive AI Improvements**:
    - **Multi-Timer Prevention**: Implemented a "clear-and-reserve" logic for the stabilization timer to prevent duplicate AI requests during rapid terminal output.
    - **Customizable Timeout**: Added an input field in Settings > AI to customize the interactive stabilization timeout (default: 10,000ms).
    - **Cancellation Sync**: Cancelling the "Waiting" state in AI chat now immediately stops background terminal tracking, resolving issues with persistent commands like `top`.
- **UI Refinements**:
    - **Settings Layout**: Moved "Proactive Investigation Instruction" directly below "Personas" in the AI settings tab for a more logical configuration flow.
- **Improved Prompt Detection**:
    - Implemented strict whole-line matching for prompt detection patterns to eliminate false positives from terminal output content.

## [v0.1.14-beta5] - 2026-03-08
### Added
- **Interactive AI Investigation**:
    - AI can now proactively propose investigation commands (e.g., `show version`).
    - **Interactive AI Investigation**: AI can now proactively propose investigation commands, automatically capture terminal output, and continue analysis.
- **Enhanced Stability**: Added a "silence detection" (300ms delay) during output capture to ensure full command results are received before analysis.
- **Improved Prompt Detection**: Refined ANSI/OSC stripping and strict suffix matching for more reliable command completion detection.
- **Wait Diagnostics**: The waiting indicator now displays real-time elapsed time and received data volume.
- **Manual Controls**: "Cancel" and "Send Now" buttons added to the waiting state for manual intervention.
- **Smart Chat Scrolling**: Long AI responses now automatically scroll to the beginning of the message for improved readability.
- **Prompt Detection Robustness**: Fixed specific edge cases in CMD and PowerShell prompt detection.
- **Data Listener Stability**: Refactored the terminal data listener to prevent data loss or stale state issues during rapid output.

## [v0.1.14-beta4] - 2026-03-08
### Added
- **AI Monitor**:
    - Introduced a "Watch" (👁️) feature for terminal sessions. When enabled, terminal output is recorded into an in-memory buffer.
    - **Tab Ask Button**: A new "✨ Ask" button appears on watched tabs. Clicking it opens a context menu with "Analyze Watched Output" and custom AI commands.
    - **Smart Buffer Limit**: Added a "Watch Buffer Limit" setting in Settings > AI to control the size of the recorded context (default: 500,000 characters).
- **Refined AI Tab Activation**: Clicking "Ask AI" now automatically focuses the target terminal tab before opening the AI chat to ensure correct context.
- **Improved UI Visuals**:
    - Replaced Watch status emojis with clean, theme-aware SVG icons.
    - Added a gentle pulsing animation to the active Watch icon for better visibility.
- **Ask Button Safety**: The ✨ Ask button is automatically disabled when the watch buffer is empty to prevent non-actionable states.

### Fixed
- **Context Menu Context**: Fixed an issue where the wrong terminal context was read when using "Ask AI" from background tabs.
- **Clean Context Menus**: Removed unnecessary options like "Paste" when opening Gemini menus from the tab bar ✨ button.

### Added
- **Gemini Logout**: Added a "Logout from Gemini" button in Settings > AI. This allows you to securely clear your Google authentication token.
- **Auto-Close AI Tabs**: When logging out from Gemini, all open AI chat tabs are now automatically closed for security and workspace cleanup.

### Security Enhancements
- **Content Security Policy (CSP)**: Implemented a strict CSP to mitigate XSS risks and restrict unauthorized script execution.
- **Capability-based Media Access**: Refactored the `media://` protocol to use a secure token-based lookup system. This replaces the vulnerable `authorizeMediaPath` IPC and prevents unauthorized access to local files.

## [v0.1.14-beta2] - 2026-03-08
### Fixed
- **Context Menu Interaction**: Fixed an issue where the context menu would stay open after selecting the "Export" option. The menu now closes automatically when the export password prompt appears.
- **Visual Cleanup**: Removed a redundant separator line that appeared at the top of the host-specific context menu.

## [v0.1.14-beta1] - 2026-03-04
### Added
- **Telnet KeepAlive**:
    - Implemented dual-layer keepalive for Telnet connections to prevent idle timeouts.
    - **TCP Keepalive**: OS-level connection health monitoring via `socket.setKeepAlive()`.
    - **Telnet NOP**: Periodically sends IAC NOP (`0xFF 0xF1`) to reset server-side idle timers.
    - Default interval: 30 seconds (configurable).
- **Telnet Settings Tab**: Added a dedicated "Telnet" tab in Settings for KeepAlive configuration (enable/disable checkbox and interval input).
- **Toolbar Position**: Added a "Toolbar Position" option in Settings > Appearance to switch the sidebar between Left and Right.

### Fixed
- **Close Button Consistency**: Unified the close button styling between the Settings modal and the New Connection dialog (matching font size, color, and removing the focus ring).

## [v0.1.13] - 2026-02-23
### Fixed
- **Terminal Marker Rendering**:
    - Fixed an issue where markers (orange/blue) were interrupted on long wrapped lines.
    - Improved consistency of output markers on empty lines within command outputs.
    - Resolved the issue of redundant markers remaining below the cursor in WSL and PowerShell by simplifying the marker lifecycle logic.

### Changed
- **Cleanup**:
    - Removed unnecessary test scripts (`test.js`) and backup files (`README.ja.md.bak`) to keep the project clean.


## [v0.1.12] - 2026-02-22
### Fixed
- **Host Tree Indentation**:
    - Fixed a bug where the indentation of deeply nested host entries was too large due to cumulative `paddingLeft` from wrapper `div` elements.
    - Moved `paddingLeft` from the outer `host-tree-node` wrapper to the `host-tree-row` element directly, ensuring each level adds exactly 14px regardless of nesting depth.
    - Hosts under deep folders (e.g., Global → APAC → Japan) now display at the same relative indentation as shallow hosts (e.g., Local → WSL local).

### Changed
- **Code Maintenance**:
    - Translated the remaining Japanese comment in `electron/main/index.ts` to English.

## [v0.1.11] - 2026-02-20
### Added
- **Top and Bottom Bars**:
    - Added toggleable **Top Bar** and **Bottom Bar** to the workspace.
    - Bars function like standard panes (drop tabs into them) but span the full width of the central grid.
    - Ideal for status monitoring, input fields, or dedicated tools.
- **Layout Persistence**:
    - The application now remembers your layout configuration across restarts!
    - **Persisted Settings**:
        - Visibility and size (percentage) of Left/Right Sidebars and Top/Bottom Bars.
        - Grid Layout Mode (1x1, 2x2, etc.).
        - Relative sizes of grid panes (dragged ratios).
    - **Smart Resizing**: Sidebars and Bars now use **percentage-based sizing**, ensuring your layout proportions remain consistent even when resizing the application window.
- **Host Manager**:
    - The **New Connection** dialog now features a two-panel layout.
    - **Left panel**: Tree-based host manager supporting unlimited nested folders (e.g., Global → APAC → Japan).
    - Hosts save protocol, host/IP, port, username, and password persistently.
    - **Right-click** tree nodes to Add Folder, Add Host, Rename, or Delete.
    - Clicking a saved host auto-fills the connection form. Credentials update automatically on Connect.

### Fixed
- **Tab-Pane Mapping**:
    - Fixed an issue where the "Show Tab-Pane Mapping" arrows were not displayed when tabs were placed in the Sidebars, Top Bar, or Bottom Bar.
- **Unread Data Indicator**:
    - Fixed an issue where terminal tabs placed in the Sidebars, Top Bar, or Bottom Bar did not turn red to indicate unread activity when their respective bar was hidden.

### Changed
- **UI Refinements**:
    - **Corner Priority**: Sidebars (Left/Right) now take vertical priority over Top/Bottom bars, creating a "sandwiched" center layout.
    - **Gap Consistency**: Unified spacing (2px) between all panes, sidebars, and bars for a cleaner look.
    - **Layout Selector**: Added icons for toggling Top/Bottom bars.
- **Terminal Allocation**:
    - **Fallback Allocation**: When the main grid is full, new terminal sessions will now automatically open in empty outer bars (if visible) in the following priority order: Left Sidebar -> Right Sidebar -> Top Bar -> Bottom Bar.



## [v0.1.11-beta2] - 2026-02-19
### Fixed
- **Installer Fixes**:
    - Fixed an issue where configuration files (`themes.json`, `ssh_algorithms.json`) were not included in the installer.
    - Changed the configuration storage location to the user data folder (e.g., `%APPDATA%`) to ensure settings are saved correctly.
- **Startup Issue Fix**:
    - Fixed an issue where the application would hang on a black screen at startup (due to missing IPC definitions).
- **Improved Backspace key compatibility for network devices**:
    - Changed default Backspace character from `0x7f` (DEL) to `0x08` (BS) for **SSH, Telnet, and Serial** sessions.
    - Kept `0x7f` (DEL) as default for WSL and local shells (CMD, PowerShell) to maintain compatibility with Unix-like environments.
    - Added "Backspace sends 0x7F (DEL)" option in Settings > System for cases where DEL is required.

### Added
- **SSH Algorithm Customization**: Added menu in Settings > SSH to individually enable/disable SSH Key Exchange, Cipher, Server Host Key, and HMAC algorithms.
- **External Configuration Files**: Separated theme definitions (`themes.json`) and SSH algorithm definitions (`ssh_algorithms.json`) as external resources. Users can now edit these files in the user data folder for advanced customization.
- **Settings UI improvements**: Reordered tabs (System, Appearance, SSH, AI, About) and moved Network settings to a dedicated "SSH" tab.


## [v0.1.10] - 2026-02-19
### Added
- **Multi-Window Support**: You can now open multiple HoTTY windows simultaneously. Clicking the app icon or running a second instance will open a new independent window.
- **Improved IPC Architecture**: Refactored internal communication to ensure each window manages its own sessions and AI chat independently.

## [v0.1.9] - 2026-02-18
### Added
- **Windows Local Shell Support**: Added direct connection to Command Prompt (CMD) and PowerShell.
- **PTY Implementation**: Integrated `node-pty` for perfect terminal experience (Backspace, Arrow keys, Ctrl+C support).
- **WSL Enhancement**: Refactored WSL connection to use `node-pty` for better stability and resizing.
- **SSH**: Externalized supported algorithms to `ssh_algorithms.json` with multi-tier fallback support.
- **SSH**: Added `enabled` flag to each SSH algorithm in the configuration file for granular control.

## [0.1.8] - 2026-02-18

### Added
- **WSL Connection Support**: Connect directly to Windows Subsystem for Linux (WSL) distributions.
  - Automatically lists installed distributions.
  - Implements a TTY simulation using the `script` command to ensure interactive shells work correctly without heavy dependencies.

### Changed
- **SSH UX Improvements**:
  - Replaced technical authentication error messages with a more user-friendly: "Username or password may be incorrect."
  - Suppressed redundant error popups for normal disconnections (e.g., "Connection closed by server").
- **Terminal Interaction**:
  - **Custom Ctrl+C Behavior**: If text is selected in the terminal, pressing `Ctrl+C` will now only clear the selection. This prevents accidental SIGINT signals from being sent to the remote process when you just want to copy/deselect.
- **Maintenance**:
  - Updated all documentation (README, Release Notes) to reflect the new connectivity options.

## [0.1.7] - 2026-02-17

### Added
- **Themes Guide**: Added [THEMES_GUIDE.md](THEMES_GUIDE.md) and [THEMES_GUIDE.ja.md](THEMES_GUIDE.ja.md) to explain the properties in `themes.json`.
- **Default Background Mode**: Added a "Default" option for empty pane backgrounds, allowing users to easily restore the original HoTTY logo background without manual file selection.
- **Further Improved SSH Compatibility**: Resolved the "Unknown DH group" error observed on certain devices by explicitly allowing all Key Exchange algorithms. This ensures even better connectivity with legacy network devices and industrial hardware.

### Changed
- **Visual Improvements**:
  - **Dark Theme**: Set active terminal background to pure black (`#000000`) for maximum contrast.
  - **Medium Theme**: Swapped active and inactive background colors for better consistency; removed unnecessary white overlays to ensure intended color depth.
  - **Light Theme**: Corrected a typo in `paneBackground`.
- **Code Maintenance**:
  - All source code comments have been translated from Japanese to English for global maintainability.
  - Removed non-ASCII separators and characters from the codebase.
- **Reliability**:
  - Improved theme application logic to correctly load values from `themes.json` and override potentially stale `localStorage` data on application startup.

## [0.1.6] - 2026-02-15

### Changed
- **Persona System Improvements**:
  - Fixed an issue where "Ask AI" would default to the "General Helper" persona instead of the selected one.
  - Ensured that the System Prompt is properly sent with manual chat messages, preserving the selected persona during conversation.
  - Removed the redundant Persona dropdown in the manual input area for a cleaner UI.
- **UI/UX Refinements**:
  - Reordered the "Settings -> AI" tabs to "Ask AI Commands", "Personas", and "Debugging".
  - Fixed text wrapping issues for "Show System Prompt" and "Enable Logging" labels in Settings.
- **AI Content Enriched**:
  - **New Commands**: Added "Explain code", "Interpret log", "Root cause analysis", and "Fix this" commands with improved prompt templates.
  - **New Personas**: Added "Security Analyst" persona.
  - **Refined Personas**: Updated "Network/Server/Cloud/Coding Expert" system prompts to be more specific and professional.
- **Installer Improvements**:
  - **Silent Updates**: The installer no longer asks to delete user data during silent installations (e.g., auto-updates). The prompt only appears during manual uninstallation.

## [0.1.5] - 2026-02-15

### Changed
- **Visual Refinements**:
  - Replaced the icon on the Setting -> About page with the official app icon (icon.png).
  - Added a white rounded background to the logo on the About page to ensure visibility for transparent icons on dark backgrounds.
  - Standardized the window and browser tab icons with the latest logo.

## [0.1.4] - 2026-02-14

### Added
- **Security Hardening**:
  - Implemented path validation for the `media://` protocol to prevent path traversal vulnerabilities.
  - Enabled Electron sandbox for all windows.
  - Added input validation for internal IPC handlers.
- **Uninstaller Improvements**:
  - Added an option to completely remove user data (settings, credentials, history) during uninstallation.
- **AI Integration**:
  - The default AI model is now "Unspecified" on startup.
  - Added a UI guard that disables the "Send" button until a model is selected, with a clear error message in English.

### Changed
- **Visual Refinements**:
  - Updated application icon to the new black "H" logo.
  - Refined tab close button: Now a red circle with a perfectly centered SVG cross.
  - Sidebar Refactoring: Moved "Show Tab-Pane Mapping" to the top group and aligned "Line Wrap" to the bottom. Replaced emoji icons with theme-aware SVG icons.
- **Customization**:
  - Added "Inactive Terminal Background" setting for Custom themes, allowing distinct background colors for active vs. inactive panes.

## [0.1.3] - 2026-02-14

### Changed
- **Default Theme**: Changed the default theme to "Medium" for a balanced visual experience.
- **Medium Theme Polishing**:
  - Fixed CSS variable definitions to ensuring consistent styling across all panes (including Gemini).
  - Improved color contrast for better readability.
- **App Icon**: Fixed the application icon configuration to ensure it appears correctly in the Windows taskbar and installer.
- **Settings UI**:
  - **Ask AI Commands**:
    - Fixed text area overflow issue.
    - Added drag-and-drop support for reordering commands.

## [0.1.2] - 2026-02-14

### Added
- **Log Saving**:
  - Enable auto-logging of terminal sessions to local text files.
  - Configurable log folder path with native directory picker.
  - Logs are named with timestamp, protocol, and host (e.g., `YYYYMMDDHHMMSS-SSH-192.168.1.1.txt`).
- **Local Log Buffer Control**:
  - Configurable scrollback limit (default 10,000 lines) to manage memory usage.
  - Auto-trimming of old logs from memory when the limit is exceeded.
- **Line Wrap Toggle**:
  - New sidebar button to toggle connecting line wrapping on/off.
  - **Horizontal Scrolling**: When line wrap is disabled, a horizontal scrollbar appears for long lines.

### Changed
- **Settings UI**: Added a dedicated "System" tab for logging and buffer settings.

## [0.1.1] - 2026-02-13

### Added
- **Dynamic AI Model Loading**: Automatically fetches available Gemini models from your Google account (e.g., Gemini 1.5 Pro, 2.0 Flash).
- **Theme System**: Full support for Light, Dark, and Custom themes with persistent color settings.
- **Settings Organization**: Split settings into "Appearance" and "Network" tabs for better navigation.

### Changed
- **UI Refinements**:
  - Standardized dropdown arrow sizing and positioning across all dialogs.
  - Adjusted modal overlay opacity for a more consistent look.
  - Made Settings and Connection dialogs scrollable for better accessibility on small screens.
- **AI Chat Experience**:
  - Chat state (history, input) is now preserved when moving the AI pane between grid slots.
  - Improved model fallback logic to ensure validity.

## [0.1.0] - 2026-02-13

### Added
- **Multi-protocol Support**: Full integration for SSH, Telnet, and Serial (COM) port connections.
- **Advanced Grid Layout**: Flexible multi-pane interface with drag-and-drop tab support.
- **2D Intersection Resizing**: Simultaneously resize 4 panes by dragging their intersection point.
- **Enhanced Visuals**:
  - Customizable terminal foreground and background colors.
  - Background image support for empty panes with tiling/repeat capability.
  - Built-in file explorer for easy background image selection.
- **Improved Resizer UX**: Wider resizer hitboxes (8px) and context-aware cursors (↔︎/↕︎/move).
- **Session Management**:
  - Persistent settings for fonts, encoding, and colors.
  - In-memory password caching for secure session resumption.
  - Configurable SSH KeepAlive to prevent idle disconnects.
 - **Installer**: Official Windows NSIS installer version 0.1.0.

### Changed
- Refactored core architecture to use `ISessionService` for better maintainability.
- Simplified `App.tsx` by delegating state management to custom hooks (`useSessionManager`, `usePaneManager`).
- Increased default resizer width from 4px to 8px for better accessibility.

### Technical Improvements
- Migrated to React 19 + Vite 7 stack.
- Improved local file loading through custom `media://` protocol in the Main process.
- Cleaner `.gitignore` configuration for production distribution.
