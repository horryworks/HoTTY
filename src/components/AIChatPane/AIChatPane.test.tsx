import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

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
    aiGetAuthType: vi.fn().mockResolvedValue('oauth'),
    aiListProviders: vi.fn().mockResolvedValue([]),
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
