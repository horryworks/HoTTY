import { describe, it, expect } from 'vitest';
import {
  AI_HANDOVER_ACK_CHANNEL,
  AI_HANDOVER_CHANNEL,
  AI_HANDOVER_VERSION,
  AI_ADOPT_SESSION_CHANNEL,
  AI_WATCH_REQUEST_CHANNEL,
  buildAdoptRequest,
  buildWatchRequest,
  parseAdoptRequest,
  parseWatchRequest,
  HANDOVER_IMAGE_TURNS,
  buildHandoverAck,
  buildHandoverPayload,
  parseHandoverAck,
  parseHandoverPayload,
  trimHandoverImages,
  workerIdsOf,
} from './aiWindowHandover';
import type { AiChatState, ChatTab } from '../hooks/useAiChat';
import type { ChatMessage, TabTokens } from '../hooks/useChatStream';
import type { AiWorkerSession } from '../stores/aiWorkerSessionStore';

const img = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ mimeType: 'image/png', dataBase64: `b${i}` }));

function tab(id: string, ordinal = 1): ChatTab {
  return { id, ordinal, title: `Tab ${ordinal}`, linkedSessions: [] };
}

function state(tabs: ChatTab[]): AiChatState {
  return {
    selectedModel: 'gemini-2.5-flash',
    systemInstruction: 'be terse',
    activeTabId: tabs[0].id,
    tabs,
  };
}

function worker(id: string, tabId: string): AiWorkerSession {
  return {
    id,
    key: `k-${id}`,
    displayName: 'sw-01',
    protocol: 'ssh',
    host: '10.0.0.1',
    port: 22,
    username: 'alice',
    status: 'connected',
    paneId: 'ai-1',
    tabId,
    openedAt: 1,
    lastUsedAt: 2,
    manualLogin: false,
  };
}

describe('trimHandoverImages', () => {
  it('leaves an image-free transcript exactly as it was', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'model', content: 'hello' },
    ];
    const got = trimHandoverImages(msgs);
    expect(got.dropped).toBe(0);
    // Same reference: an image-free conversation must cost nothing to move.
    expect(got.messages).toBe(msgs);
  });

  it('keeps the most recent image turns and strips the older ones', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'oldest', images: img(2) },
      { role: 'model', content: 'a' },
      { role: 'user', content: 'middle', images: img(1) },
      { role: 'model', content: 'b' },
      { role: 'user', content: 'newest', images: img(3) },
    ];
    const got = trimHandoverImages(msgs, 2);
    expect(got.dropped).toBe(1);
    expect(got.messages[0].images).toBeUndefined();
    expect(got.messages[2].images).toHaveLength(1);
    expect(got.messages[4].images).toHaveLength(3);
    // Text is never touched — only the attachments go.
    expect(got.messages.map((m) => m.content)).toEqual(msgs.map((m) => m.content));
  });

  it('does not mutate the transcript it was given', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'a', images: img(1) },
      { role: 'user', content: 'b', images: img(1) },
      { role: 'user', content: 'c', images: img(1) },
    ];
    trimHandoverImages(msgs, 1);
    expect(msgs[0].images).toHaveLength(1);
  });

  it('keeps everything when the transcript has few enough image turns', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'a', images: img(1) }];
    expect(trimHandoverImages(msgs, HANDOVER_IMAGE_TURNS).dropped).toBe(0);
  });
});

