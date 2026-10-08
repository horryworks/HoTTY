import { describe, it, expect } from 'vitest';
import { localShellPayload } from './localShellPayload';

describe('localShellPayload', () => {
    it('names each shell as the connection dialog used to', () => {
        expect(localShellPayload({ protocol: 'cmd' }, 'utf8')).toEqual({
            displayName: 'Command Prompt', protocol: 'cmd', config: { shellType: 'cmd', encoding: 'utf8' },
        });
        expect(localShellPayload({ protocol: 'powershell' }, 'utf8').displayName).toBe('PowerShell');
        expect(localShellPayload({ protocol: 'wsl', distribution: 'Debian' }, 'utf8')).toEqual({
            displayName: 'WSL Debian', protocol: 'wsl', config: { distribution: 'Debian', encoding: 'utf8' },
        });
    });

    it('starts Git Bash from the path that was found', () => {
        const p = localShellPayload({ protocol: 'git-bash', shellPath: 'C:/Program Files/Git/bin/bash.exe' }, 'utf8');
        expect(p.config).toEqual({ shellType: 'git-bash', shellPath: 'C:/Program Files/Git/bin/bash.exe', encoding: 'utf8' });
    });

    it('uses the encoding it is given (the global setting)', () => {
        expect(localShellPayload({ protocol: 'cmd' }, 'shift_jis').config.encoding).toBe('shift_jis');
    });
});
