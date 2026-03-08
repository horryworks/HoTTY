import React from 'react';

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
                    <details className="help-section" open>
                        <summary>🚀 Getting Started</summary>
                        <div className="help-section-body">
                            <p className="help-text">
                                Open the connection dialog via <code>Ctrl + N</code> or the <strong>"New"</strong> button in the sidebar. You can manage your hosts and folders in the host tree.
                            </p>
                            <p className="help-text">
                                💡 <strong>Double-click:</strong> Double-click a host in the tree to connect immediately.
                            </p>
                        </div>
                    </details>

                    <details className="help-section" open>
                        <summary>🌳 Organizing the Host Tree</summary>
                        <div className="help-section-body">
                            <p className="help-text">
                                <strong>Drag & Drop:</strong> You can reorder hosts and folders by dragging them in the "New Connection" dialog.
                            </p>
                            <p className="help-text" style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                📦 <strong>Export & Import:</strong> Use the
                                <span className="help-icon-wrapper" style={{ color: '#ff6b6b' }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="17 8 12 3 7 8"></polyline>
                                        <line x1="12" y1="3" x2="12" y2="15"></line>
                                    </svg>
                                </span>
                                <strong>Export</strong> and
                                <span className="help-icon-wrapper" style={{ color: '#51cf66' }}>
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

                    <details className="help-section" open>
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

                    <details className="help-section" open>
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

                    <details className="help-section" open>
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

                    <details className="help-section" open>
                        <summary>✨ Ask Gemini & Watch Gemini</summary>
                        <div className="help-section-body">
                            <p className="help-text">
                                <strong>AI Chat Window:</strong> Click the ✨ icon in the top-left of the Tab Bar area to open the integrated AI Chat window.
                            </p>
                            <p className="help-text">
                                <strong>Ask Gemini:</strong> Right-click on selected text or a <strong>Terminal Marker</strong> to open the context menu and select "Ask Gemini".
                            </p>
                            <p className="help-text">
                                👁️ <strong>Watch Mode:</strong> Toggle the "Watch" icon on a tab to record all terminal output into a dedicated buffer.
                                Click <strong>"✨ Ask Gemini"</strong> on the tab to analyze the entire captured log at once—perfect for troubleshooting long commands or logs.
                            </p>
                            <p className="help-text small">
                                🔗 <strong>Configuration:</strong> To use OAuth2 authentication, follow the <a href="https://ai.google.dev/gemini-api/docs/oauth" target="_blank" rel="noreferrer">Official Google Guide</a> to obtain your Client ID and Client Secret.
                            </p>
                        </div>
                    </details>

                    <details className="help-section" open>
                        <summary>⌨️ Shortcuts</summary>
                        <div className="help-section-body">
                            <ul className="shortcuts-list">
                                <li><code>Ctrl + N</code> New Connection Dialog</li>
                                <li><code>Ctrl + W</code> Close current tab</li>
                                <li><code>Ctrl + C</code> Clear selection / Send SIGINT</li>
                                <li><code>Ctrl + V</code> Paste to terminal (with security check)</li>
                            </ul>
                        </div>
                    </details>
                </div>
            </div>
        </div>
    );
};

export default HelpModal;
