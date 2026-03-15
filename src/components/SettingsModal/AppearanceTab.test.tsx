import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppearanceTab } from './AppearanceTab';

vi.mock('../../services/electronService', () => ({
    getThemes: vi.fn(() => Promise.resolve({})),
    getSshAlgorithms: vi.fn(() => Promise.resolve({ kex: [], cipher: [], mac: [], compress: [] })),
    saveSshAlgorithms: vi.fn(),
    saveCustomTheme: vi.fn(),
    deleteCustomTheme: vi.fn(),
    selectImage: vi.fn(() => Promise.resolve(null)),
    selectFolder: vi.fn(),
    updateLogging: vi.fn(),
    openDebugLogFolder: vi.fn(),
    logDebug: vi.fn(),
    getAppVersion: vi.fn(() => Promise.resolve('1.0.0')),
}));

const baseProps = {
    theme: 'dark',
    onThemeChange: vi.fn(),
    onOpenCustomThemeCreator: vi.fn(),
    onDeleteTheme: vi.fn(),
    themesData: {
        dark: { name: 'Dark', variables: {}, terminal: {} },
        medium: { name: 'Medium', variables: {}, terminal: {} },
        light: { name: 'Light', variables: {}, terminal: {} },
    },
    sidebarPosition: 'right' as const,
    onSidebarPositionChange: vi.fn(),
    paneBackground: '#1e1e1e',
    onPaneBackgroundChange: vi.fn(),
    paneBackgroundMode: 'color' as const,
    onPaneBackgroundModeChange: vi.fn(),
    paneBackgroundImage: '',
    onPaneBackgroundImageChange: vi.fn(),
    fontFamily: 'Consolas, "Courier New", monospace',
    onFontFamilyChange: vi.fn(),
    fontSize: 14,
    onFontSizeChange: vi.fn(),
    encoding: 'utf8',
    onEncodingChange: vi.fn(),
    enablePromptHighlight: false,
    onEnablePromptHighlightChange: vi.fn(),
    promptHighlightColor: '#ffff00',
    onPromptHighlightColorChange: vi.fn(),
    promptPatterns: [],
    onPromptPatternsChange: vi.fn(),
};

