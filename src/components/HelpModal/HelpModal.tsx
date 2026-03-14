import React from 'react';

// Gemini diamond icon — gradient fill (matches Features menu in TabBar)
const GeminiIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline', verticalAlign: 'middle', marginInline: '2px' }}>
        <path d="M13.5 3.5C14.3 6.9 16.9 9.5 20.3 10.5C21.9 10.9 21.9 13.1 20.3 13.5C16.9 14.5 14.3 17.1 13.5 20.5C13.1 22.1 10.9 22.1 10.5 20.5C9.7 17.1 7.1 14.5 3.7 13.5C2.1 13.1 2.1 10.9 3.7 10.5C7.1 9.5 9.7 6.9 10.5 3.5C10.9 1.9 13.1 1.9 13.5 3.5Z" fill="url(#help-gemini-gradient)" />
        <defs>
            <linearGradient id="help-gemini-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#4E86F8" />
                <stop offset="100%" stopColor="#D64669" />
            </linearGradient>
        </defs>
    </svg>
);

// Gemini diamond icon — monochrome (matches tab Watch button in TabBar)
const GeminiWatchIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline', verticalAlign: 'middle', marginInline: '2px', color: 'var(--text-color)' }}>
        <path d="M13.5 3.5C14.3 6.9 16.9 9.5 20.3 10.5C21.9 10.9 21.9 13.1 20.3 13.5C16.9 14.5 14.3 17.1 13.5 20.5C13.1 22.1 10.9 22.1 10.5 20.5C9.7 17.1 7.1 14.5 3.7 13.5C2.1 13.1 2.1 10.9 3.7 10.5C7.1 9.5 9.7 6.9 10.5 3.5C10.9 1.9 13.1 1.9 13.5 3.5Z" fill="currentColor" />
    </svg>
);

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-modal help-modal" onClick={e => e.stopPropagation()}>
                <div className="settings-header">
                    <div className="settings-title">
                        <span className="settings-title-en">Help & Documentation</span>
                    </div>
                    <button className="settings-close" onClick={onClose}>
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor" />
                        </svg>
                    </button>
                </div>

                <div className="settings-content help-content">

                    {/* ── Shortcuts (promoted to top) ── */}
                    <details className="help-section" open>
                        <summary>⌨️ Shortcuts</summary>
                        <div className="help-section-body">
                            <ul className="shortcuts-list">
                                <li><code>Ctrl + N</code> New Session Dialog</li>
                                <li><code>Ctrl + W</code> Close current tab</li>
                                <li><code>Ctrl + C</code> Clear selection / Send SIGINT</li>
                                <li><code>Ctrl + V</code> Paste to terminal (with security check)</li>
                                <li><code>Ctrl + Enter</code> Send message in Ask Gemini dialog</li>
                                <li><code>Escape</code> Close modal / dialog</li>
                            </ul>
                        </div>
                    </details>

                    {/* ── Getting Started ── */}
                    <details className="help-section" open>
                        <summary>🚀 Getting Started</summary>
                        <div className="help-section-body">
                            <p className="help-text">
                                Open the connection dialog via <code>Ctrl + N</code> or the <strong>"New"</strong> button in the sidebar. You can manage your hosts and folders in the host tree.
                            </p>
                            <p className="help-text">
                                💡 <strong>Double-click:</strong> Double-click a host in the tree to connect immediately.
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
                            </ul>
                        </div>
                    </details>

                    {/* ── Organizing the Host Tree ── */}
                    <details className="help-section">
                        <summary>🌳 Organizing the Host Tree</summary>
                        <div className="help-section-body">
                            <p className="help-text">
                                <strong>Drag & Drop:</strong> You can reorder hosts and folders by dragging them in the "New Session" dialog.
                            </p>
                            <p className="help-text" style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                📦 <strong>Export & Import:</strong> Use the
                                <span className="help-icon-wrapper" style={{ color: 'var(--color-danger)' }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="17 8 12 3 7 8"></polyline>
                                        <line x1="12" y1="3" x2="12" y2="15"></line>
                                    </svg>
                                </span>
                                <strong>Export</strong> and
                                <span className="help-icon-wrapper" style={{ color: 'var(--success-color)' }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="7 10 12 15 17 10"></polyline>
                                        <line x1="12" y1="15" x2="12" y2="3"></line>
                                    </svg>
                                </span>
                                <strong>Import</strong> icons at the top-right of the host panel to backup or load your configurations.
                            </p>
                            <p className="help-text">
                                <strong>Management:</strong> Use the action icons next to items to add folders, add new hosts, edit settings, or delete entries.
                            </p>
                        </div>
                    </details>

                    {/* ── Layout Mastery ── */}
                    <details className="help-section">
                        <summary>🧩 Layout Mastery</summary>
                        <div className="help-section-body">
                            <p className="help-text">
                                <strong>Flexible Tabs:</strong> Drag and drop tabs not just to reorder them, but to move them between grid panes, sidebars, or top/bottom bars.
                            </p>
                            <p className="help-text">
                                <strong>Resizing:</strong> Resize everything by dragging the dividers or the <strong>2D intersection point</strong> (where 4 panes meet).
                            </p>
                        </div>
                    </details>

                    {/* ── Copy & Paste ── */}
                    <details className="help-section">
                        <summary>📋 Copy & Paste</summary>
                        <div className="help-section-body">
                            <p className="help-text">
                                <strong>Copy:</strong> Simply select text in the terminal or click a <strong>Terminal Marker</strong> to select an entire block. Content is automatically copied to your clipboard upon selection.
                            </p>
                            <p className="help-text">
                                <strong>Paste:</strong> Right-click anywhere in the terminal or use <code>Ctrl + V</code>.
                            </p>
                            <p className="help-text">
                                🛡️ <strong>Safety Check:</strong> A <strong>Paste Confirmation</strong> dialog will appear if you try to paste multiple lines. This prevents accidental execution of dangerous commands.
                            </p>
                        </div>
                    </details>

                    {/* ── Terminal Markers ── */}
                    <details className="help-section">
                        <summary>👁️ Terminal Markers</summary>
                        <div className="help-section-body">
                            <div className="help-visual-guide">
                                <div className="marker-expl">
                                    <span className="marker-line marker-red"></span>
                                    <div className="marker-desc">
                                        <strong>Red/Orange line: Prompt</strong>
                                        <br />Indicates where you typed a command.
                                    </div>
                                </div>
                                <div className="marker-expl">
                                    <span className="marker-line marker-blue"></span>
                                    <div className="marker-desc">
                                        <strong>Blue line: Output</strong>
                                        <br />Indicates the result/output of a command.
                                    </div>
                                </div>
                            </div>
                            <p className="help-text small">
                                💡 <strong>Tip:</strong> Click a marker to select the entire block. Right-click it to quickly ask Gemini about that specific output.
                            </p>
                        </div>
                    </details>

                    {/* ── Session Logging & Log Viewer ── */}
                    <details className="help-section">
                        <summary>📁 Session Logging & Log Viewer</summary>
                        <div className="help-section-body">
                            <p className="help-text">
                                <strong>Session Logging:</strong> Enable automatic logging in <strong>Settings → System</strong>. All terminal output is saved as timestamped <code>.log</code> files to the folder you specify.
                            </p>
                            <p className="help-text">
                                <strong>Log Viewer:</strong> Click the <strong>Log Viewer</strong> button in the tab bar to open a dedicated log-browsing pane. It lists all saved log files and lets you open and search them without leaving HoTTY.
                            </p>
                            <p className="help-text small">
                                💡 <strong>Search:</strong> Use the search bar inside Log Viewer to filter lines. Toggle the <strong>.*</strong> button to switch between plain-text and regular expression search.
                            </p>
                        </div>
                    </details>

                    {/* ── Gemini AI Chat ── */}
                    <details className="help-section" open>
                        <summary><GeminiIcon /> Gemini AI Chat</summary>
                        <div className="help-section-body">
                            <p className="help-text">
                                <strong>Open AI Chat:</strong> Click the <strong><GeminiIcon /></strong> icon in the tab bar (Features menu) to open a new Gemini AI chat tab. Multiple AI chat tabs can be open simultaneously.
                            </p>
                            <p className="help-text">
                                <strong>Ask Gemini:</strong> Right-click on selected text or a <strong>Terminal Marker</strong> to open the context menu and select "Ask Gemini". Choose from built-in commands ("What is this?", "Research root cause", etc.) or your own custom commands.
                            </p>
                            <p className="help-text">
                                <strong>Personas:</strong> In the AI chat tab, use the persona selector to switch between AI roles (General Helper, Network Expert, Security Analyst, etc.). Each persona uses a different system prompt optimized for that domain.
                            </p>
                            <p className="help-text small">
                                🔗 <strong>First-time setup:</strong> Authenticate with your Google Account in <strong>Settings → AI</strong>. For OAuth2 setup, follow the <a href="https://ai.google.dev/gemini-api/docs/oauth" target="_blank" rel="noreferrer">Official Google Guide</a> to obtain your Client ID and Client Secret.
                            </p>
                        </div>
                    </details>

                    {/* ── Watch Mode ── */}
                    <details className="help-section">
                        <summary><GeminiWatchIcon /> Watch Mode (AI Monitoring)</summary>
                        <div className="help-section-body">
                            <p className="help-text">
                                Watch Mode lets Gemini monitor a terminal session's output and analyze it on demand.
                            </p>
                            <ol className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: 0 }}>
                                <li>Click the <strong><GeminiWatchIcon /></strong> icon on any terminal tab to start watching. The icon turns blue and the tab gets a rainbow highlight.</li>
                                <li>Run commands as usual. All output is captured into a buffer.</li>
                                <li>In your <strong>AI chat tab</strong>, click <strong>"Ask Gemini"</strong> and select the watched session to send the entire captured log to Gemini for analysis.</li>
                            </ol>
                            <p className="help-text small">
                                💡 <strong>Tip:</strong> Ideal for troubleshooting long-running commands or tailing logs—let it collect output and ask Gemini to summarize or find errors when you're ready.
                                The buffer size limit can be adjusted in <strong>Settings → AI → Watch Buffer Limit</strong>.
                            </p>
                        </div>
                    </details>

                    {/* ── Customizing AI Commands & Personas ── */}
                    <details className="help-section">
                        <summary>🛠️ Customizing AI Commands & Personas</summary>
                        <div className="help-section-body">
                            <p className="help-text">
                                <strong>Custom Ask Gemini Commands:</strong> In <strong>Settings → AI → Ask Gemini Commands</strong>, add, edit, reorder, or delete the commands that appear in the right-click context menu. Use the <code>{'{selection}'}</code> placeholder to inject the selected text into your prompt template.
                            </p>
                            <p className="help-text">
                                <strong>Custom Personas:</strong> In <strong>Settings → AI → Personas</strong>, create personas with custom system prompts. The chosen persona is applied as the initial system instruction for every new AI chat session.
                            </p>
                            <p className="help-text">
                                <strong>Proactive Investigation:</strong> In <strong>Settings → AI</strong>, set a standing instruction that Gemini applies proactively when analyzing terminal output in Watch Mode.
                            </p>
                        </div>
                    </details>

                    {/* ── Themes ── */}
                    <details className="help-section">
                        <summary>🎨 Themes & Appearance</summary>
                        <div className="help-section-body">
                            <p className="help-text">
                                Switch between built-in themes (<strong>Dark</strong>, <strong>Medium</strong>, <strong>Light</strong>) in <strong>Settings → Appearance → Theme</strong>.
                            </p>
                            <p className="help-text">
                                <strong>Custom Themes:</strong> Click <strong>"+ Create Custom Theme"</strong> to open the theme editor. Adjust any color variable and save under a custom name. Custom themes can be edited or deleted at any time.
                            </p>
                        </div>
                    </details>

                </div>
            </div>
        </div>
    );
};

export default HelpModal;
