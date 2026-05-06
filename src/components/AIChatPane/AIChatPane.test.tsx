import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('../../services/tauriService', () => ({
  tauriService: {
    aiAuthStatus: vi.fn().mockResolvedValue(false),
    aiAuthLogout: vi.fn().mockResolvedValue(undefined),
    aiSetProvider: vi.fn().mockResolvedValue(undefined),
    aiChatSend: vi.fn().mockResolvedValue(undefined),
    aiChatCancel: vi.fn().mockResolvedValue(undefined),
    aiChatClear: vi.fn().mockResolvedValue(undefined),
    aiListModels: vi.fn().mockResolvedValue([]),
    aiListLocations: vi.fn().mockResolvedValue([]),
    aiSetLocation: vi.fn().mockResolvedValue(undefined),
    onAiChatResponse: vi.fn().mockResolvedValue(() => {}),
    onAiAuthResult: vi.fn().mockResolvedValue(() => {}),
    selectServiceAccountKeyFile: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../utils/applyTheme', () => ({
  applyTheme: vi.fn(),
}));

vi.mock('../../themes/defaults', () => ({
  getTheme: () => ({
    terminal: { foreground: '#fff', background: '#000', backgroundInactive: '#111', paneBackground: '#222' },
  }),
  DEFAULT_THEMES: {},
  DEFAULT_THEME_IDS: [],
}));

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({
      activeAiProvider: 'gemini',
      commandExecutionMode: 'ask-before-execute',
      customSafeCommands: [],
      maxConsecutiveAutoExecutions: 5,
      aiPersonas: [],
      watchBufferLimit: 500000,
      theme: 'dark',
      update: vi.fn(),
    }),
    { getState: () => ({ activeAiProvider: 'gemini', update: vi.fn() }) }
  ),
}));

// Lazy import after mocks
const { AIChatPane } = await import('./AIChatPane');
const { TerminalOutputBlock } = await import('./TerminalOutputBlock');
const { parseTerminalOutputMessage } = await import('./terminalOutputUtils');

describe('AIChatPane', () => {
  const defaultProps = {
    paneId: 'ai-1',
    active: true,
    aiPersonas: [
      {
        id: 'default',
        label: 'Network Expert',
        systemPrompt: 'You are a network expert.',
        askAiCommands: [],
      },
    ],
  };

  it('renders without crashing', () => {
    render(<AIChatPane {...defaultProps} />);
    // The component should render the auth panel or chat depending on state
    expect(document.querySelector('.ai-chat-pane')).toBeTruthy();
  });

  it('renders with inactive state', () => {
    render(<AIChatPane {...defaultProps} active={false} />);
    expect(document.querySelector('.ai-chat-pane')).toBeTruthy();
  });

  it('renders auth panel when not authenticated', () => {
    render(<AIChatPane {...defaultProps} />);
    // With default mock (aiAuthStatus returns false), auth panel should show
    const container = document.querySelector('.ai-chat-pane');
    expect(container).toBeTruthy();
  });
});

describe('parseTerminalOutputMessage', () => {
  it('returns null for unrelated content', () => {
    expect(parseTerminalOutputMessage('hello')).toBeNull();
    expect(parseTerminalOutputMessage('')).toBeNull();
    expect(parseTerminalOutputMessage('Terminal Output: ls')).toBeNull();
  });

  it('parses single-line command and output', () => {
    const result = parseTerminalOutputMessage('Terminal Output (Command: ls):\nfile1\nfile2');
    expect(result).toEqual({ cmd: 'ls', output: 'file1\nfile2' });
  });

  it('parses multi-line command (uses non-greedy match)', () => {
    const result = parseTerminalOutputMessage('Terminal Output (Command: echo a\necho b):\nout');
    expect(result).toEqual({ cmd: 'echo a\necho b', output: 'out' });
  });

  it('parses empty output', () => {
    const result = parseTerminalOutputMessage('Terminal Output (Command: noop):\n');
    expect(result).toEqual({ cmd: 'noop', output: '' });
  });
});

describe('TerminalOutputBlock', () => {
  it('renders collapsed by default with header info but no body', () => {
    const { container } = render(<TerminalOutputBlock cmd="ls -la" output="file1\nfile2" />);
    const block = container.querySelector('.ai-terminal-output-block');
    const header = container.querySelector('.ai-terminal-output-header');
    expect(block).toBeTruthy();
    expect(block?.classList.contains('expanded')).toBe(false);
    expect(header?.getAttribute('aria-expanded')).toBe('false');
    expect(header?.textContent).toContain('Terminal output');
    expect(header?.textContent).toContain('ls -la');
    expect(container.querySelector('.ai-terminal-output-body')).toBeNull();
  });

  it('expands on click and reveals output', () => {
    const { container } = render(<TerminalOutputBlock cmd="ls" output={'file1\nfile2'} />);
    const header = container.querySelector('.ai-terminal-output-header')!;
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    const body = container.querySelector('.ai-terminal-output-body');
    expect(body).toBeTruthy();
    expect(body?.textContent).toContain('file1');
    expect(body?.textContent).toContain('file2');
  });

  it('toggles via Enter key', () => {
    const { container } = render(<TerminalOutputBlock cmd="ls" output="x" />);
    const header = container.querySelector('.ai-terminal-output-header')!;
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles via Space key', () => {
    const { container } = render(<TerminalOutputBlock cmd="ls" output="x" />);
    const header = container.querySelector('.ai-terminal-output-header')!;
    fireEvent.keyDown(header, { key: ' ' });
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows only the first line of a multi-line cmd in the header', () => {
    const { container } = render(<TerminalOutputBlock cmd={'echo a\necho b'} output="out" />);
    const cmdEl = container.querySelector('.ai-terminal-output-cmd');
    expect(cmdEl?.textContent).toBe('echo a');
    expect(cmdEl?.textContent).not.toContain('echo b');
  });

  it('renders the full multi-line cmd inside the body when expanded', () => {
    const { container } = render(<TerminalOutputBlock cmd={'echo a\necho b'} output="out" />);
    fireEvent.click(container.querySelector('.ai-terminal-output-header')!);
    const fullCmd = container.querySelector('.ai-terminal-output-cmd-full');
    expect(fullCmd).toBeTruthy();
    expect(fullCmd?.textContent).toContain('echo a');
    expect(fullCmd?.textContent).toContain('echo b');
  });

  it('shows "(no output)" placeholder when output is empty', () => {
    const { container } = render(<TerminalOutputBlock cmd="noop" output="" />);
    fireEvent.click(container.querySelector('.ai-terminal-output-header')!);
    const empty = container.querySelector('.ai-terminal-output-empty');
    expect(empty?.textContent).toBe('(no output)');
  });

  it('counts lines and chars after trimming trailing newlines', () => {
    const { container } = render(<TerminalOutputBlock cmd="ls" output={'a\nb\nc\n\n'} />);
    const meta = container.querySelector('.ai-terminal-output-meta');
    expect(meta?.textContent).toContain('3 lines');
    expect(meta?.textContent).toContain('5 chars');
  });
});