describe('AppearanceTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders without crashing', () => {
        const { container } = render(<AppearanceTab {...baseProps} />);
        expect(container).toBeTruthy();
    });

    it('renders Toolbar Position section', () => {
        render(<AppearanceTab {...baseProps} />);
        expect(screen.getByText('Toolbar Position')).toBeInTheDocument();
    });

    it('renders left and right radio buttons for sidebar position', () => {
        render(<AppearanceTab {...baseProps} />);
        const radios = screen.getAllByRole('radio');
        const leftRadio = radios.find(r => (r as HTMLInputElement).value === 'left');
        const rightRadio = radios.find(r => (r as HTMLInputElement).value === 'right');
        expect(leftRadio).toBeInTheDocument();
        expect(rightRadio).toBeInTheDocument();
    });

    it('calls onSidebarPositionChange when left radio is selected', () => {
        const onSidebarPositionChange = vi.fn();
        render(<AppearanceTab {...baseProps} onSidebarPositionChange={onSidebarPositionChange} />);
        const radios = screen.getAllByRole('radio');
        const leftRadio = radios.find(r => (r as HTMLInputElement).value === 'left')!;
        fireEvent.click(leftRadio);
        expect(onSidebarPositionChange).toHaveBeenCalledWith('left');
    });

    it('renders Theme section', () => {
        render(<AppearanceTab {...baseProps} />);
        expect(screen.getByText('Theme')).toBeInTheDocument();
    });

    it('renders theme select with correct options', () => {
        render(<AppearanceTab {...baseProps} />);
        const selects = screen.getAllByRole('combobox');
        // The first combobox is the theme select
        const themeSelect = selects[0] as HTMLSelectElement;
        expect(themeSelect.value).toBe('dark');
        expect(screen.getByText('Dark')).toBeInTheDocument();
        expect(screen.getByText('Medium')).toBeInTheDocument();
        expect(screen.getByText('Light')).toBeInTheDocument();
    });

    it('calls onThemeChange when theme is changed', () => {
        const onThemeChange = vi.fn();
        render(<AppearanceTab {...baseProps} onThemeChange={onThemeChange} />);
        const selects = screen.getAllByRole('combobox');
        fireEvent.change(selects[0], { target: { value: 'light' } });
        expect(onThemeChange).toHaveBeenCalledWith('light');
    });

    it('renders Create Custom Theme button', () => {
        render(<AppearanceTab {...baseProps} />);
        expect(screen.getByText('+ Create Custom Theme')).toBeInTheDocument();
    });

    it('calls onOpenCustomThemeCreator when Create Custom Theme is clicked', () => {
        const onOpenCustomThemeCreator = vi.fn();
        render(<AppearanceTab {...baseProps} onOpenCustomThemeCreator={onOpenCustomThemeCreator} />);
        fireEvent.click(screen.getByText('+ Create Custom Theme'));
        expect(onOpenCustomThemeCreator).toHaveBeenCalledTimes(1);
    });

    it('renders Font Family select', () => {
        render(<AppearanceTab {...baseProps} />);
        expect(screen.getByText('Font Family')).toBeInTheDocument();
    });

    it('renders Font Size input', () => {
        render(<AppearanceTab {...baseProps} />);
        expect(screen.getByText('Font Size')).toBeInTheDocument();
        const numberInputs = screen.getAllByRole('spinbutton');
        expect(numberInputs.length).toBeGreaterThan(0);
    });

    it('calls onFontSizeChange when font size changes', () => {
        const onFontSizeChange = vi.fn();
        render(<AppearanceTab {...baseProps} onFontSizeChange={onFontSizeChange} />);
        const numberInputs = screen.getAllByRole('spinbutton');
        fireEvent.change(numberInputs[0], { target: { value: '16' } });
        expect(onFontSizeChange).toHaveBeenCalledWith(16);
    });

    it('renders Default Encoding select', () => {
        render(<AppearanceTab {...baseProps} />);
        expect(screen.getByText('Default Encoding')).toBeInTheDocument();
    });

    it('renders Prompt Highlight section', () => {
        render(<AppearanceTab {...baseProps} />);
        expect(screen.getByText('Prompt Highlight')).toBeInTheDocument();
    });

    it('shows prompt pattern controls when enablePromptHighlight is true', () => {
        render(<AppearanceTab {...baseProps} enablePromptHighlight={true} />);
        expect(screen.getByText('+ Add Pattern')).toBeInTheDocument();
    });

    it('does not show pattern controls when enablePromptHighlight is false', () => {
        render(<AppearanceTab {...baseProps} enablePromptHighlight={false} />);
        expect(screen.queryByText('+ Add Pattern')).not.toBeInTheDocument();
    });

    it('calls onEnablePromptHighlightChange when highlight checkbox changes', () => {
        const onEnablePromptHighlightChange = vi.fn();
        render(<AppearanceTab {...baseProps} onEnablePromptHighlightChange={onEnablePromptHighlightChange} />);
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]);
        expect(onEnablePromptHighlightChange).toHaveBeenCalled();
    });

    it('renders image mode controls when paneBackgroundMode is image', () => {
        render(<AppearanceTab {...baseProps} paneBackgroundMode="image" />);
        expect(screen.getByText('Browse...')).toBeInTheDocument();
    });

    it('does not show Delete button for default themes', () => {
        render(<AppearanceTab {...baseProps} theme="dark" />);
        expect(screen.queryByText(/Delete/)).not.toBeInTheDocument();
    });

    it('shows Delete button for custom themes', () => {
        const propsWithCustomTheme = {
            ...baseProps,
            theme: 'my_custom',
            themesData: {
                ...baseProps.themesData,
                my_custom: { name: 'My Custom', variables: {}, terminal: {} },
            },
        };
        render(<AppearanceTab {...propsWithCustomTheme} />);
        expect(screen.getByText(/Delete/)).toBeInTheDocument();
    });
});
