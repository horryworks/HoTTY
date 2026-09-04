import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConnectRequestCard } from './ConnectRequestCard';
import type { ConnectParseResult, ResolvedConnect, GateDecision, CredentialSource } from '../../utils/aiConnectRequest';
import type { ConnectBlock } from '../../utils/connectRequestReducer';
import type { ConnectEnvelope } from './terminalOutputUtils';

/**
 * The connect card IS the confirmation step for an AI-initiated session
 * (ADR-AI-007) — no modal stands behind it. These tests pin which control the
 * user gets in each state, and that every AI-controlled string reaches the DOM
 * as a text node rather than as markup.
 *
 * i18n is initialised globally in `src/test/setup.ts` (English), so assertions
 * use the real strings.
 */

const okParse = (over: Partial<{ type: 'local' | 'ssh' | 'telnet'; host: string; port: number; reason: string; via: string }> = {}): ConnectParseResult =>
    ({ ok: true, request: { type: 'ssh', host: '192.0.2.10', port: 22, ...over } } as ConnectParseResult);

const remote = (over: Partial<ResolvedConnect> = {}): ResolvedConnect =>
    ({
        kind: 'remote',
        protocol: 'ssh',
        host: '192.0.2.10',
        port: 22,
        displayName: '192.0.2.10',
        username: 'alice',
        credentialSource: { kind: 'none' },
        manualLogin: true,
        needsDialog: false,
        ...over,
    } as ResolvedConnect);

const block = (over: Partial<ConnectBlock> = {}): ConnectBlock =>
    ({ key: 'k', status: 'asking', resolved: remote(), decision: { action: 'ask', variant: 'open', reuse: false } as GateDecision, ...over } as ConnectBlock);

const base = { body: 'type: ssh\nhost: 192.0.2.10', localShellType: 'powershell' as const };

