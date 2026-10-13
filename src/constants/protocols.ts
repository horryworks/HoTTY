import type { ProtocolId } from '../types/appTypes';

/**
 * The protocols a New Connection form can be opened on, in menu order, as shown
 * in the dock's New Session menu. gcloud-iap is not here: it is opened from the
 * session dialog's GCP tab.
 *
 * Product names (`SSH`, `PowerShell`, …) are the same in every language and sit
 * in `label`; the two ordinary words carry an i18n key in the `chrome`
 * namespace instead (Windows itself translates "Command Prompt").
 */
export const PROTOCOLS: { value: ProtocolId; label: string; labelKey?: 'chrome.tabBar.protocolSerial' | 'chrome.tabBar.protocolCmd' }[] = [
    { value: 'ssh', label: 'SSH' },
    { value: 'telnet', label: 'Telnet' },
    { value: 'serial', label: 'Serial', labelKey: 'chrome.tabBar.protocolSerial' },
    { value: 'wsl', label: 'WSL' },
    { value: 'cmd', label: 'Command Prompt', labelKey: 'chrome.tabBar.protocolCmd' },
    { value: 'powershell', label: 'PowerShell' },
    { value: 'git-bash', label: 'Git Bash' },
];
