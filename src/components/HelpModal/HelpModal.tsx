import type React from 'react';
import { useTranslation, Trans } from 'react-i18next';
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
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <span>{t('help.title')}</span>
          <button className="help-modal-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div className="settings-modal-body help-content">

          <details className="help-section" open>
            <summary>{t('help.shortcuts.summary')}</summary>
            <div className="help-section-body">
              <ul className="shortcuts-list">
                <li><code>Ctrl + N</code> {t('help.shortcuts.newSession')}</li>
                <li><code>Ctrl + Shift + N</code> {t('help.shortcuts.newWindow')}</li>
                <li><code>Ctrl + Tab</code> {t('help.shortcuts.focusNext')}</li>
                <li><code>Ctrl + Shift + Tab</code> {t('help.shortcuts.focusPrev')}</li>
                <li><code>Ctrl + W</code> {t('help.shortcuts.closeTab')}</li>
                <li><code>Ctrl + C</code> {t('help.shortcuts.clearOrSigint')}</li>
                <li><code>Ctrl + V</code> {t('help.shortcuts.paste')}</li>
                <li><code>Ctrl + Enter</code> {t('help.shortcuts.sendMessage')}</li>
                <li><code>Escape</code> {t('help.shortcuts.closeModal')}</li>
              </ul>
            </div>
          </details>

          <details className="help-section" open>
            <summary>{t('help.gettingStarted.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                <Trans i18nKey="help.gettingStarted.openDialog" components={[<code key="0" />, <strong key="1" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.gettingStarted.doubleClick" components={[<strong key="0" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.gettingStarted.supportedTypes" components={[<strong key="0" />]} />
              </p>
              <ul className="shortcuts-list">
                <li><Trans i18nKey="help.gettingStarted.typeSsh" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.gettingStarted.typeTelnet" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.gettingStarted.typeSerial" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.gettingStarted.typeWsl" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.gettingStarted.typeLocal" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.gettingStarted.typeGitBash" components={[<strong key="0" />]} /></li>
              </ul>
              <p className="help-text">
                <Trans i18nKey="help.gettingStarted.jumpbox" components={[<strong key="0" />]} />
              </p>
              <p className="help-text">
                <Trans
                  i18nKey="help.gettingStarted.gcpIap"
                  components={[
                    <strong key="0" />,
                    <strong key="1" />,
                    <strong key="2" />,
                    <strong key="3" />,
                    <strong key="4" />,
                    <strong key="5" />,
                    <strong key="6" />,
                    <strong key="7" />,
                    <code key="8" />,
                    <code key="9" />,
                    <code key="10" />,
                  ]}
                />
              </p>
              <p className="help-text">
                <Trans
                  i18nKey="help.gettingStarted.gcpSshUser"
                  components={[
                    <strong key="0" />,
                    <strong key="1" />,
                    <code key="2" />,
                    <code key="3" />,
                  ]}
                />
              </p>
              <p className="help-text">
                <Trans
                  i18nKey="help.gettingStarted.gcpFiltering"
                  components={[<strong key="0" />, <code key="1" />, <code key="2" />]}
                />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.gettingStarted.updateNotifications" components={[<strong key="0" />]} />
              </p>
              <p className="help-text">
                <Trans
                  i18nKey="help.gettingStarted.connectionStatus"
                  components={[
                    <strong key="0" />,
                    <strong key="1" />,
                    <em key="2" />,
                    <em key="3" />,
                    <em key="4" />,
                    <em key="5" />,
                    <em key="6" />,
                    <em key="7" />,
                  ]}
                />
              </p>
              <p className="help-text">
                <Trans
                  i18nKey="help.gettingStarted.sshAlgorithms"
                  components={[
                    <strong key="0" />,
                    <strong key="1" />,
                    <code key="2" />,
                    <code key="3" />,
                    <code key="4" />,
                    <code key="5" />,
                    <code key="6" />,
                    <code key="7" />,
                  ]}
                />
              </p>
              <p className="help-text">
                {t('help.gettingStarted.algorithmsMerge')}
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.hostTree.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                <Trans i18nKey="help.hostTree.dragDrop" components={[<strong key="0" />]} />
              </p>
              <p className="help-text" style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                <Trans i18nKey="help.hostTree.exportImportPrefix" components={[<strong key="0" />]} />
                <span style={{ color: 'var(--color-danger)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </span>
                <Trans i18nKey="help.hostTree.exportLabel" components={[<strong key="0" />]} />
                {' '}
                <span style={{ color: 'var(--success-color)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </span>
                <Trans i18nKey="help.hostTree.importLabel" components={[<strong key="0" />]} />
                {' '}
                {t('help.hostTree.exportImportSuffix')}
              </p>
              <p className="help-text">
                <Trans i18nKey="help.hostTree.management" components={[<strong key="0" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.hostTree.showPassword" components={[<strong key="0" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.hostTree.newConnection" components={[<strong key="0" />]} />
              </p>
              <p className="help-text">
                <Trans
                  i18nKey="help.hostTree.saveAdHoc"
                  components={[<strong key="0" />, <strong key="1" />, <strong key="2" />, <strong key="3" />]}
                />
              </p>
              <p className="help-text">
                <Trans
                  i18nKey="help.hostTree.openAll"
                  components={[<strong key="0" />, <strong key="1" />]}
                />
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.layout.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                <Trans i18nKey="help.layout.flexibleTabs" components={[<strong key="0" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.layout.resizing" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.layout.emptyPaneHints" components={[<strong key="0" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.layout.lineWrap" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.layout.fixedTerminalSize" components={[<strong key="0" />, <strong key="1" />, <strong key="2" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.layout.multiWindow" components={[<strong key="0" />, <strong key="1" />, <code key="2" />]} />
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.copyPaste.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                <Trans i18nKey="help.copyPaste.copy" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.copyPaste.paste" components={[<strong key="0" />, <code key="1" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.copyPaste.safety" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.markers.summary')}</summary>
            <div className="help-section-body">
              <div className="help-visual-guide">
                <div className="marker-expl">
                  <span className="marker-line marker-red" />
                  <div className="marker-desc">
                    <strong>{t('help.markers.redTitle')}</strong>
                    <br />{t('help.markers.redDesc')}
                  </div>
                </div>
                <div className="marker-expl">
                  <span className="marker-line marker-blue" />
                  <div className="marker-desc">
                    <strong>{t('help.markers.blueTitle')}</strong>
                    <br />{t('help.markers.blueDesc')}
                  </div>
                </div>
              </div>
              <p className="help-text">
                <Trans i18nKey="help.markers.tip" components={[<strong key="0" />]} />
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.logging.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                <Trans i18nKey="help.logging.sessionLogging" components={[<strong key="0" />, <strong key="1" />, <code key="2" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.logging.folderApproval" components={[<strong key="0" />, <strong key="1" />, <code key="2" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.logging.logViewer" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.logging.search" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.textEditor.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                <Trans i18nKey="help.textEditor.intro" components={[<strong key="0" />, <FeaturesIcon key="1" />, <strong key="2" />]} />
              </p>
              <ul className="shortcuts-list">
                <li><Trans i18nKey="help.textEditor.fileMenu" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.textEditor.viewMenu" components={[<strong key="0" />, <strong key="1" />]} /></li>
                <li><Trans i18nKey="help.textEditor.findReplace" components={[<strong key="0" />, <code key="1" />, <code key="2" />]} /></li>
                <li><Trans i18nKey="help.textEditor.gotoLine" components={[<strong key="0" />, <code key="1" />]} /></li>
                <li><Trans i18nKey="help.textEditor.encoding" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.textEditor.lineWrap" components={[<strong key="0" />, <strong key="1" />]} /></li>
                <li><Trans i18nKey="help.textEditor.fileAssociation" components={[<strong key="0" />]} /></li>
              </ul>
              <p className="help-text">
                <Trans i18nKey="help.textEditor.tip" components={[<strong key="0" />, <code key="1" />, <code key="2" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.textEditor.unsavedPrompt" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.fileExplorer.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                <Trans i18nKey="help.fileExplorer.intro" components={[<strong key="0" />, <FeaturesIcon key="1" />, <strong key="2" />]} />
              </p>
              <ul className="shortcuts-list">
                <li><Trans i18nKey="help.fileExplorer.navigate" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.fileExplorer.openFiles" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.fileExplorer.hiddenFiles" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.fileExplorer.refresh" components={[<strong key="0" />]} /></li>
              </ul>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.fileServer.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                <Trans i18nKey="help.fileServer.intro" components={[<strong key="0" />, <FeaturesIcon key="1" />, <strong key="2" />]} />
              </p>
              <ul className="shortcuts-list">
                <li><Trans i18nKey="help.fileServer.serve" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.fileServer.tftp" components={[<strong key="0" />, <code key="1" />, <strong key="2" />]} /></li>
                <li><Trans i18nKey="help.fileServer.sftp" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.fileServer.firewall" components={[<strong key="0" />, <strong key="1" />]} /></li>
                <li><Trans i18nKey="help.fileServer.security" components={[<strong key="0" />]} /></li>
              </ul>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.webBrowser.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                <Trans i18nKey="help.webBrowser.intro" components={[<strong key="0" />, <strong key="1" />, <strong key="2" />]} />
              </p>
              <ul className="shortcuts-list">
                <li><Trans i18nKey="help.webBrowser.bookmarks" components={[<strong key="0" />, <strong key="1" />]} /></li>
                <li><Trans i18nKey="help.webBrowser.openAll" components={[<strong key="0" />, <strong key="1" />, <strong key="2" />]} /></li>
                <li><Trans i18nKey="help.webBrowser.star" components={[<strong key="0" />, <strong key="1" />]} /></li>
                <li><Trans i18nKey="help.webBrowser.toolbar" components={[<strong key="0" />, <code key="1" />, <code key="2" />, <code key="3" />]} /></li>
                <li><Trans i18nKey="help.webBrowser.passwords" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.webBrowser.clearData" components={[<strong key="0" />]} /></li>
                <li><Trans i18nKey="help.webBrowser.enable" components={[<strong key="0" />, <strong key="1" />]} /></li>
              </ul>
            </div>
          </details>

          <details className="help-section" open>
            <summary>{t('help.aiQuickStart.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                {t('help.aiQuickStart.intro')}
              </p>
              <ol className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: 0 }}>
                <li>
                  <Trans i18nKey="help.aiQuickStart.step1" components={[<strong key="0" />, <strong key="1" />, <strong key="2" />, <strong key="3" />]} />
                </li>
                <li>
                  <Trans i18nKey="help.aiQuickStart.step2" components={[<strong key="0" />, <strong key="1" />]} />
                </li>
                <li>
                  <Trans i18nKey="help.aiQuickStart.step3" components={[<strong key="0" />, <strong key="1" />]} />
                </li>
              </ol>
              <p className="help-text" style={{ marginTop: '6px' }}>
                {t('help.aiQuickStart.outro')}
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.aiFeatures.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text" style={{ marginBottom: '4px' }}><strong>{t('help.aiFeatures.aiChatHeading')}</strong></p>
              <p className="help-text">
                <Trans i18nKey="help.aiFeatures.aiChatIntro" components={[<strong key="0" />, <FeaturesIcon key="1" />, <strong key="2" />, <strong key="3" />, <code key="4" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.aiFeatures.linkedTerminal" components={[<strong key="0" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.aiFeatures.streamWatchdog" components={[<strong key="0" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.aiFeatures.attachImages" components={[<strong key="0" />]} />
              </p>

              <p className="help-text" style={{ marginBottom: '4px' }}><strong>{t('help.aiFeatures.askAiHeading')}</strong></p>
              <p className="help-text">
                <Trans i18nKey="help.aiFeatures.askAiBody" components={[<strong key="0" />, <strong key="1" />]} />
              </p>

              <p className="help-text" style={{ marginBottom: '4px' }}><strong>{t('help.aiFeatures.interactiveHeading')}</strong></p>
              <p className="help-text">
                {t('help.aiFeatures.interactiveBody')}
              </p>

              <p className="help-text" style={{ marginBottom: '4px' }}><strong>{t('help.aiFeatures.executionHeading')}</strong></p>
              <p className="help-text">
                <Trans
                  i18nKey="help.aiFeatures.executionBody"
                  components={[<strong key="0" />, <strong key="1" />, <strong key="2" />, <code key="3" />, <code key="4" />, <strong key="5" />]}
                />
              </p>

              <p className="help-text" style={{ marginBottom: '4px' }}><strong>{t('help.aiFeatures.safetyHeading')}</strong></p>
              <p className="help-text">
                <Trans
                  i18nKey="help.aiFeatures.safetyBody"
                  components={[<strong key="0" />, <strong key="1" />, <strong key="2" />, <strong key="3" />, <code key="4" />, <code key="5" />, <code key="6" />, <strong key="7" />, <strong key="8" />]}
                />
              </p>

              <p className="help-text" style={{ marginBottom: '4px' }}><strong>{t('help.aiFeatures.personasHeading')}</strong></p>
              <p className="help-text">
                <Trans i18nKey="help.aiFeatures.personasBody" components={[<strong key="0" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.aiFeatures.personasNetworkExpert" components={[<strong key="0" />]} />
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary><WatchIcon /> {t('help.watchMode.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                {t('help.watchMode.intro')}
              </p>
              <ol className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: 0 }}>
                <li><Trans i18nKey="help.watchMode.step1" components={[<strong key="0" />, <WatchIcon key="1" />]} /></li>
                <li>{t('help.watchMode.step2')}</li>
                <li><Trans i18nKey="help.watchMode.step3" components={[<strong key="0" />, <strong key="1" />]} /></li>
              </ol>
              <p className="help-text">
                <Trans i18nKey="help.watchMode.tip" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.chooseProvider.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                {t('help.chooseProvider.intro')}
              </p>
              <table className="help-auth-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'calc(var(--font-size-base) - 1px)', marginBottom: '8px' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', paddingBottom: '6px', borderBottom: '1px solid var(--border-color)', paddingRight: '8px' }}>{t('help.chooseProvider.thProvider')}</th>
                    <th style={{ textAlign: 'left', paddingBottom: '6px', borderBottom: '1px solid var(--border-color)', paddingRight: '8px' }}>{t('help.chooseProvider.thBestFor')}</th>
                    <th style={{ textAlign: 'left', paddingBottom: '6px', borderBottom: '1px solid var(--border-color)', paddingRight: '8px' }}>{t('help.chooseProvider.thAuth')}</th>
                    <th style={{ textAlign: 'left', paddingBottom: '6px', borderBottom: '1px solid var(--border-color)' }}>{t('help.chooseProvider.thStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}><strong><Trans i18nKey="help.chooseProvider.geminiName" components={[<br key="0" />]} /></strong></td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>{t('help.chooseProvider.geminiBestFor')}</td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>{t('help.chooseProvider.geminiAuth')}</td>
                    <td style={{ padding: '6px 0', verticalAlign: 'top' }}>{t('help.chooseProvider.geminiStatus')}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}><strong><Trans i18nKey="help.chooseProvider.vertexName" components={[<br key="0" />]} /></strong></td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>{t('help.chooseProvider.vertexBestFor')}</td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>{t('help.chooseProvider.vertexAuth')}</td>
                    <td style={{ padding: '6px 0', verticalAlign: 'top' }}>{t('help.chooseProvider.vertexStatus')}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}><strong><Trans i18nKey="help.chooseProvider.anthropicName" components={[<br key="0" />]} /></strong></td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>{t('help.chooseProvider.anthropicBestFor')}</td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>{t('help.chooseProvider.anthropicAuth')}</td>
                    <td style={{ padding: '6px 0', verticalAlign: 'top' }}>{t('help.chooseProvider.experimental')}<br /><span style={{ fontSize: 'calc(var(--font-size-base) - 2px)', opacity: 0.8 }}>{t('help.chooseProvider.experimentalNote')}</span></td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}><strong>{t('help.chooseProvider.openaiName')}</strong></td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>{t('help.chooseProvider.openaiBestFor')}</td>
                    <td style={{ padding: '6px 8px 6px 0', verticalAlign: 'top' }}>{t('help.chooseProvider.openaiAuth')}</td>
                    <td style={{ padding: '6px 0', verticalAlign: 'top' }}>{t('help.chooseProvider.experimental')}<br /><span style={{ fontSize: 'calc(var(--font-size-base) - 2px)', opacity: 0.8 }}>{t('help.chooseProvider.experimentalNote')}</span></td>
                  </tr>
                </tbody>
              </table>
              <p className="help-text">
                <Trans i18nKey="help.chooseProvider.recommendation" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.aiSetup.summary')}</summary>
            <div className="help-section-body">

              <p className="help-text" style={{ marginBottom: '2px' }}><strong>{t('help.aiSetup.whereHeading')}</strong></p>
              <p className="help-text" style={{ marginBottom: '4px' }}>
                <Trans i18nKey="help.aiSetup.whereBody1" components={[<strong key="0" />]} />
              </p>
              <p className="help-text" style={{ marginBottom: '10px' }}>
                <Trans i18nKey="help.aiSetup.whereBody2" components={[<strong key="0" />, <strong key="1" />]} />
              </p>

              <p className="help-text" style={{ marginBottom: '2px' }}><strong>{t('help.aiSetup.geminiHeading')}</strong></p>
              <p className="help-text" style={{ marginBottom: '4px' }}>
                <Trans i18nKey="help.aiSetup.geminiIntro" components={[<strong key="0" />]} />
              </p>
              <ol className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: '0 0 4px 0' }}>
                <li><Trans i18nKey="help.aiSetup.geminiStep1" components={[<strong key="0" />, <strong key="1" />]} /></li>
                <li><Trans i18nKey="help.aiSetup.geminiStep2" components={[<strong key="0" />, <strong key="1" />, <strong key="2" />]} /></li>
                <li><Trans i18nKey="help.aiSetup.geminiStep3" components={[<strong key="0" />, <strong key="1" />, <strong key="2" />, <strong key="3" />]} /></li>
                <li><Trans i18nKey="help.aiSetup.geminiStep4" components={[<strong key="0" />, <strong key="1" />, <strong key="2" />]} /></li>
                <li>{t('help.aiSetup.geminiStep5')}</li>
              </ol>
              <p className="help-text" style={{ marginBottom: '10px' }}>
                {t('help.aiSetup.geminiNote')}
              </p>

              <p className="help-text" style={{ marginBottom: '2px' }}><strong>{t('help.aiSetup.vertexHeading')}</strong></p>
              <ol className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: '0 0 10px 0' }}>
                <li><Trans i18nKey="help.aiSetup.vertexStep1" components={[<strong key="0" />, <strong key="1" />]} /></li>
                <li><Trans i18nKey="help.aiSetup.vertexStep2" components={[<strong key="0" />, <br key="1" />, <code key="2" />, <br key="3" />]} /></li>
                <li><Trans i18nKey="help.aiSetup.vertexStep3" components={[<strong key="0" />, <strong key="1" />]} /></li>
                <li><Trans i18nKey="help.aiSetup.vertexStep4" components={[<strong key="0" />, <strong key="1" />, <strong key="2" />, <strong key="3" />]} /></li>
              </ol>

              <p className="help-text" style={{ marginBottom: '2px' }}><strong>{t('help.aiSetup.anthropicHeading')}</strong> <span style={{ fontSize: 'calc(var(--font-size-base) - 2px)', opacity: 0.7 }}>{t('help.aiSetup.anthropicExperimental')}</span></p>
              <ol className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: '0 0 4px 0' }}>
                <li><Trans i18nKey="help.aiSetup.anthropicStep1" components={[<code key="0" />]} /></li>
                <li><Trans i18nKey="help.aiSetup.anthropicStep2" components={[<strong key="0" />, <code key="1" />]} /></li>
                <li><Trans i18nKey="help.aiSetup.anthropicStep3" components={[<strong key="0" />, <strong key="1" />]} /></li>
              </ol>
              <p className="help-text" style={{ marginBottom: '10px' }}>
                {t('help.aiSetup.anthropicNote')}
              </p>

              <p className="help-text" style={{ marginBottom: '2px' }}><strong>{t('help.aiSetup.openaiHeading')}</strong> <span style={{ fontSize: 'calc(var(--font-size-base) - 2px)', opacity: 0.7 }}>{t('help.aiSetup.openaiExperimental')}</span></p>
              <ol className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: '0 0 4px 0' }}>
                <li><Trans i18nKey="help.aiSetup.openaiStep1" components={[<code key="0" />]} /></li>
                <li><Trans i18nKey="help.aiSetup.openaiStep2" components={[<strong key="0" />, <code key="1" />]} /></li>
                <li><Trans i18nKey="help.aiSetup.openaiStep3" components={[<strong key="0" />, <strong key="1" />]} /></li>
              </ol>
              <p className="help-text" style={{ marginBottom: '10px' }}>
                {t('help.aiSetup.openaiNote')}
              </p>

              <p className="help-text" style={{ marginBottom: '2px' }}><strong>{t('help.aiSetup.troubleshootHeading')}</strong></p>
              <ul className="shortcuts-list" style={{ paddingLeft: '1.5em', margin: '0 0 10px 0' }}>
                <li><Trans i18nKey="help.aiSetup.troubleshootGemini" components={[<strong key="0" />, <strong key="1" />]} /></li>
                <li><Trans i18nKey="help.aiSetup.troubleshootVertex" components={[<strong key="0" />, <strong key="1" />, <code key="2" />]} /></li>
                <li><Trans i18nKey="help.aiSetup.troubleshootKeys" components={[<strong key="0" />]} /></li>
              </ul>

              <p className="help-text">
                {t('help.aiSetup.credentialsNote')}
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.customizing.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                <Trans i18nKey="help.customizing.customPersonas" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.customizing.proactiveInvestigation" components={[<strong key="0" />]} />
              </p>
            </div>
          </details>

          <details className="help-section">
            <summary>{t('help.themes.summary')}</summary>
            <div className="help-section-body">
              <p className="help-text">
                <Trans i18nKey="help.themes.builtIn" components={[<strong key="0" />, <strong key="1" />, <strong key="2" />, <strong key="3" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.themes.customThemes" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.themes.providerColors" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.themes.futuristic" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.themes.unusedPane" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
              <p className="help-text">
                <Trans i18nKey="help.themes.language" components={[<strong key="0" />, <strong key="1" />]} />
              </p>
            </div>
          </details>

        </div>
      </div>
    </div>
  );
}
