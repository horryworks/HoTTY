import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DockMenu, type DockMenuPlacement } from '../Dock/DockMenu';
import { FeatureIcon, PlusIcon, ProtocolIcon } from './TabIcons';
import { PROTOCOLS } from '../../constants/protocols';
import { useSettingsStore } from '../../stores/settingsStore';
import { useLocalShells } from '../../hooks/useLocalShells';
import type { LocalShellChoice, NewSessionChoice, ProtocolId } from '../../types/appTypes';

const label = (p: ProtocolId) => PROTOCOLS.find((x) => x.value === p)?.label ?? p;

export interface NewSessionMenuProps {
  placement: DockMenuPlacement;
  /** Open the dialog for this row: SSH / Telnet, Serial, GCP or Web. */
  onNew: (choice: NewSessionChoice) => void;
  /** Start a local shell straight away, with no dialog. */
  onOpenLocal: (choice: LocalShellChoice) => void;
  onNewLogViewer?: () => void;
  onNewPingMonitor?: () => void;
  onNewInterfaceTraffic?: () => void;
  onNewFileServer?: () => void;
  onNewAiChat?: () => void;
}

/**
 * The "+ New Session" row at the end of the tab list. It opens a short menu
 * where each row offers only what it needs: SSH / Telnet and Serial open their
 * own dialogs; WSL, Command Prompt, PowerShell and Git Bash start at once (WSL
 * lists its distributions beside the menu when there is more than one); GCP
 * and Web open theirs; then every enabled feature pane. It replaces the old
 * separate New Session and Features buttons, so everything that adds a tab is
 * found where the tabs are.
 */
export function NewSessionMenu({
  placement,
  onNew,
  onOpenLocal,
  onNewLogViewer,
  onNewPingMonitor,
  onNewInterfaceTraffic,
  onNewFileServer,
  onNewAiChat,
}: NewSessionMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [wslOpen, setWslOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const wslRef = useRef<HTMLButtonElement>(null);
  const { wslDistros, gitBashPath } = useLocalShells(open);
  // The dialog's Web tab follows the Web Browser feature toggle; so does this row.
  const webEnabled = useSettingsStore((s) => s.enabledFeatures['web-browser']);

  const features = [
    { type: 'log-viewer', label: t('chrome.tabBar.logViewer'), run: onNewLogViewer },
    { type: 'ping-monitor', label: t('chrome.tabBar.pingMonitor'), run: onNewPingMonitor },
    { type: 'interface-traffic', label: t('chrome.tabBar.interfaceTraffic'), run: onNewInterfaceTraffic },
    { type: 'file-server', label: t('chrome.tabBar.fileServer'), run: onNewFileServer },
    { type: 'ai-chat', label: t('chrome.tabBar.aiChat'), run: onNewAiChat },
  ] as const;
  const enabled = features.filter((f) => f.run);

  const close = () => {
    setOpen(false);
    setWslOpen(false);
  };
  const choose = (fn: () => void) => () => {
    close();
    fn();
  };
  // The distributions open beside the menu, on the side away from the dock.
  const subPlacement: DockMenuPlacement = placement === 'left' ? 'left' : 'right';
  const notInstalled = <span className="dock-menu-item-note">{t('chrome.tabBar.notInstalled')}</span>;
  const dialogRow = (choice: 'ssh' | 'telnet' | 'serial') => (
    <button key={choice} type="button" role="menuitem" className="dock-menu-item" onClick={choose(() => onNew(choice))}>
      <ProtocolIcon protocol={choice} />
      {label(choice)}
    </button>
  );

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`tab tab-new${open ? ' open' : ''}`}
        title={t('chrome.tabBar.newSession')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="tab-lead">
          <PlusIcon />
        </span>
        <span className="tab-text">
          <span className="tab-label">{t('chrome.tabBar.newSession')}</span>
        </span>
      </button>
      <DockMenu
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        placement={placement}
        className="new-session-menu"
      >
        {dialogRow('ssh')}
        {dialogRow('telnet')}
        {dialogRow('serial')}
        <div className="dock-menu-separator" role="separator" />
        <button
          ref={wslRef}
          type="button"
          role="menuitem"
          className={`dock-menu-item${wslOpen ? ' open' : ''}`}
          disabled={!wslDistros?.length}
          aria-haspopup={wslDistros && wslDistros.length > 1 ? 'menu' : undefined}
          aria-expanded={wslDistros && wslDistros.length > 1 ? wslOpen : undefined}
          onClick={() => {
            if (!wslDistros?.length) return;
            if (wslDistros.length === 1) choose(() => onOpenLocal({ protocol: 'wsl', distribution: wslDistros[0] }))();
            else setWslOpen((v) => !v);
          }}
        >
          <ProtocolIcon protocol="wsl" />
          {label('wsl')}
          {wslDistros?.length === 0 && notInstalled}
          {wslDistros && wslDistros.length > 1 && <span className="dock-menu-item-chevron" aria-hidden="true">▸</span>}
        </button>
        {/* Inside the menu's own element, so a press in it does not count as
            outside the menu and close both before the click lands. */}
        <DockMenu
          open={wslOpen && !!wslDistros && wslDistros.length > 1}
          onClose={() => setWslOpen(false)}
          anchorRef={wslRef}
          placement={subPlacement}
          className="new-session-submenu"
          aria-label={label('wsl')}
        >
          {wslDistros?.map((d) => (
            <button
              key={d}
              type="button"
              role="menuitem"
              className="dock-menu-item"
              onClick={choose(() => onOpenLocal({ protocol: 'wsl', distribution: d }))}
            >
              {d}
            </button>
          ))}
        </DockMenu>
        <button type="button" role="menuitem" className="dock-menu-item" onClick={choose(() => onOpenLocal({ protocol: 'cmd' }))}>
          <ProtocolIcon protocol="cmd" />
          {label('cmd')}
        </button>
        <button type="button" role="menuitem" className="dock-menu-item" onClick={choose(() => onOpenLocal({ protocol: 'powershell' }))}>
          <ProtocolIcon protocol="powershell" />
          {label('powershell')}
        </button>
        <button
          type="button"
          role="menuitem"
          className="dock-menu-item"
          disabled={!gitBashPath}
          onClick={() => {
            if (gitBashPath) choose(() => onOpenLocal({ protocol: 'git-bash', shellPath: gitBashPath }))();
          }}
        >
          <ProtocolIcon protocol="git-bash" />
          {label('git-bash')}
          {(gitBashPath === null || gitBashPath === '') && notInstalled}
        </button>
        <div className="dock-menu-separator" role="separator" />
        <button type="button" role="menuitem" className="dock-menu-item" onClick={choose(() => onNew('gcp'))}>
          <ProtocolIcon protocol="gcloud-iap" />
          {t('sessionDialog.tabs.gcp')}
        </button>
        {webEnabled && (
          <button type="button" role="menuitem" className="dock-menu-item" onClick={choose(() => onNew('web'))}>
            <FeatureIcon type="web-browser" />
            {t('sessionDialog.tabs.web')}
          </button>
        )}
        {enabled.length > 0 && <div className="dock-menu-separator" role="separator" />}
        {enabled.map((f) => (
          <button
            key={f.type}
            type="button"
            role="menuitem"
            className="dock-menu-item"
            onClick={choose(f.run!)}
          >
            <FeatureIcon type={f.type} />
            {f.label}
          </button>
        ))}
      </DockMenu>
    </>
  );
}
