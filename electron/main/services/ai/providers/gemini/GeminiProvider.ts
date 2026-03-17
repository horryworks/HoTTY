import { BrowserWindow } from 'electron';
import { IAIProvider, AuthStatus, ModelInfo, ChatResponseData } from '../../IAIProvider';
import { GeminiService } from '../../../gemini';

export class GeminiProvider implements IAIProvider {
  readonly id = 'gemini';
  readonly displayName = 'Google AI Studio (Gemini)';
  readonly authType = 'oauth2' as const;

  private service: GeminiService;

  constructor() {
    this.service = new GeminiService();
  }

  async authenticate(
    win: BrowserWindow,
    credentials: unknown,
    onResult: (result: { success: boolean }) => void,
  ): Promise<boolean> {
    const { clientId, clientSecret } = credentials as { clientId: string; clientSecret: string };
    return this.service.startAuth(win, clientId, clientSecret, onResult);
  }

  async autoAuth(credentials: unknown): Promise<boolean> {
    const { clientId, clientSecret } = credentials as { clientId: string; clientSecret: string };
    return this.service.autoAuth(clientId, clientSecret);
  }

  getAuthStatus(): AuthStatus {
    return { authenticated: this.service.isAuthenticated() };
  }

  logout(): void {
    this.service.logout();
  }

  async sendMessage(
    onResponse: (data: ChatResponseData) => void,
    sessionId: string,
    message: string,
    model: string,
    systemInstruction?: string,
  ): Promise<void> {
    await this.service.sendMessage(onResponse, sessionId, message, model, systemInstruction);
  }

  cancelMessage(sessionId: string): void {
    this.service.cancelMessage(sessionId);
  }

  clearHistory(sessionId: string): void {
    this.service.clearHistory(sessionId);
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.service.listModels();
  }
}