describe('ConnectRequestCard', () => {
    it('shows a disabled Open button and the raw body while the fence is still streaming', () => {
        render(<ConnectRequestCard {...base} />);
        expect((screen.getByRole('button', { name: /Open terminal/i }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText(/type: ssh/)).toBeTruthy();
    });

    it('renders the target and always marks the session as tab-less', () => {
        render(<ConnectRequestCard {...base} parse={okParse()} block={block()} />);
        expect(screen.getByText('SSH 192.0.2.10:22')).toBeTruthy();
        expect(screen.getByText(/no tab — output is captured for the AI/)).toBeTruthy();
    });

    it('names the shell for a PC-shell request rather than a host', () => {
        render(
            <ConnectRequestCard
                {...base}
                localShellType="git-bash"
                parse={okParse({ type: 'local' })}
                block={block({ resolved: { kind: 'local', shellType: 'git-bash', displayName: 'Git Bash' } as ResolvedConnect })}
            />,
        );
        expect(screen.getByText('PC shell (Git Bash)')).toBeTruthy();
    });

    describe('asking', () => {
        it('offers Open and Don\'t open, and calls the matching handler', () => {
            const onOpen = vi.fn();
            const onDecline = vi.fn();
            render(<ConnectRequestCard {...base} parse={okParse()} block={block()} onOpen={onOpen} onDecline={onDecline} />);
            fireEvent.click(screen.getByRole('button', { name: /Open terminal/i }));
            expect(onOpen).toHaveBeenCalledTimes(1);
            fireEvent.click(screen.getByRole('button', { name: /Don't open/i }));
            expect(onDecline).toHaveBeenCalledTimes(1);
        });

        it('routes the dialog variant to onOpenInDialog instead of opening directly', () => {
            const onOpen = vi.fn();
            const onOpenInDialog = vi.fn();
            render(
                <ConnectRequestCard
                    {...base}
                    parse={okParse()}
                    block={block({ decision: { action: 'ask', variant: 'dialog', reuse: false } as GateDecision })}
                    onOpen={onOpen}
                    onOpenInDialog={onOpenInDialog}
                />,
            );
            fireEvent.click(screen.getByRole('button', { name: /Open in connection dialog/i }));
            expect(onOpenInDialog).toHaveBeenCalledTimes(1);
            expect(onOpen).not.toHaveBeenCalled();
        });

        // Credential reuse is the one ask that hands an existing password to a new
        // host, so it is toned differently from an ordinary open.
        it('marks a credential-reuse request with the warn tone', () => {
            const { container } = render(
                <ConnectRequestCard
                    {...base}
                    parse={okParse()}
                    block={block({
                        resolved: remote({ credentialSource: { kind: 'inherit', alias: 'core-01', sessionId: 's1', username: 'alice' } }),
                        decision: { action: 'ask', variant: 'open', reuse: true } as GateDecision,
                    })}
                />,
            );
            expect(container.querySelector('.ai-execute-tone-warn')).not.toBeNull();
            expect(screen.getByText(/reused from core-01/)).toBeTruthy();
        });
    });

    describe('credential source line', () => {
        it.each([
            [{ kind: 'host-tree', nodeId: 'n1', nodeName: 'core-01', hasPassword: true, hasKey: false, hasUsername: true }, /saved host "core-01"/],
            [{ kind: 'inherit-username', alias: 'core-01', sessionId: 's1', username: 'alice' }, /login name from core-01, no password/],
            [{ kind: 'none' }, /you log in by hand/],
        ])('describes where the credentials come from (%#)', (credentialSource, expected) => {
            render(
                <ConnectRequestCard {...base} parse={okParse()} block={block({ resolved: remote({ credentialSource: credentialSource as CredentialSource }) })} />,
            );
            expect(screen.getByText(expected)).toBeTruthy();
        });

        it('warns that the dialog will ask when SSH has no saved secret', () => {
            render(<ConnectRequestCard {...base} parse={okParse()} block={block({ resolved: remote({ needsDialog: true }) })} />);
            expect(screen.getByText(/the connection dialog will ask for one/)).toBeTruthy();
        });
    });

    describe('scheduled auto-open', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        it('shows only a Cancel control and a live countdown — never a second Open', () => {
            const runAt = Date.now() + 3000;
            const onCancelSchedule = vi.fn();
            render(
                <ConnectRequestCard {...base} parse={okParse()} block={block({ status: 'scheduled', runAt })} onCancelSchedule={onCancelSchedule} />,
            );
            expect(screen.queryByRole('button', { name: /Open terminal/i })).toBeNull();
            expect(screen.getByText(/Opening in 3s/)).toBeTruthy();
            act(() => { vi.advanceTimersByTime(1100); });
            expect(screen.getByText(/Opening in 2s/)).toBeTruthy();
            fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
            expect(onCancelSchedule).toHaveBeenCalledTimes(1);
        });
    });

    it('disables the button while opening and says so when a manual login is expected', () => {
        render(
            <ConnectRequestCard {...base} parse={okParse()} block={block({ status: 'opening', resolved: remote({ manualLogin: true }) })} />,
        );
        expect((screen.getByRole('button', { name: /Opening…/ }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText(/Waiting for you to log in…/)).toBeTruthy();
    });

    describe('final outcomes (from the transcript envelope)', () => {
        it('reports the alias it opened as, and distinguishes an automatic open', () => {
            const { rerender } = render(
                <ConnectRequestCard {...base} parse={okParse()} block={block({ status: 'settled' })} outcome={{ kind: 'connected', alias: 'sw-01' } as ConnectEnvelope} />,
            );
            expect(screen.getByText('Opened as sw-01')).toBeTruthy();
            rerender(
                <ConnectRequestCard {...base} parse={okParse()} block={block({ status: 'settled', autoOpened: true })} outcome={{ kind: 'connected', alias: 'sw-01' } as ConnectEnvelope} />,
            );
            expect(screen.getByText('Opened automatically as sw-01')).toBeTruthy();
        });

        it('offers "Open as tab" only while the alias is still a live worker', () => {
            const onOpenAsTab = vi.fn();
            const { rerender } = render(
                <ConnectRequestCard
                    {...base}
                    parse={okParse()}
                    block={block({ status: 'settled' })}
                    outcome={{ kind: 'connected', alias: 'sw-01' } as ConnectEnvelope}
                    onOpenAsTab={onOpenAsTab}
                    canOpenAsTab={() => true}
                />,
            );
            fireEvent.click(screen.getByRole('button', { name: /Open as tab/i }));
            expect(onOpenAsTab).toHaveBeenCalledWith('sw-01');

            rerender(
                <ConnectRequestCard
                    {...base}
                    parse={okParse()}
                    block={block({ status: 'settled' })}
                    outcome={{ kind: 'connected', alias: 'sw-01' } as ConnectEnvelope}
                    onOpenAsTab={onOpenAsTab}
                    canOpenAsTab={() => false}
                />,
            );
            expect(screen.queryByRole('button', { name: /Open as tab/i })).toBeNull();
        });

        it('shows the failure reason from the envelope and takes the danger tone', () => {
            const { container } = render(
                <ConnectRequestCard {...base} parse={okParse()} block={block({ status: 'settled' })} outcome={{ kind: 'failed', body: '[Connection refused by host]\nmore' } as ConnectEnvelope} />,
            );
            expect(screen.getByText(/Failed: Connection refused by host/)).toBeTruthy();
            expect(container.querySelector('.ai-execute-tone-danger')).not.toBeNull();
        });

        it('shows a declined outcome with no remaining action', () => {
            render(<ConnectRequestCard {...base} parse={okParse()} block={block({ status: 'settled' })} outcome={{ kind: 'declined' } as ConnectEnvelope} />);
            expect(screen.getByText('Not opened')).toBeTruthy();
            expect(screen.queryByRole('button')).toBeNull();
        });
    });

    describe('refusals', () => {
        it.each([
            ['cap', /already has the maximum number/],
            ['with-execute', /cannot share a reply with a command/],
            ['multiple', /only one connect request per reply/],
        ])('explains a %s refusal', (reason, expected) => {
            render(
                <ConnectRequestCard {...base} parse={okParse()} block={block({ decision: { action: 'refuse', reason } as GateDecision })} />,
            );
            expect(screen.getByText(expected)).toBeTruthy();
            expect(screen.queryByRole('button')).toBeNull();
        });

        it('explains a malformed request and still shows the raw body for debugging', () => {
            render(
                <ConnectRequestCard {...base} parse={{ ok: false, errors: [{ code: 'unknown-key', key: 'wat' }] } as ConnectParseResult} />,
            );
            expect(screen.getByText(/the request was malformed/)).toBeTruthy();
            expect(screen.getByText(/type: ssh/)).toBeTruthy();
        });
    });

    describe('inert / expired', () => {
        it('renders inert with no action when the feature is turned off', () => {
            render(<ConnectRequestCard {...base} parse={okParse()} block={block()} policyOff />);
            expect(screen.getByText(/AI-opened terminals are turned off/)).toBeTruthy();
            expect(screen.queryByRole('button')).toBeNull();
        });

        it('renders expired when the reducer no longer has state for the request', () => {
            render(<ConnectRequestCard {...base} parse={okParse()} />);
            expect(screen.getByText(/no longer actionable/)).toBeTruthy();
            expect(screen.queryByRole('button')).toBeNull();
        });
    });

    // The reason, name and host all originate in AI output. They must land as
    // text, never as markup, or the card becomes an injection surface.
    it('renders AI-supplied strings as text nodes, not as markup', () => {
        const evil = '<img src=x onerror="alert(1)">';
        const { container } = render(
            <ConnectRequestCard
                {...base}
                parse={okParse({ reason: evil })}
                block={block({ resolved: remote({ reason: evil, displayName: evil }) })}
            />,
        );
        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText(new RegExp(`Reason: ${evil.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeTruthy();
    });
});
