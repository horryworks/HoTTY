import { describe, it, expect, vi } from 'vitest';

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({
    render: vi.fn(),
  })),
}));

vi.mock('./App', () => ({
  default: () => null,
}));

describe('main', () => {
  it('calls createRoot with root element', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    const { createRoot } = await import('react-dom/client');
    await import('./main');

    // main.tsx defers the first render until `i18nReady` resolves so a
    // non-English user never sees a frame of English. For 'en' (the default in
    // tests) that promise is already resolved, so this only has to survive one
    // microtask hop — but wait properly rather than rely on queue ordering.
    await vi.waitFor(() => expect(createRoot).toHaveBeenCalledWith(root));

    document.body.removeChild(root);
  });
});
