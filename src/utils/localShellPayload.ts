import type { Encoding, LocalShellChoice } from '../types/appTypes';
import type { ConnectSubmitPayload } from '../components/SessionDialog/SessionDialog';

/**
 * The connect payload for a local shell picked in the New Session menu. These
 * open without a dialog, so the shell gets the global encoding and the same
 * name the dialog used to give it.
 */
export function localShellPayload(choice: LocalShellChoice, encoding: Encoding): ConnectSubmitPayload {
    switch (choice.protocol) {
        case 'wsl':
            return {
                displayName: `WSL ${choice.distribution}`,
                protocol: 'wsl',
                config: { distribution: choice.distribution, encoding },
            };
        case 'cmd':
            return { displayName: 'Command Prompt', protocol: 'cmd', config: { shellType: 'cmd', encoding } };
        case 'powershell':
            return { displayName: 'PowerShell', protocol: 'powershell', config: { shellType: 'powershell', encoding } };
        case 'git-bash':
            return {
                displayName: 'Git Bash',
                protocol: 'git-bash',
                config: { shellType: 'git-bash', shellPath: choice.shellPath, encoding },
            };
    }
}
