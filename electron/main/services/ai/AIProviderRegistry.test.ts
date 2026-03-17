// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { AIProviderRegistry } from './AIProviderRegistry';
import { IAIProvider } from './IAIProvider';

function makeProvider(id: string): IAIProvider {
    return {
        id,
        displayName: `Provider ${id}`,
        authType: 'api_key',
        authenticate: vi.fn(),
        autoAuth: vi.fn(),
        getAuthStatus: vi.fn(() => ({ authenticated: false })),
        logout: vi.fn(),
        sendMessage: vi.fn(),
        cancelMessage: vi.fn(),
        clearHistory: vi.fn(),
        listModels: vi.fn(async () => []),
    };
}

describe('AIProviderRegistry', () => {
    it('registers and retrieves a provider by id', () => {
        const registry = new AIProviderRegistry();
        const provider = makeProvider('test');

        registry.register(provider);

        expect(registry.get('test')).toBe(provider);
    });

    it('returns undefined for unknown provider id', () => {
        const registry = new AIProviderRegistry();

        expect(registry.get('unknown')).toBeUndefined();
    });

    it('lists all registered providers', () => {
        const registry = new AIProviderRegistry();
        const p1 = makeProvider('a');
        const p2 = makeProvider('b');

        registry.register(p1);
        registry.register(p2);

        const list = registry.list();
        expect(list).toHaveLength(2);
        expect(list).toContain(p1);
        expect(list).toContain(p2);
    });

    it('overwrites a provider registered with the same id', () => {
        const registry = new AIProviderRegistry();
        const original = makeProvider('dup');
        const replacement = makeProvider('dup');

        registry.register(original);
        registry.register(replacement);

        expect(registry.get('dup')).toBe(replacement);
        expect(registry.list()).toHaveLength(1);
    });
});
