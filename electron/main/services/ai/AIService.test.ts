// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../Logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('electron', () => ({
    BrowserWindow: vi.fn(),
}));

import { AIService } from './AIService';
import { AIProviderRegistry } from './AIProviderRegistry';
import { IAIProvider, ChatResponseData } from './IAIProvider';

function makeMockProvider(id: string): IAIProvider {
    return {
        id,
        displayName: `Mock Provider ${id}`,
        authType: 'api_key',
        authenticate: vi.fn(async () => true),
        autoAuth: vi.fn(async () => true),
        getAuthStatus: vi.fn(() => ({ authenticated: true })),
        logout: vi.fn(),
        sendMessage: vi.fn(async () => {}),
        cancelMessage: vi.fn(),
        clearHistory: vi.fn(),
        listModels: vi.fn(async () => [{ name: 'model-1', displayName: 'Model 1' }]),
    };
}

function makeMockWin(): any {
    return { webContents: { send: vi.fn() } };
}

describe('AIService', () => {
    let registry: AIProviderRegistry;
    let provider: IAIProvider;
    let service: AIService;

    beforeEach(() => {
        registry = new AIProviderRegistry();
        provider = makeMockProvider('mock');
        registry.register(provider);
        service = new AIService(registry, 'mock');
    });

    it('listProviders returns registered providers', () => {
        const list = service.listProviders();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe('mock');
        expect(list[0].displayName).toBe('Mock Provider mock');
    });

    it('setActiveProvider switches the active provider', () => {
        const other = makeMockProvider('other');
        registry.register(other);

        service.setActiveProvider('other');

        // Verify 'other' provider is now active by checking delegation
        service.logout();
        expect(other.logout).toHaveBeenCalled();
    });

    it('setActiveProvider ignores unknown provider id', () => {
        service.setActiveProvider('nonexistent');
        // Still delegates to original 'mock' provider
        service.logout();
        expect(provider.logout).toHaveBeenCalled();
    });

    it('getAuthStatus delegates to active provider', () => {
        const status = service.getAuthStatus();
        expect(provider.getAuthStatus).toHaveBeenCalled();
        expect(status.authenticated).toBe(true);
    });

    it('logout delegates to active provider', () => {
        service.logout();
        expect(provider.logout).toHaveBeenCalled();
    });

    it('autoAuth delegates to active provider', async () => {
        const result = await service.autoAuth({ clientId: 'id', clientSecret: 'secret' });
        expect(provider.autoAuth).toHaveBeenCalledWith({ clientId: 'id', clientSecret: 'secret' });
        expect(result).toBe(true);
    });

    it('listModels delegates to active provider', async () => {
        const models = await service.listModels();
        expect(provider.listModels).toHaveBeenCalled();
        expect(models).toEqual([{ name: 'model-1', displayName: 'Model 1' }]);
    });

    it('setLocation delegates to provider if setLocation exists', () => {
        provider.setLocation = vi.fn();
        service.setLocation('us-east5');
        expect(provider.setLocation).toHaveBeenCalledWith('us-east5');
    });

    it('setLocation does not throw when provider has no setLocation', () => {
        delete provider.setLocation;
        expect(() => service.setLocation('us-east5')).not.toThrow();
    });

    it('listLocations delegates to provider if listLocations exists', async () => {
        provider.listLocations = vi.fn(async () => ['us-central1', 'us-east1']);
        const locations = await service.listLocations();
        expect(provider.listLocations).toHaveBeenCalled();
        expect(locations).toEqual(['us-central1', 'us-east1']);
    });

    it('listLocations returns empty array when provider has no listLocations', async () => {
        delete provider.listLocations;
        const locations = await service.listLocations();
        expect(locations).toEqual([]);
    });

    it('cancelMessage delegates to active provider', () => {
        service.cancelMessage('session-1');
        expect(provider.cancelMessage).toHaveBeenCalledWith('session-1');
    });

    it('clearHistory delegates to active provider', () => {
        service.clearHistory('session-1');
        expect(provider.clearHistory).toHaveBeenCalledWith('session-1');
    });

    it('sendMessage sends ai-chat-response', async () => {
        const win = makeMockWin();
        vi.mocked(provider.sendMessage).mockImplementation(async (onResponse) => {
            const data: ChatResponseData = { sessionId: 'sess', type: 'done', content: 'hi' };
            onResponse(data);
        });

        await service.sendMessage(win, 'sess', 'hello', 'model-1');

        expect(win.webContents.send).toHaveBeenCalledWith('ai-chat-response', expect.objectContaining({ sessionId: 'sess' }));
        expect(win.webContents.send).toHaveBeenCalledTimes(1);
    });

    it('authenticate delegates to active provider with onResult callback', async () => {
        const win = makeMockWin();
        const onResult = vi.fn();

        await service.authenticate(win, { clientId: 'id', clientSecret: 'secret' }, onResult);

        expect(provider.authenticate).toHaveBeenCalledWith(win, { clientId: 'id', clientSecret: 'secret' }, onResult);
    });

    it('throws when active provider is not found in registry', () => {
        const emptyRegistry = new AIProviderRegistry();
        const badService = new AIService(emptyRegistry, 'missing');

        expect(() => badService.getAuthStatus()).toThrow("AI provider 'missing' not found");
    });
});
