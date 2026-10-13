import { describe, it, expect, beforeEach } from 'vitest';
import {
    useAiTranscriptStore,
    EMPTY_PANE,
    EMPTY_PREP,
    paneTranscripts,
    tabPrep,
    setTabPrep,
    forgetPrep,
    type ChatMessage,
    type TabPrep,
} from './aiTranscriptStore';
import type { AutoExecBlock } from '../utils/autoExecReducer';

const store = () => useAiTranscriptStore.getState();

const USER: ChatMessage = { role: 'user', content: 'show version' };
const MODEL: ChatMessage = {
    role: 'model',
    content: '```execute\nshow version\n```',
    execTarget: { sessionId: 's1', bindingKey: 'ssh:sw-01' },
};

function addMessages(paneId: string, tabId: string, messages: ChatMessage[]) {
    store().updatePane(paneId, (p) => {
        const messagesByTab = new Map(p.messagesByTab);
        messagesByTab.set(tabId, messages);
        return { ...p, messagesByTab };
    });
}

function prep(devices: [string, string][], selfOpened: string[] = []): TabPrep {
    return { devices: new Map(devices), selfOpened: new Set(selfOpened) };
}

describe('aiTranscriptStore', () => {
    beforeEach(() => {
        useAiTranscriptStore.setState({ panes: new Map() });
    });

    describe('updatePane', () => {
        it('hands an unseen pane the empty transcripts and creates it', () => {
            let seen: unknown = null;
            store().updatePane('p1', (p) => {
                seen = p;
                return { ...p, streamingTabIds: new Set(['t1']) };
            });
            expect(seen).toBe(EMPTY_PANE);
            expect(paneTranscripts('p1').streamingTabIds.has('t1')).toBe(true);
        });

        it('leaves state untouched when the updater returns the pane unchanged', () => {
            addMessages('p1', 't1', [USER]);
            const before = store().panes;
            store().updatePane('p1', (p) => p);
            expect(store().panes).toBe(before);
            // An unseen pane given back EMPTY_PANE is not created either.
            store().updatePane('p2', (p) => p);
            expect(store().panes.has('p2')).toBe(false);
        });

        it('keeps panes independent', () => {
            addMessages('p1', 't1', [USER]);
            addMessages('p2', 't1', [USER, MODEL]);
            expect(paneTranscripts('p1').messagesByTab.get('t1')).toEqual([USER]);
            expect(paneTranscripts('p2').messagesByTab.get('t1')).toEqual([USER, MODEL]);
        });
    });

    describe('exportPane / importPane', () => {
        it('round-trips messages, tokens, outcomes and prep through plain arrays', () => {
            const block: AutoExecBlock = { command: 'show version', status: 'executed' };
            addMessages('p1', 't1', [USER, MODEL]);
            store().updatePane('p1', (p) => ({
                ...p,
                tokensByTab: new Map([['t1', { input: 10, output: 20, cost: null }]]),
                outcomesByTab: new Map([['t1', new Map([['0:show version', block]])]]),
            }));
            setTabPrep('p1', 't1', prep([['s1', 'cisco-ios']], ['s2']));

            const wire = store().exportPane('p1');
            // Survives JSON, which is how a handover crosses windows.
            const parsed = JSON.parse(JSON.stringify(wire)) as typeof wire;
            store().importPane('p9', parsed.messages, parsed.tokens, parsed.outcomes, parsed.prep);

            const pane = paneTranscripts('p9');
            expect(pane.messagesByTab.get('t1')).toEqual([USER, MODEL]);
            expect(pane.tokensByTab.get('t1')).toEqual({ input: 10, output: 20, cost: null });
            expect(pane.outcomesByTab.get('t1')?.get('0:show version')).toEqual(block);
            expect(tabPrep('p9', 't1').devices.get('s1')).toBe('cisco-ios');
            expect(tabPrep('p9', 't1').selfOpened.has('s2')).toBe(true);
        });

        it('does not carry an answer still streaming across a handover', () => {
            store().updatePane('p1', (p) => ({
                ...p,
                streamingByTab: new Map([['t1', 'partial']]),
                streamingTabIds: new Set(['t1']),
            }));
            const wire = store().exportPane('p1');
            store().importPane('p2', wire.messages, wire.tokens, wire.outcomes, wire.prep);
            expect(paneTranscripts('p2').streamingByTab.size).toBe(0);
            expect(paneTranscripts('p2').streamingTabIds.size).toBe(0);
        });

        it('exports an unknown pane as empty lists', () => {
            expect(store().exportPane('nope')).toEqual({ messages: [], tokens: [], outcomes: [], prep: [] });
        });

        it('defaults outcomes and prep when an older sender omits them', () => {
            store().importPane('p1', [['t1', [USER]]], []);
            const pane = paneTranscripts('p1');
            expect(pane.messagesByTab.get('t1')).toEqual([USER]);
            expect(pane.outcomesByTab.size).toBe(0);
            expect(pane.prepByTab.size).toBe(0);
        });

        it('replaces whatever the pane held before, wholesale', () => {
            addMessages('p1', 'old-tab', [USER]);
            store().importPane('p1', [['t1', [MODEL]]], []);
            const pane = paneTranscripts('p1');
            expect(pane.messagesByTab.has('old-tab')).toBe(false);
            expect(pane.messagesByTab.get('t1')).toEqual([MODEL]);
        });
    });

    describe('removePane', () => {
        it('drops the pane so a later read is empty', () => {
            addMessages('p1', 't1', [USER]);
            store().removePane('p1');
            expect(paneTranscripts('p1')).toBe(EMPTY_PANE);
        });

        it('leaves state untouched for an unknown pane', () => {
            const before = store().panes;
            store().removePane('nope');
            expect(store().panes).toBe(before);
        });
    });

    describe('prep helpers', () => {
        it('reads an unknown tab as the empty prep record', () => {
            expect(tabPrep('p1', 't1')).toBe(EMPTY_PREP);
        });

        it('sets one tab without touching the others', () => {
            setTabPrep('p1', 't1', prep([['s1', 'huawei-vrp']]));
            setTabPrep('p1', 't2', prep([['s2', 'cisco-ios']]));
            expect(tabPrep('p1', 't1').devices.get('s1')).toBe('huawei-vrp');
            expect(tabPrep('p1', 't2').devices.get('s2')).toBe('cisco-ios');
        });

        it('forgets every tab when no filter is given', () => {
            setTabPrep('p1', 't1', prep([['s1', 'a']]));
            setTabPrep('p1', 't2', prep([['s2', 'b']]));
            forgetPrep('p1');
            expect(paneTranscripts('p1').prepByTab.size).toBe(0);
        });

        it('forgets only the tabs the filter rejects', () => {
            setTabPrep('p1', 't1', prep([['s1', 'a']]));
            setTabPrep('p1', 't2', prep([['s2', 'b']]));
            forgetPrep('p1', (id) => id === 't2');
            expect([...paneTranscripts('p1').prepByTab.keys()]).toEqual(['t2']);
        });

        it('leaves state untouched when nothing would be forgotten', () => {
            setTabPrep('p1', 't1', prep([['s1', 'a']]));
            const before = store().panes;
            forgetPrep('p1', () => true);
            expect(store().panes).toBe(before);
            // A pane with no prep at all is not created by forgetting.
            forgetPrep('p2');
            expect(store().panes.has('p2')).toBe(false);
        });
    });
});
