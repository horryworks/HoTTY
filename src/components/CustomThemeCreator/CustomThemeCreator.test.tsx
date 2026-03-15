import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CustomThemeCreator } from './CustomThemeCreator';

vi.mock('../../services/electronService', () => ({
    getThemes: vi.fn(() => Promise.resolve({})),
    getSshAlgorithms: vi.fn(() => Promise.resolve({ kex: [], cipher: [], mac: [], compress: [] })),
    saveSshAlgorithms: vi.fn(),
    saveCustomTheme: vi.fn(() => Promise.resolve({ success: true })),
    deleteCustomTheme: vi.fn(),
    selectImage: vi.fn(),
    selectFolder: vi.fn(),
    updateLogging: vi.fn(),
    openDebugLogFolder: vi.fn(),
    logDebug: vi.fn(),
    getAppVersion: vi.fn(() => Promise.resolve('1.0.0')),
}));

const sampleThemeDef = {
    name: 'Dark',
    variables: {
        'bg-primary': '#1e1e1e',
        'bg-secondary': '#252526',
        'text-primary': '#cccccc',
        'border-color': '#444',
        'accent-color': '#007acc',
    },
    terminal: {
        foreground: '#cccccc',
        background: '#1e1e1e',
        backgroundInactive: '#2d2d2d',
        paneBackground: '#1a1a1a',
    },
};

const baseProps = {
    isOpen: true,
    themesData: {
        dark: sampleThemeDef,
        medium: { name: 'Medium', variables: { 'bg-primary': '#2d2d2d', 'text-primary': '#eee', 'border-color': '#555', 'accent-color': '#0090c1' }, terminal: { foreground: '#eee', background: '#2d2d2d', backgroundInactive: '#333', paneBackground: '#252525' } },
        light: { name: 'Light', variables: { 'bg-primary': '#ffffff', 'text-primary': '#000', 'border-color': '#ccc', 'accent-color': '#0066aa' }, terminal: { foreground: '#000', background: '#fff', backgroundInactive: '#f0f0f0', paneBackground: '#e8e8e8' } },
    },
    currentTheme: 'dark',
    onSave: vi.fn(),
    onCancel: vi.fn(),
};

