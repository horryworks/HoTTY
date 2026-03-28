import { BrowserWindow } from 'electron';
import { AIProviderRegistry } from './AIProviderRegistry';
import { IAIProvider, AuthStatus, ModelInfo, ChatResponseData } from './IAIProvider';
import { logger } from '../Logger';

export class AIService {
  private registry: AIProviderRegistry;
  private activeProviderId: string;

  constructor(registry: AIProviderRegistry, defaultProviderId: string) {
    this.registry = registry;
    this.activeProviderId = defaultProviderId;
  }

  private getActiveProvider(): IAIProvider {
    const provider = this.registry.get(this.activeProviderId);
    if (!provider) throw new Error(`AI provider '${this.activeProviderId}' not found`);
    return provider;
  }

  setActiveProvider(id: string): void {
    if (!this.registry.get(id)) {
      logger.warn('ai', `Unknown provider: ${id}`);
      return;
    }
    this.activeProviderId = id;
  }

  listProviders(): { id: string; displayName: string; authType: string }[] {
    return this.registry.list().map(p => ({
      id: p.id,
      displayName: p.displayName,
      authType: p.authType,
    }));
  }

  async authenticate(
    win: BrowserWindow,
    credentials: unknown,
    onResult: (result: { success: boolean }) => void,
  ): Promise<boolean> {
    return this.getActiveProvider().authenticate(win, credentials, onResult);
  }

  async autoAuth(credentials: unknown): Promise<boolean> {
    return this.getActiveProvider().autoAuth(credentials);
  }

  getAuthStatus(): AuthStatus {
    return this.getActiveProvider().getAuthStatus();
  }

  logout(): void {
    this.getActiveProvider().logout();
  }

  async sendMessage(
    win: BrowserWindow,
    sessionId: string,
    message: string,
    model: string,
    systemInstruction?: string,
  ): Promise<void> {
    const provider = this.getActiveProvider();
    await provider.sendMessage(
      (data: ChatResponseData) => {
        win.webContents.send('ai-chat-response', data);
      },
      sessionId,
      message,
      model,
      systemInstruction,
    );
  }

  cancelMessage(sessionId: string): void {
    this.getActiveProvider().cancelMessage(sessionId);
  }

  clearHistory(sessionId: string): void {
    this.getActiveProvider().clearHistory(sessionId);
  }

  setLocation(location: string): void {
    this.getActiveProvider().setLocation?.(location);
  }

  async listLocations(): Promise<string[]> {
    return await this.getActiveProvider().listLocations?.() ?? [];
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.getActiveProvider().listModels();
  }
}
