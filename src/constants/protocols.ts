import type { ProtocolId } from '../types/appTypes';

/**
 * The protocols a New Connection form can be opened on, in menu order. Shared
 * by the session dialog's protocol select and the dock's New Session menu.
 * gcloud-iap is not here: it is opened from the dialog's GCP tab.
 */
export const PROTOCOLS: { value: ProtocolId; label: string }[] = [
    { value: 'ssh', label: 'SSH' },
    { value: 'telnet', label: 'Telnet' },
    { value: 'serial', label: 'Serial' },
    { value: 'wsl', label: 'WSL' },
    { value: 'cmd', label: 'Command Prompt' },
    { value: 'powershell', label: 'PowerShell' },
    { value: 'git-bash', label: 'Git Bash' },
];