describe('buildHandoverPayload', () => {
  const base = {
    to: 'win-ai-1',
    from: 'main',
    paneId: 'ai-abc',
    state: state([tab('t1'), tab('t2', 2)]),
    messagesByTab: new Map<string, ChatMessage[]>([
      ['t1', [{ role: 'user', content: 'one' }]],
      ['t2', [{ role: 'user', content: 'two' }]],
    ]),
    tokensByTab: new Map<string, TabTokens>([['t1', { input: 10, output: 20, cost: 0.5 }]]),
    workers: [worker('h-1', 't1')],
  };

  it('carries the pane id verbatim so backend history stays addressable', () => {
    // The backend keys chat history `paneId::tabId`; a fresh id would orphan
    // every turn of the conversation.
    expect(buildHandoverPayload(base).paneId).toBe('ai-abc');
  });

  it('moves every tab, its transcript, its tokens and its workers', () => {
    const p = buildHandoverPayload(base);
    expect(p.v).toBe(AI_HANDOVER_VERSION);
    expect(p.state.tabs).toHaveLength(2);
    expect(p.messages.map(([id]) => id).sort()).toEqual(['t1', 't2']);
    expect(p.tokens).toEqual([['t1', { input: 10, output: 20, cost: 0.5 }]]);
    expect(workerIdsOf(p)).toEqual(['h-1']);
  });

  it('drops transcripts, tokens and workers whose tab is already gone', () => {
    const p = buildHandoverPayload({
      ...base,
      messagesByTab: new Map([...base.messagesByTab, ['closed', [{ role: 'user' as const, content: 'x' }]]]),
      tokensByTab: new Map([...base.tokensByTab, ['closed', { input: 1, output: 1, cost: null }]]),
      workers: [...base.workers, worker('h-2', 'closed')],
    });
    expect(p.messages.map(([id]) => id)).not.toContain('closed');
    expect(p.tokens.map(([id]) => id)).not.toContain('closed');
    expect(workerIdsOf(p)).toEqual(['h-1']);
  });

  it('reports how many turns lost their images', () => {
    const p = buildHandoverPayload({
      ...base,
      messagesByTab: new Map([
        [
          't1',
          [
            { role: 'user', content: 'a', images: img(1) },
            { role: 'user', content: 'b', images: img(1) },
            { role: 'user', content: 'c', images: img(1) },
          ] as ChatMessage[],
        ],
      ]),
    });
    expect(p.imagesDropped).toBe(3 - HANDOVER_IMAGE_TURNS);
  });
});

describe('parseHandoverPayload', () => {
  const payload = buildHandoverPayload({
    to: 'win-ai-1',
    from: 'main',
    paneId: 'ai-abc',
    state: state([tab('t1')]),
    messagesByTab: new Map([['t1', [{ role: 'user' as const, content: 'hi' }]]]),
    tokensByTab: new Map(),
    workers: [],
  });
  const raw = JSON.stringify(payload);

  it('round-trips a payload addressed to this window', () => {
    const got = parseHandoverPayload(raw, 'win-ai-1');
    expect(got).not.toBeNull();
    expect(got!.paneId).toBe('ai-abc');
    expect(got!.from).toBe('main');
    expect(got!.state.tabs[0].id).toBe('t1');
    expect(got!.messages).toEqual([['t1', [{ role: 'user', content: 'hi' }]]]);
  });

  it('ignores a payload addressed to a different window', () => {
    // Handovers ride a broadcast, so "not for me" is the common case.
    expect(parseHandoverPayload(raw, 'main')).toBeNull();
    expect(parseHandoverPayload(raw, 'win-ai-2')).toBeNull();
  });

  it('refuses a payload from an unrecognised wire version', () => {
    const other = JSON.stringify({ ...payload, v: AI_HANDOVER_VERSION + 1 });
    expect(parseHandoverPayload(other, 'win-ai-1')).toBeNull();
  });

  it('never throws on malformed input', () => {
    for (const bad of ['', 'not json', '[]', 'null', '"a string"', '{}', '{"v":1}']) {
      expect(() => parseHandoverPayload(bad, 'win-ai-1')).not.toThrow();
      expect(parseHandoverPayload(bad, 'win-ai-1')).toBeNull();
    }
  });

  it('refuses a payload with no usable conversation state', () => {
    const noTabs = JSON.stringify({ ...payload, state: { ...payload.state, tabs: [] } });
    expect(parseHandoverPayload(noTabs, 'win-ai-1')).toBeNull();

    const noState = JSON.stringify({ ...payload, state: null });
    expect(parseHandoverPayload(noState, 'win-ai-1')).toBeNull();

    const noPane = JSON.stringify({ ...payload, paneId: '' });
    expect(parseHandoverPayload(noPane, 'win-ai-1')).toBeNull();
  });

  it('survives corrupt entry rows instead of failing the whole handover', () => {
    const messy = JSON.stringify({
      ...payload,
      messages: [['t1', [{ role: 'user', content: 'hi' }]], 'garbage', ['only-one-element'], 42],
      tokens: 'not an array',
    });
    const got = parseHandoverPayload(messy, 'win-ai-1');
    expect(got).not.toBeNull();
    expect(got!.messages).toHaveLength(1);
    expect(got!.tokens).toEqual([]);
  });
});

