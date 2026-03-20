import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-dom/client', () => ({
    createRoot: vi.fn(() => ({
        render: vi.fn(),
    })),
}));

vi.mock('./App.tsx', () => ({
    default: () => null,
}));

describe('main', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '<div id="root"></div>';
    });

    it('calls createRoot with the root element and renders', async () => {
        const { createRoot } = await import('react-dom/client');
        await import('./main');
        expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'));
    });
});
