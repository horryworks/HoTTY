import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IAIProvider, AuthStatus, ModelInfo, ChatResponseData, TokenUsage } from '../../IAIProvider';
import { encryptString, decryptString } from '../../../dpapi';
import { logger } from '../../../Logger';

const VALID_MODEL_PATTERN = /^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$/;
// Printable ASCII only, 1–512 chars
const VALID_API_KEY_PATTERN = /^[\x21-\x7E]{1,512}$/;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class AnthropicProvider implements IAIProvider {
  readonly id = 'anthropic';
  readonly displayName = 'Anthropic (Claude)';
  readonly authType = 'api_key' as const;

  private apiKey: string | null = null;
  private chatHistories: Map<string, ChatMessage[]> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  private getConfigFilePath(): string {
    return path.join(app.getPath('userData'), 'anthropic_config.json');
  }

  private async saveConfig(): Promise<void> {
    try {
      const encrypted = await encryptString(this.apiKey!);
      fs.writeFileSync(this.getConfigFilePath(), encrypted, 'utf8');
      logger.debug('anthropic', 'Config saved');
    } catch (err: unknown) {
      logger.error('anthropic', 'Failed to save config', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  async authenticate(
    _win: BrowserWindow,
    credentials: unknown,
    onResult: (result: { success: boolean }) => void,
  ): Promise<boolean> {
    const creds = credentials as { apiKey?: string };
    if (!creds.apiKey || !VALID_API_KEY_PATTERN.test(creds.apiKey)) {
      logger.warn('anthropic', 'Auth rejected: invalid API key format');
      onResult({ success: false });
      return false;
    }

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15000);
      let response: Response;
      try {
        response = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': creds.apiKey,
            'anthropic-version': '2023-06-01',
          },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        logger.warn('anthropic', 'API key validation failed', { status: response.status });
        onResult({ success: false });
        return false;
      }

      this.apiKey = creds.apiKey;
      await this.saveConfig();
      logger.info('anthropic', 'Auth success');
      onResult({ success: true });
      return true;
    } catch (err: unknown) {
      logger.error('anthropic', 'Auth error', { error: err instanceof Error ? err.message : String(err) });
      onResult({ success: false });
      return false;
    }
  }

  async autoAuth(credentials: unknown): Promise<boolean> {
    void credentials;
    try {
      const configPath = this.getConfigFilePath();
      if (!fs.existsSync(configPath)) return false;
      const encrypted = fs.readFileSync(configPath, 'utf8');
      const apiKey = await decryptString(encrypted);
      if (!apiKey || !VALID_API_KEY_PATTERN.test(apiKey)) return false;
      this.apiKey = apiKey;
      logger.info('anthropic', 'Auto-auth success');
      return true;
    } catch (err: unknown) {
      logger.error('anthropic', 'Auto-auth error', { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  getAuthStatus(): AuthStatus {
    return { authenticated: this.apiKey !== null };
  }

  logout(): void {
    logger.info('anthropic', 'Logout');
    this.apiKey = null;
    this.chatHistories.clear();
    try {
      const configPath = this.getConfigFilePath();
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    } catch (err: unknown) {
      logger.error('anthropic', 'Failed to delete config file', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  async sendMessage(
    onResponse: (data: ChatResponseData) => void,
    sessionId: string,
    message: string,
    model: string = 'claude-sonnet-4-6',
    systemInstruction?: string,
  ): Promise<void> {
    if (!VALID_MODEL_PATTERN.test(model)) {
      onResponse({ sessionId, type: 'error', content: 'Invalid model name.' });
      return;
    }
    if (!this.apiKey) {
      onResponse({ sessionId, type: 'error', content: 'Not authenticated. Please provide an Anthropic API key.' });
      return;
    }

    if (!this.chatHistories.has(sessionId)) {
      this.chatHistories.set(sessionId, []);
    }
    const history = this.chatHistories.get(sessionId)!;
    history.push({ role: 'user', content: message });

    const abortController = new AbortController();
    this.abortControllers.set(sessionId, abortController);

    const body: Record<string, unknown> = {
      model,
      max_tokens: 8192,
      messages: history.map(m => ({ role: m.role, content: m.content })),
      stream: true,
    };
    if (systemInstruction) {
      body.system = systemInstruction;
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API error ${response.status}: ${errorBody}`);
      }

      let fullResponse = '';
      let inputTokens = 0;
      let outputTokens = 0;
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            try {
              const parsed = JSON.parse(jsonStr);
              if (currentEvent === 'content_block_delta') {
                const text = parsed?.delta?.text || '';
                if (text) {
                  fullResponse += text;
                  onResponse({ sessionId, type: 'chunk', content: text });
                }
              } else if (currentEvent === 'message_start') {
                inputTokens = parsed?.message?.usage?.input_tokens ?? 0;
              } else if (currentEvent === 'message_delta') {
                outputTokens = parsed?.usage?.output_tokens ?? 0;
              }
            } catch {
              // skip malformed JSON chunks
            }
          }
        }
      }

      const usageMetadata: TokenUsage = {
        promptTokenCount: inputTokens,
        candidatesTokenCount: outputTokens,
        totalTokenCount: inputTokens + outputTokens,
      };

      history.push({ role: 'assistant', content: fullResponse });
      onResponse({ sessionId, type: 'done', content: fullResponse, usageMetadata });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      logger.error('anthropic', 'Chat error', { sessionId, error: err instanceof Error ? err.message : String(err) });
      onResponse({ sessionId, type: 'error', content: 'An error occurred while communicating with Anthropic. Please try again.' });
    } finally {
      this.abortControllers.delete(sessionId);
    }
  }

  cancelMessage(sessionId: string): void {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
  }

  clearHistory(sessionId: string): void {
    this.chatHistories.delete(sessionId);
  }

  private static readonly FALLBACK_MODELS: ModelInfo[] = [
    { name: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' },
    { name: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
    { name: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
  ];

  async listModels(): Promise<ModelInfo[]> {
    if (!this.apiKey) return AnthropicProvider.FALLBACK_MODELS;

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 10000);
      let response: Response;
      try {
        response = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        logger.warn('anthropic', 'listModels failed', { status: response.status });
        return AnthropicProvider.FALLBACK_MODELS;
      }

      const data = await response.json() as { data?: { id: string; display_name: string }[] };
      const models = (data.data ?? []).map(m => ({
        name: m.id,
        displayName: m.display_name,
      }));

      return models.length > 0 ? models : AnthropicProvider.FALLBACK_MODELS;
    } catch (err: unknown) {
      logger.warn('anthropic', 'listModels error', { error: err instanceof Error ? err.message : String(err) });
      return AnthropicProvider.FALLBACK_MODELS;
    }
  }
}