describe('handover ack', () => {
  it('round-trips and names the workers that actually moved', () => {
    const ack = buildHandoverAck({
      to: 'main',
      from: 'win-ai-1',
      paneId: 'ai-abc',
      adopted: ['h-1', 'h-2'],
    });
    const got = parseHandoverAck(JSON.stringify(ack), 'main', 'ai-abc');
    expect(got).not.toBeNull();
    expect(got!.from).toBe('win-ai-1');
    expect(got!.adopted).toEqual(['h-1', 'h-2']);
  });

  it('ignores an ack for a different window or a different conversation', () => {
    const raw = JSON.stringify(
      buildHandoverAck({ to: 'main', from: 'win-ai-1', paneId: 'ai-abc', adopted: [] }),
    );
    expect(parseHandoverAck(raw, 'win-2', 'ai-abc')).toBeNull();
    expect(parseHandoverAck(raw, 'main', 'ai-other')).toBeNull();
  });

  it('never throws on malformed input', () => {
    for (const bad of ['', '{', 'null', '{"v":9}']) {
      expect(() => parseHandoverAck(bad, 'main', 'ai-abc')).not.toThrow();
      expect(parseHandoverAck(bad, 'main', 'ai-abc')).toBeNull();
    }
  });
});

describe('watch request', () => {
  it('round-trips a request addressed to this window', () => {
    const raw = JSON.stringify(buildWatchRequest('win-ai-1', 's-abc'));
    const got = parseWatchRequest(raw, 'win-ai-1');
    expect(got).not.toBeNull();
    expect(got!.sessionId).toBe('s-abc');
  });

  it('ignores a request addressed to a different window', () => {
    const raw = JSON.stringify(buildWatchRequest('win-ai-1', 's-abc'));
    expect(parseWatchRequest(raw, 'main')).toBeNull();
  });

  it('refuses a request with no session and never throws', () => {
    expect(parseWatchRequest(JSON.stringify({ v: 1, to: 'win-ai-1', sessionId: '' }), 'win-ai-1')).toBeNull();
    for (const bad of ['', '{', 'null', '[]', '{"v":99,"to":"win-ai-1","sessionId":"s"}']) {
      expect(() => parseWatchRequest(bad, 'win-ai-1')).not.toThrow();
      expect(parseWatchRequest(bad, 'win-ai-1')).toBeNull();
    }
  });

  it('uses a channel distinct from the handover channels', () => {
    // All three ride the one shared-store broadcast, so a collision would make
    // one kind of message get parsed as another.
    expect(new Set([AI_HANDOVER_CHANNEL, AI_HANDOVER_ACK_CHANNEL, AI_WATCH_REQUEST_CHANNEL]).size).toBe(3);
  });
});

describe('adopt-session request', () => {
  it('round-trips a worker descriptor addressed to this window', () => {
    const raw = JSON.stringify(buildAdoptRequest('main', worker('h-7', 't1')));
    const got = parseAdoptRequest(raw, 'main');
    expect(got).not.toBeNull();
    expect(got!.worker.id).toBe('h-7');
    expect(got!.worker.displayName).toBe('sw-01');
  });

  it('ignores a request addressed to a different window', () => {
    const raw = JSON.stringify(buildAdoptRequest('main', worker('h-7', 't1')));
    expect(parseAdoptRequest(raw, 'win-2')).toBeNull();
  });

  it('refuses a request whose worker is unusable, and never throws', () => {
    const base = buildAdoptRequest('main', worker('h-7', 't1'));
    expect(parseAdoptRequest(JSON.stringify({ ...base, worker: null }), 'main')).toBeNull();
    expect(parseAdoptRequest(JSON.stringify({ ...base, worker: { ...base.worker, id: '' } }), 'main')).toBeNull();
    expect(parseAdoptRequest(JSON.stringify({ ...base, worker: { ...base.worker, protocol: '' } }), 'main')).toBeNull();
    for (const bad of ['', '{', 'null', '[]']) {
      expect(() => parseAdoptRequest(bad, 'main')).not.toThrow();
      expect(parseAdoptRequest(bad, 'main')).toBeNull();
    }
  });

  it('carries no credentials', () => {
    // The worker store never holds secrets, and this rides an app-wide
    // broadcast — so the assertion is on the wire shape, not on intent.
    const raw = JSON.stringify(buildAdoptRequest('main', worker('h-7', 't1')));
    expect(raw).not.toMatch(/password|privateKey|passphrase/i);
  });

  it('uses a channel distinct from every other handover channel', () => {
    expect(
      new Set([
        AI_HANDOVER_CHANNEL,
        AI_HANDOVER_ACK_CHANNEL,
        AI_WATCH_REQUEST_CHANNEL,
        AI_ADOPT_SESSION_CHANNEL,
      ]).size,
    ).toBe(4);
  });
});
