import type React from 'react';
import './HelpModal.css';

const FeaturesIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: 'middle', marginInline: '2px' }}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const WatchIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'inline', verticalAlign: 'middle', marginInline: '2px' }}>
    <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.7" />
    <circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.4" />
  </svg>
);

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function HelpModal({ open, onClose }: HelpModalProps) {
  if (!open) return null;

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <span>Help & Documentation</span>
          <button className="help-modal-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div className="settings-modal-body help-content">

          <details className="help-section" open>
            <summary>Shortcuts</summary>
            <div className="help-section-body">
              <ul className="shortcuts-list">
                <li><code>Ctrl + N</code> New Session Dialog</li>
                <li><code>Ctrl + W</code> Close current tab</li>
                <li><code>Ctrl + C</code> Clear selection / Send SIGINT</li>
                <li><code>Ctrl + V</code> Paste to terminal (with security check)</li>
                <li><code>Ctrl + Enter</code> Send message in Ask AI dialog</li>
                <li><code>Escape</code> Close modal / dialog</li>
              </ul>
            </div>
          </details>

          <details className="help-section" open>
            <summary>Getting Started</summary>
            <div className="help-section-body">
              <p className="help-text">
                Open the connection dialog via <code>Ctrl + N</code> or the <strong>&quot;New&quot;</strong> button in the sidebar. You can manage your hosts and folders in the host tree.
              </p>
              <p className="help-text">
                <strong>Double-click:</strong> Double-click a host in the tree to connect immediately.
              </p>
              <p className="help-text">
                <strong>Supported connection types:</strong>
              </p>
              <ul className="shortcuts-list">
                <li><strong>SSH</strong> — Encrypted remote shell (password or key authentication)</li>
                <li><strong>Telnet</strong> — Unencrypted remote shell for legacy devices</li>
                <li><strong>Serial</strong> — Direct COM port connection (routers, embedded devices, etc.)</li>
                <li><strong>WSL</strong> — Windows Subsystem for Linux distributions</li>
                <li><strong>Local</strong> — Local shell (CMD or PowerShell)</li>
                <li><strong>Git Bash</strong> — Git Bash interactive login shell (auto-detected)</li>
              </ul>
              <p className="help-text">
                <strong>Jumpbox (Bastion Host):</strong> SSH and Telnet connections can be routed through a jumpbox. Mark any SSH host as a jumpbox in the host tree, then select it as the &quot;via&quot; host when editing a target host.
              </p>
              <p className="help-text">
                <strong>GCE IAP Tunnel:</strong> Connect to Google Compute Engine VMs via Identity-Aware Proxy without exposing VMs to the public internet. Check &quot;Connect via Google Cloud IAP&quot; in the SSH form, then select your GCP project, zone, and instance (autocomplete provided via gcloud CLI).
              </p>
              <p className="help-text">
                <strong>Update Notifications:</strong> On startup HoTTY checks the GitHub releases feed and shows a dismissible notification when a newer version is available, linking directly to the release page.
              </p>
              <p className="help-text">
                <strong>Connection Status:</strong> A Connecting overlay is shown while the transport is being established. SSH and Telnet sessions time out after a configurable interval (default 5 seconds) — see <strong>Settings &rarr; Protocols</strong>. Connection failures appear as dismissible toast notifications.
              </p>
              <p className="help-text">
                <strong>SSH Algorithms:</strong> Toggle which key-exchange, cipher, MAC, and host-key algorithms are offered during the SSH handshake under <strong>Settings &rarr; Protocols &rarr; SSH Algorithms</strong>. Modern defaults such as <code>curve25519-sha256</code> and <code>diffie-hellman-group14-sha256</code> are enabled out of the box. Legacy SHA-1 options (<code>diffie-hellman-group14-sha1</code>, <code>3des-cbc</code>, <code>ssh-dss</code>, etc.) remain available for older devices (e.g. Cisco Catalyst 3650 / older IOS) that do not negotiate modern algorithms. Enabling <code>diffie-hellman-group-exchange-sha1</code> shows a confirmation prompt because SHA-1 is considered broken — use a stronger KEX whenever possible.
              </p>
              <p className="help-text">
                When upgrading, any algorithms newly added in a release are merged into your saved configuration so you don&apos;t need to manually opt in to security improvements.
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>Organizing the Host Tree</summary>
            <div className="help-section-body">
              <p className="help-text">
                <strong>Drag & Drop:</strong> You can reorder hosts and folders by dragging them in the &quot;New Session&quot; dialog.
              </p>
              <p className="help-text" style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                <strong>Export & Import:</strong> Use the
                <span style={{ color: 'var(--color-danger)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </span>
                <strong>Export</strong> and
                <span style={{ color: 'var(--success-color)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </span>
                <strong>Import</strong> icons at the top-right of the host panel to backup or load your configurations.
              </p>
              <p className="help-text">
                <strong>Management:</strong> Use the action icons next to items to add folders, add new hosts, edit settings, or delete entries.
              </p>
              <p className="help-text">
                <strong>Show Password:</strong> Use the password visibility toggle to reveal saved passwords in the host tree when needed.
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>Layout Mastery</summary>
            <div className="help-section-body">
              <p className="help-text">
                <strong>Flexible Tabs:</strong> Drag and drop tabs not just to reorder them, but to move them between grid panes, sidebars, or top/bottom bars.
              </p>
              <p className="help-text">
                <strong>Resizing:</strong> Resize everything by dragging the dividers or the <strong>2D intersection point</strong> (where 4 panes meet).
              </p>
              <p className="help-text">
                <strong>Empty pane hints:</strong> Empty grid cells show their pane number and a &quot;Drop Tab Here&quot; prompt so you know where to drop a tab.
              </p>
              <p className="help-text">
                <strong>Line Wrap toggle:</strong> Disable <strong>Settings &rarr; Appearance &rarr; Line Wrap</strong> to enable a horizontal scrollbar on terminal panes. The view auto-scrolls to keep the cursor in sight as you type past the right edge, and snaps back to column 0 on Enter. The vertical scrollbar and prompt marker stay anchored to the pane&apos;s right edge regardless of horizontal scroll position.
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>Copy & Paste</summary>
            <div className="help-section-body">
              <p className="help-text">
                <strong>Copy:</strong> Simply select text in the terminal or click a <strong>Terminal Marker</strong> to select an entire block. Content is automatically copied to your clipboard upon selection.
              </p>
              <p className="help-text">
                <strong>Paste:</strong> Right-click anywhere in the terminal or use <code>Ctrl + V</code>.
              </p>
              <p className="help-text">
                <strong>Safety Check:</strong> A <strong>Paste Confirmation</strong> dialog will appear if you try to paste multiple lines. This prevents accidental execution of dangerous commands.
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>Terminal Markers</summary>
            <div className="help-section-body">
              <div className="help-visual-guide">
                <div className="marker-expl">
                  <span className="marker-line marker-red" />
                  <div className="marker-desc">
                    <strong>Red/Orange line: Prompt</strong>
                    <br />Indicates where you typed a command.
                  </div>
                </div>
                <div className="marker-expl">
                  <span className="marker-line marker-blue" />
                  <div className="marker-desc">
                    <strong>Blue line: Output</strong>
                    <br />Indicates the result/output of a command.
                  </div>
                </div>
              </div>
              <p className="help-text">
                <strong>Tip:</strong> Click a marker to select the entire block. Right-click it to quickly ask AI about that specific output.
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>Session Logging & Log Viewer</summary>
            <div className="help-section-body">
              <p className="help-text">
                <strong>Session Logging:</strong> Enable automatic logging in <strong>Settings &rarr; General</strong>. All terminal output is saved as timestamped <code>.log</code> files to the folder you specify.
              </p>
              <p className="help-text">
                <strong>Log Viewer:</strong> Click the <strong>Log Viewer</strong> button in the tab bar to open a dedicated log-browsing pane. It lists all saved log files and lets you open and search them without leaving HoTTY.
              </p>
              <p className="help-text">
                <strong>Search:</strong> Use the search bar inside Log Viewer to filter lines. Toggle the <strong>.*</strong> button to switch between plain-text and regular expression search.
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>Text Editor</summary>
            <div className="help-section-body">
              <p className="help-text">
                Open a built-in text editor pane via <strong><FeaturesIcon /></strong> (Features) &rarr; <strong>&quot;Text Editor&quot;</strong>. You can open multiple editor panes and edit multiple files simultaneously using sub-tabs.
              </p>
              <ul className="shortcuts-list">
                <li><strong>File menu:</strong> New, Open, Save, Save As, and Close actions for individual sub-tabs.</li>
                <li><strong>View menu:</strong> Toggle <strong>Show Return Codes</strong> to display newline characters as visible symbols in the editor.</li>
                <li><strong>Find & Replace:</strong> Press <code>Ctrl + F</code> to open the search bar. Use <code>Ctrl + H</code> for find-and-replace. Matches are highlighted and the total count is shown.</li>
                <li><strong>Go to Line:</strong> Press <code>Ctrl + G</code> to jump to a specific line number.</li>
                <li><strong>Encoding & Line Endings:</strong> Click the encoding or line ending indicator in the status bar to change them for the current file.</li>
                <li><strong>Line Wrap:</strong> Controlled by the global <strong>Settings &rarr; Appearance &rarr; Line Wrap</strong> toggle. Visual line numbers update automatically to reflect wrapped lines.</li>
                <li><strong>File Association:</strong> Files opened from Windows Explorer (double-click or &quot;Open with&quot;) launch directly in the Text Editor.</li>
              </ul>
              <p className="help-text">
                <strong>Tip:</strong> An unsaved file shows a <code>&bull;</code> dot on its sub-tab title. Save with <code>Ctrl + S</code>.
              </p>
              <p className="help-text">
                <strong>Unsaved changes prompt:</strong> Closing a sub-tab or exiting with dirty editors opens a <strong>Save / Discard / Cancel</strong> dialog so you never lose work by accident.
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>File Explorer</summary>
            <div className="help-section-body">
              <p className="help-text">
                Open a built-in file browser pane via <strong><FeaturesIcon /></strong> (Features) &rarr; <strong>&quot;File Explorer&quot;</strong>. Browse your drives and directories in a collapsible tree structure.
              </p>
              <ul className="shortcuts-list">
                <li><strong>Navigate:</strong> Click folders to expand/collapse. Use the breadcrumb path at the top for quick navigation.</li>
                <li><strong>Open files:</strong> Double-click a file to open it in the Text Editor.</li>
                <li><strong>Hidden files:</strong> Toggle hidden file visibility with the eye icon in the toolbar.</li>
                <li><strong>Refresh:</strong> Click the refresh button to reload the current directory.</li>
              </ul>
            </div>
          </details>

          <details className="help-section" open>
            <summary>AI Quick Start Guide</summary>
            <div className="help-section-body">
              <p className="help-text">
                HoTTY has built-in AI that can analyze terminal output, explain errors, suggest fixes, and even execute commands for you. Here&apos;s how to get started in 3 steps:
              </p>
              <ol className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: 0 }}>
                <li>
                  <strong>Choose a provider:</strong> Go to <strong>Settings &rarr; AI &rarr; AI Provider</strong> and select one. <strong>Google AI Studio (Gemini)</strong> or <strong>Vertex AI</strong> are recommended — see the comparison table below.
                </li>
                <li>
                  <strong>Authenticate:</strong> Open an AI Chat tab (<strong><FeaturesIcon /></strong> &rarr; AI Chat) and follow the on-screen prompts to sign in or enter your credentials.
                </li>
                <li>
                  <strong>Start chatting:</strong> Type a question, or right-click on terminal text and choose <strong>&quot;Ask AI&quot;</strong> to get instant analysis.
                </li>
              </ol>
              <p className="help-text" style={{ marginTop: '6px' }}>
                That&apos;s it! You can start asking questions right away — no complex configuration needed.
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>AI Features Overview</summary>
            <div className="help-section-body">
              <p className="help-text" style={{ marginBottom: '4px' }}><strong>AI Chat</strong></p>
              <p className="help-text">
                Click <strong><FeaturesIcon /></strong> (Features) in the tab bar &rarr; <strong>&quot;AI Chat&quot;</strong> to open the AI Chat pane. Inside it, the tab strip at the top lets you keep multiple parallel conversations — use <strong>+ New chat</strong> to start a fresh tab. Type your question and press <code>Ctrl + Enter</code> to send.
              </p>
              <p className="help-text">
                <strong>Linked terminal:</strong> When you start AI Monitor on a terminal, the AI Chat pane links a tab to that terminal automatically — toggling AI Monitor on additional terminals creates a new tab per terminal so output streams stay separated. The currently linked terminal is shown as a chip next to the input. Clicking a tab also briefly highlights its linked terminal pane so you can see which session it belongs to at a glance.
              </p>
              <p className="help-text">
                <strong>Stream watchdog:</strong> If an AI provider stops sending data mid-response (network drop, hung backend), the in-flight request is automatically cancelled after 3 minutes of silence and an error message appears in the chat — no more stuck &quot;streaming&quot; states.
              </p>

              <p className="help-text" style={{ marginBottom: '4px' }}><strong>Ask AI (Right-Click)</strong></p>
              <p className="help-text">
                Select text in the terminal or click a <strong>Terminal Marker</strong>, then right-click &rarr; <strong>&quot;Ask AI&quot;</strong>. Choose from built-in commands like &quot;What is this?&quot;, &quot;Research root cause&quot;, or &quot;Fix this&quot; — or add your own custom commands in Settings.
              </p>

              <p className="help-text" style={{ marginBottom: '4px' }}><strong>Interactive Mode (Command Execution)</strong></p>
              <p className="help-text">
                When the AI suggests a command, it can send it directly to your terminal session for execution. You&apos;ll see the command before it runs, so you stay in control.
              </p>

              <p className="help-text" style={{ marginBottom: '4px' }}><strong>Execution Mode &amp; Auto-Execute</strong></p>
              <p className="help-text">
                The <strong>Execution Mode chip</strong> at the bottom of the AI Chat pane controls how AI-suggested commands run — choose between Ask, Auto-execute safe, or Pause. When Auto-execute is on, read-only commands (ls, cat, show, ping, etc.) run automatically after the AI responds; destructive or unknown commands still require manual confirmation. Pause halts the auto-run loop without changing the mode, and the chip&apos;s controls let you resume. Configure the safe command whitelist, consecutive execution limit, and the <strong>device-response idle timeout</strong> (default 10 seconds; 0 disables) in <strong>Settings &rarr; AI &rarr; Command Execution Mode</strong>.
              </p>

              <p className="help-text" style={{ marginBottom: '4px' }}><strong>Personas</strong></p>
              <p className="help-text">
                Switch between AI roles (General Helper, Network Expert, Security Analyst, etc.) using the persona selector at the top of the chat. Each persona has a system prompt tailored for that domain. Click the <strong>system prompt</strong> indicator to inspect the exact instruction sent to the model and copy it to the clipboard.
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary><WatchIcon /> Watch Mode (AI Monitoring)</summary>
            <div className="help-section-body">
              <p className="help-text">
                Watch Mode lets AI monitor a terminal session&apos;s output and analyze it on demand — ideal for long-running commands or log tailing.
              </p>
              <ol className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: 0 }}>
                <li>Click the <strong><WatchIcon /></strong> icon on any terminal tab to start watching. The icon turns blue and the tab gets a rainbow highlight.</li>
                <li>Run commands as usual. All output is captured into a buffer.</li>
                <li>In your <strong>AI chat tab</strong>, click <strong>&quot;Ask AI&quot;</strong> and select the watched session to send the entire captured log to AI for analysis.</li>
              </ol>
              <p className="help-text">
                <strong>Tip:</strong> Let it collect output and ask AI to summarize or find errors when you&apos;re ready.
                The buffer size limit can be adjusted in <strong>Settings &rarr; AI &rarr; AI Monitor Buffer Limit</strong>.
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>Choosing an AI Provider</summary>
            <div className="help-section-body">
              <p className="help-text">
                HoTTY supports four AI providers. Choose the one that best fits your needs:
              </p>
              <table className="help-auth-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'calc(var(--font-size-base) - 1px)', marginBottom: '8px' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', paddingBottom: '6px', borderBottom: '1px solid var(--border-color)', paddingRight: '8px' }}>Provider</th>
                    <th style={{ textAlign: 'left', paddingBottom: '6px', borderBottom: '1px solid var(--border-color)', paddingRight: '8px' }}>Best For</th>
                    <th style={{ textAlign: 'left', paddingBottom: '6px', borderBottom: '1px solid var(--border-color)', paddingRight: '8px' }}>Auth</th>
                    <th style={{ textAlign: 'left', paddingBottom: '6px', borderBottom: '1px solid var(--border-color)' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}><strong>Google AI Studio<br />(Gemini)</strong></td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>Personal use, free tier available</td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>OAuth2</td>
                    <td style={{ padding: '6px 0', verticalAlign: 'top' }}>Fully tested</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}><strong>Google Cloud<br />Vertex AI</strong></td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>Enterprise / production use</td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>ADC / Service Account</td>
                    <td style={{ padding: '6px 0', verticalAlign: 'top' }}>Fully tested</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}><strong>Anthropic<br />(Claude)</strong></td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>Claude models via API key</td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>API Key</td>
                    <td style={{ padding: '6px 0', verticalAlign: 'top' }}>Experimental<br /><span style={{ fontSize: 'calc(var(--font-size-base) - 2px)', opacity: 0.8 }}>(untested — may not work as expected)</span></td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}><strong>OpenAI</strong></td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>GPT models via API key</td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>API Key</td>
                    <td style={{ padding: '6px 0', verticalAlign: 'top' }}>Experimental<br /><span style={{ fontSize: 'calc(var(--font-size-base) - 2px)', opacity: 0.8 }}>(untested — may not work as expected)</span></td>
                  </tr>
                </tbody>
              </table>
              <p className="help-text">
                <strong>Recommendation:</strong> If you&apos;re unsure, start with <strong>Google AI Studio (Gemini)</strong> — it has a free tier and is the most thoroughly tested provider.
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>AI Setup & Authentication</summary>
            <div className="help-section-body">

              <p className="help-text" style={{ marginBottom: '2px' }}><strong>Google AI Studio (Gemini) — OAuth2 Setup</strong></p>
              <ol className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: '0 0 10px 0' }}>
                <li>Go to Google Cloud Console &rarr; APIs & Services &rarr; Credentials.</li>
                <li>Create an <strong>OAuth 2.0 Client ID</strong> (Desktop application type).</li>
                <li>In HoTTY, select <strong>Google AI Studio</strong> as your provider, open an AI Chat tab, and enter your Client ID and Client Secret.</li>
                <li>Click <strong>&quot;Sign in with Google&quot;</strong> — a browser window will open for authorization.</li>
              </ol>
              <p className="help-text" style={{ marginBottom: '10px' }}>
                Free-tier accounts may have data used for model training. Enable billing on your Google Cloud project to opt out.
              </p>

              <p className="help-text" style={{ marginBottom: '2px' }}><strong>Google Cloud Vertex AI — ADC or Service Account</strong></p>
              <ol className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: '0 0 10px 0' }}>
                <li><strong>ADC (easiest):</strong> Install the Google Cloud CLI, then run:<br /><code>gcloud auth application-default login</code><br />HoTTY detects these credentials automatically.</li>
                <li><strong>Service Account:</strong> Download a JSON key file from Google Cloud Console &rarr; IAM &rarr; Service Accounts, then provide the file path in Settings.</li>
                <li>Enter your <strong>Google Cloud Project ID</strong> and select a <strong>Region</strong> in the AI Chat tab.</li>
              </ol>

              <p className="help-text" style={{ marginBottom: '2px' }}><strong>Anthropic (Claude) — API Key</strong> <span style={{ fontSize: 'calc(var(--font-size-base) - 2px)', opacity: 0.7 }}>( Experimental)</span></p>
              <ol className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: '0 0 4px 0' }}>
                <li>Obtain an API key from the Anthropic Console &rarr; API Keys.</li>
                <li>In HoTTY, select <strong>Anthropic</strong> as your provider, open an AI Chat tab, and enter your API key.</li>
              </ol>
              <p className="help-text" style={{ marginBottom: '10px' }}>
                This provider is experimental and has not been fully tested. Some features (Watch Mode, Interactive Mode, etc.) may not work as expected. Please report any issues you encounter.
              </p>

              <p className="help-text" style={{ marginBottom: '2px' }}><strong>OpenAI — API Key</strong> <span style={{ fontSize: 'calc(var(--font-size-base) - 2px)', opacity: 0.7 }}>( Experimental)</span></p>
              <ol className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: '0 0 4px 0' }}>
                <li>Obtain an API key from the OpenAI Platform &rarr; API Keys.</li>
                <li>In HoTTY, select <strong>OpenAI</strong> as your provider, open an AI Chat tab, and enter your API key.</li>
              </ol>
              <p className="help-text" style={{ marginBottom: '10px' }}>
                This provider is experimental and has not been fully tested. Some features (Watch Mode, Interactive Mode, etc.) may not work as expected. Please report any issues you encounter.
              </p>

              <p className="help-text">
                All credentials are encrypted with Windows DPAPI and stored locally — they are never transmitted outside your machine except to the respective AI provider.
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>Customizing AI Commands & Personas</summary>
            <div className="help-section-body">
              <p className="help-text">
                <strong>Custom Ask AI Commands:</strong> In <strong>Settings &rarr; AI &rarr; Ask AI Commands</strong>, add, edit, reorder, or delete the commands that appear in the right-click context menu. Use the <code>{'{selection}'}</code> placeholder to inject the selected text into your prompt template.
              </p>
              <p className="help-text">
                <strong>Custom Personas:</strong> In <strong>Settings &rarr; AI &rarr; Personas</strong>, create personas with custom system prompts. The chosen persona is applied as the initial system instruction for every new AI chat session.
              </p>
              <p className="help-text">
                <strong>Proactive Investigation:</strong> The AI automatically suggests terminal commands when it needs more information to fulfill your request, and can capture results for continued analysis in Watch Mode.
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>Themes & Appearance</summary>
            <div className="help-section-body">
              <p className="help-text">
                Switch between built-in themes (<strong>Dark</strong>, <strong>Medium</strong>, <strong>Light</strong>) in <strong>Settings &rarr; Appearance &rarr; Theme</strong>.
              </p>
              <p className="help-text">
                <strong>Custom Themes:</strong> Click <strong>&quot;+ Create Custom Theme&quot;</strong> to open the theme editor. Adjust any color variable and save under a custom name. Custom themes can be edited or deleted at any time.
              </p>
              <p className="help-text">
                <strong>AI Provider Colors:</strong> The theme editor includes an <strong>AI Providers</strong> section for customizing the brand colors used by the Gemini, OpenAI, Anthropic, and Vertex AI icons.
              </p>
              <p className="help-text">
                <strong>Futuristic Effects:</strong> The theme editor&apos;s <strong>Futuristic Effects</strong> section adds optional neon glow on active panes and sidebar icons, glassmorphism backdrop blur on modals, and configurable icon stroke width.
              </p>
              <p className="help-text">
                <strong>Unused Pane Background:</strong> In <strong>Settings &rarr; Appearance</strong>, choose a solid color or custom image to show in empty grid panes.
              </p>
            </div>
          </details>

        </div>
      </div>
    </div>
  );
}
