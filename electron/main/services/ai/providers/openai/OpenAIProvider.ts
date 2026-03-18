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

export class OpenAIProvider implements IAIProvider {
  readonly id = 'openai';
  readonly displayName = 'OpenAI';
  readonly authType = 'api_key' as const;

  private apiKey: string | null = null;
  private chatHistories: Map<string, ChatMessage[]> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  private getConfigFilePath(): string {
    return path.join(app.getPath('userData'), 'openai_config.json');
  }

  private async saveConfig(): Promise<void> {
    try {
      const encrypted = await encryptString(this.apiKey!);
      fs.writeFileSync(this.getConfigFilePath(), encrypted, 'utf8');
      logger.debug('openai', 'Config saved');
    } catch (err: unknown) {
      logger.error('openai', 'Failed to save config', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  async authenticate(
    _win: BrowserWindow,
    credentials: unknown,
    onResult: (result: { success: boolean }) => void,
  ): Promise<boolean> {
    const creds = credentials as { apiKey?: string };
    if (!creds.apiKey || !VALID_API_KEY_PATTERN.test(creds.apiKey)) {
      logger.warn('openai', 'Auth rejected: invalid API key format');
      onResult({ success: false });
      return false;
    }

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15000);
      let response: Response;
      const url = 'https://api.openai.com/v1/models';
      logger.debug('openai', 'Validating API key', { url });
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${creds.apiKey}` },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        logger.warn('openai', 'API key validation failed', { status: response.status });
        onResult({ success: false });
        return false;
      }

      this.apiKey = creds.apiKey;
      await this.saveConfig();
      logger.info('openai', 'Auth success');
      onResult({ success: true });
      return true;
    } catch (err: unknown) {
      logger.error('openai', 'Auth error', { error: err instanceof Error ? err.message : String(err) });
      onResult({ success: false });
      return false;
    }
  }

  async autoAuth(credentials: unknown): Promise<boolean> {
    void credentials; // API key is loaded from the encrypted config file on disk
    try {
      const configPath = this.getConfigFilePath();
      if (!fs.existsSync(configPath)) return false;
      const encrypted = fs.readFileSync(configPath, 'utf8');
      const apiKey = await decryptString(encrypted);
      if (!apiKey || !VALID_API_KEY_PATTERN.test(apiKey)) return false;
      this.apiKey = apiKey;
      logger.info('openai', 'Auto-auth success');
      return true;
    } catch (err: unknown) {
      logger.error('openai', 'Auto-auth error', { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  getAuthStatus(): AuthStatus {
    return { authenticated: this.apiKey !== null };
  }

  logout(): void {
    logger.info('openai', 'Logout');
    this.apiKey = null;
    this.chatHistories.clear();
    try {
      const configPath = this.getConfigFilePath();
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    } catch (err: unknown) {
      logger.error('openai', 'Failed to delete config file', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  async sendMessage(
    onResponse: (data: ChatResponseData) => void,
    sessionId: string,
    message: string,
    model: string = 'gpt-4o-mini',
    systemInstruction?: string,
  ): Promise<void> {
    if (!VALID_MODEL_PATTERN.test(model)) {
      onResponse({ sessionId, type: 'error', content: 'Invalid model name.' });
      return;
    }
    if (!this.apiKey) {
      onResponse({ sessionId, type: 'error', content: 'Not authenticated. Please provide an OpenAI API key.' });
      return;
    }

    if (!this.chatHistories.has(sessionId)) {
      this.chatHistories.set(sessionId, []);
    }
    const history = this.chatHistories.get(sessionId)!;
    history.push({ role: 'user', content: message });

    const messages: { role: string; content: string }[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }

    const abortController = new AbortController();
    this.abortControllers.set(sessionId, abortController);

    const url = 'https://api.openai.com/v1/chat/completions';
    logger.debug('openai', 'Sending message', { url, model });
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API error ${response.status}: ${errorBody}`);
      }

      let fullResponse = '';
      let lastUsageMetadata: TokenUsage | null = null;
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const text = parsed?.choices?.[0]?.delta?.content || '';
              if (text) {
                fullResponse += text;
                onResponse({ sessionId, type: 'chunk', content: text });
              }
              if (parsed?.usage) {
                lastUsageMetadata = {
                  promptTokenCount: parsed.usage.prompt_tokens,
                  candidatesTokenCount: parsed.usage.completion_tokens,
                  totalTokenCount: parsed.usage.total_tokens,
                };
              }
            } catch {
              // skip malformed JSON chunks
            }
          }
        }
      }

      history.push({ role: 'assistant', content: fullResponse });
      onResponse({ sessionId, type: 'done', content: fullResponse, usageMetadata: lastUsageMetadata ?? undefined });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      logger.error('openai', 'Chat error', { sessionId, error: err instanceof Error ? err.message : String(err) });
      onResponse({ sessionId, type: 'error', content: 'An error occurred while communicating with OpenAI. Please try again.' });
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
    { name: 'gpt-4o', displayName: 'GPT-4o' },
    { name: 'gpt-4o-mini', displayName: 'GPT-4o mini' },
    { name: 'gpt-4-turbo', displayName: 'GPT-4 Turbo' },
    { name: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo' },
  ];

  async listModels(): Promise<ModelInfo[]> {
    if (!this.apiKey) return OpenAIProvider.FALLBACK_MODELS;

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 10000);
      let response: Response;
      const url = 'https://api.openai.com/v1/models';
      logger.debug('openai', 'Listing models', { url });
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        logger.warn('openai', 'listModels failed', { status: response.status });
        return OpenAIProvider.FALLBACK_MODELS;
      }

      const data = await response.json() as { data?: { id: string }[] };
      const chatModels = (data.data ?? [])
        .map(m => m.id)
        .filter(id => /^(gpt-|o[0-9])/.test(id))
        .sort((a, b) => b.localeCompare(a));

      if (chatModels.length === 0) return OpenAIProvider.FALLBACK_MODELS;

      return chatModels.map(id => ({
        name: id,
        displayName: id.replace(/^gpt-/, 'GPT-'),
      }));
    } catch (err: unknown) {
      logger.warn('openai', 'listModels error', { error: err instanceof Error ? err.message : String(err) });
      return OpenAIProvider.FALLBACK_MODELS;
    }
  }
}