describe('CustomThemeCreator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when isOpen is false', () => {
        const { container } = render(<CustomThemeCreator {...baseProps} isOpen={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders "Custom Theme Creator" heading when open', () => {
        render(<CustomThemeCreator {...baseProps} />);
        expect(screen.getByText('Custom Theme Creator')).toBeInTheDocument();
    });

    it('renders Theme Name input', () => {
        render(<CustomThemeCreator {...baseProps} />);
        expect(screen.getByPlaceholderText('e.g. My Dark Blue')).toBeInTheDocument();
    });

    it('renders Base Theme select', () => {
        render(<CustomThemeCreator {...baseProps} />);
        expect(screen.getByText('Base Theme')).toBeInTheDocument();
    });

    it('renders base theme options', () => {
        render(<CustomThemeCreator {...baseProps} />);
        expect(screen.getByText('Dark')).toBeInTheDocument();
        expect(screen.getByText('Medium')).toBeInTheDocument();
        expect(screen.getByText('Light')).toBeInTheDocument();
    });

    it('renders Save Theme button', () => {
        render(<CustomThemeCreator {...baseProps} />);
        expect(screen.getByText('Save Theme')).toBeInTheDocument();
    });

    it('renders Cancel button', () => {
        render(<CustomThemeCreator {...baseProps} />);
        const cancelButtons = screen.getAllByText('Cancel');
        expect(cancelButtons.length).toBeGreaterThan(0);
    });

    it('calls onCancel when Cancel button is clicked', () => {
        const onCancel = vi.fn();
        render(<CustomThemeCreator {...baseProps} onCancel={onCancel} />);
        const cancelButtons = screen.getAllByText('Cancel');
        fireEvent.click(cancelButtons[0]);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when close (✕) button is clicked', () => {
        const onCancel = vi.fn();
        render(<CustomThemeCreator {...baseProps} onCancel={onCancel} />);
        const closeBtn = screen.getByTitle('Cancel');
        fireEvent.click(closeBtn);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('shows an error when Save is clicked with no theme name', async () => {
        render(<CustomThemeCreator {...baseProps} />);
        fireEvent.click(screen.getByText('Save Theme'));
        await waitFor(() => {
            expect(screen.getByText('Please enter a theme name.')).toBeInTheDocument();
        });
    });

    it('shows an error when theme name is a protected name', async () => {
        render(<CustomThemeCreator {...baseProps} />);
        const nameInput = screen.getByPlaceholderText('e.g. My Dark Blue');
        fireEvent.change(nameInput, { target: { value: 'dark' } });
        fireEvent.click(screen.getByText('Save Theme'));
        await waitFor(() => {
            expect(screen.getByText('Cannot use "dark", "medium", or "light" as a theme name.')).toBeInTheDocument();
        });
    });

    it('clears the error when name input changes', async () => {
        render(<CustomThemeCreator {...baseProps} />);
        fireEvent.click(screen.getByText('Save Theme'));
        await waitFor(() => {
            expect(screen.getByText('Please enter a theme name.')).toBeInTheDocument();
        });
        const nameInput = screen.getByPlaceholderText('e.g. My Dark Blue');
        fireEvent.change(nameInput, { target: { value: 'My Theme' } });
        expect(screen.queryByText('Please enter a theme name.')).not.toBeInTheDocument();
    });

    it('calls saveCustomTheme and onSave on successful save', async () => {
        const { saveCustomTheme } = await import('../../services/electronService');
        const onSave = vi.fn();
        render(<CustomThemeCreator {...baseProps} onSave={onSave} />);
        const nameInput = screen.getByPlaceholderText('e.g. My Dark Blue');
        fireEvent.change(nameInput, { target: { value: 'My Awesome Theme' } });
        fireEvent.click(screen.getByText('Save Theme'));
        await waitFor(() => {
            expect(saveCustomTheme).toHaveBeenCalledWith('my_awesome_theme', expect.any(Object));
            expect(onSave).toHaveBeenCalledWith('my_awesome_theme');
        });
    });

    it('renders Terminal section', () => {
        render(<CustomThemeCreator {...baseProps} />);
        expect(screen.getByText('Terminal')).toBeInTheDocument();
    });

    it('renders theme section titles from THEME_SECTIONS', () => {
        render(<CustomThemeCreator {...baseProps} />);
        expect(screen.getByText('Backgrounds & Text')).toBeInTheDocument();
    });

    it('changes base theme when select value changes', () => {
        render(<CustomThemeCreator {...baseProps} />);
        const selects = screen.getAllByRole('combobox');
        fireEvent.change(selects[0], { target: { value: 'light' } });
        // After changing base theme the select should reflect the new value
        expect((selects[0] as HTMLSelectElement).value).toBe('light');
    });

    it('shows "Saving..." on button when save is in progress', async () => {
        const { saveCustomTheme } = await import('../../services/electronService');
        // Make save delay so we can catch the intermediate state
        let resolveSave!: (value: unknown) => void;
        (saveCustomTheme as ReturnType<typeof vi.fn>).mockImplementationOnce(
            () => new Promise(resolve => { resolveSave = resolve; })
        );
        render(<CustomThemeCreator {...baseProps} />);
        const nameInput = screen.getByPlaceholderText('e.g. My Dark Blue');
        fireEvent.change(nameInput, { target: { value: 'My Theme' } });
        await act(async () => {
            fireEvent.click(screen.getByText('Save Theme'));
        });
        expect(screen.getByText('Saving...')).toBeInTheDocument();
        await act(async () => {
            resolveSave({ success: true });
        });
    });
});
