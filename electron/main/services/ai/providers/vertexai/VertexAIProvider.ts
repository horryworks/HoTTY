import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { IAIProvider, AuthStatus, ModelInfo, ChatResponseData, TokenUsage } from '../../IAIProvider';
import { encryptString, decryptString } from '../../../dpapi';
import { logger } from '../../../Logger';

const VALID_MODEL_PATTERN = /^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$/;
// GCP project IDs: 6-30 chars, lowercase letters/digits/hyphens, starts with letter
const VALID_PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const VALID_LOCATION_PATTERN = /^[a-z][a-z0-9-]+$/;

interface VertexAIConfig {
  projectId: string;
  location: string;
  authType: 'adc' | 'service_account';
}

interface TokenData {
  access_token: string;
  expires_at: number;
}

interface RefreshData {
  type: 'authorized_user' | 'service_account';
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  client_email?: string;
  private_key?: string;
}

interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export class VertexAIProvider implements IAIProvider {
  readonly id = 'vertexai';
  readonly displayName = 'Google Cloud Vertex AI';
  readonly authType = 'adc' as const;

  private tokenData: TokenData | null = null;
  private refreshData: RefreshData | null = null;
  private config: VertexAIConfig | null = null;
  private chatHistories: Map<string, ChatMessage[]> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  private getConfigFilePath(): string {
    return path.join(app.getPath('userData'), 'vertexai_config.json');
  }

  private getAdcPath(): string {
    if (process.platform === 'win32') {
      return path.join(
        process.env.APPDATA || path.join(app.getPath('home'), 'AppData', 'Roaming'),
        'gcloud', 'application_default_credentials.json',
      );
    }
    return path.join(app.getPath('home'), '.config', 'gcloud', 'application_default_credentials.json');
  }

  private isTokenExpired(): boolean {
    if (!this.tokenData) return true;
    return Date.now() >= this.tokenData.expires_at;
  }

  private createJWT(clientEmail: string, privateKey: string): string {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const sign = crypto.createSign('SHA256');
    sign.update(signingInput);
    const signature = sign.sign(privateKey, 'base64url');
    return `${signingInput}.${signature}`;
  }

  private async refreshToken(): Promise<string | null> {
    if (!this.refreshData) return null;
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15000);
      let response: Response;
      try {
        if (this.refreshData.type === 'authorized_user') {
          const params = new URLSearchParams();
          params.set('client_id', this.refreshData.client_id!);
          params.set('client_secret', this.refreshData.client_secret!);
          params.set('refresh_token', this.refreshData.refresh_token!);
          params.set('grant_type', 'refresh_token');
          const url = 'https://oauth2.googleapis.com/token';
          logger.debug('vertexai', 'Refreshing access token', { url, type: this.refreshData.type });
          response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            signal: ctrl.signal,
          });
        } else {
          const jwt = this.createJWT(this.refreshData.client_email!, this.refreshData.private_key!);
          const params = new URLSearchParams();
          params.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
          params.set('assertion', jwt);
          const url = 'https://oauth2.googleapis.com/token';
          logger.debug('vertexai', 'Refreshing access token', { url, type: this.refreshData.type });
          response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
            signal: ctrl.signal,
          });
        }
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) return null;
      const data = await response.json();
      this.tokenData = {
        access_token: data.access_token,
        expires_at: Date.now() + (data.expires_in - 60) * 1000,
      };
      return data.access_token;
    } catch {
      return null;
    }
  }

  private async getValidToken(): Promise<string | null> {
    if (this.tokenData && !this.isTokenExpired()) {
      return this.tokenData.access_token;
    }
    return this.refreshToken();
  }

  private async saveConfig(): Promise<void> {
    try {
      const payload = JSON.stringify({ config: this.config, refreshData: this.refreshData });
      const encrypted = await encryptString(payload);
      fs.writeFileSync(this.getConfigFilePath(), encrypted, 'utf8');
      logger.debug('vertexai', 'Config saved');
    } catch (err: unknown) {
      logger.error('vertexai', 'Failed to save config', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  async authenticate(
    _win: BrowserWindow,
    credentials: unknown,
    onResult: (result: { success: boolean }) => void,
  ): Promise<boolean> {
    const creds = credentials as { projectId: string; location: string; authType: 'adc' | 'service_account'; keyFilePath?: string };

    if (!creds.projectId || !VALID_PROJECT_PATTERN.test(creds.projectId)) {
      logger.warn('vertexai', 'Auth rejected: invalid project ID');
      onResult({ success: false });
      return false;
    }
    if (!creds.location || !VALID_LOCATION_PATTERN.test(creds.location)) {
      logger.warn('vertexai', 'Auth rejected: invalid location');
      onResult({ success: false });
      return false;
    }

    try {
      if (creds.authType === 'adc') {
        const adcPath = this.getAdcPath();
        if (!fs.existsSync(adcPath)) {
          logger.warn('vertexai', 'ADC file not found', { path: adcPath });
          onResult({ success: false });
          return false;
        }
        const adcContent = JSON.parse(fs.readFileSync(adcPath, 'utf8'));
        if (adcContent.type === 'authorized_user') {
          if (!adcContent.client_id || !adcContent.client_secret || !adcContent.refresh_token) {
            onResult({ success: false });
            return false;
          }
          this.refreshData = {
            type: 'authorized_user',
            client_id: adcContent.client_id,
            client_secret: adcContent.client_secret,
            refresh_token: adcContent.refresh_token,
          };
        } else if (adcContent.type === 'service_account') {
          if (!adcContent.client_email || !adcContent.private_key) {
            onResult({ success: false });
            return false;
          }
          this.refreshData = {
            type: 'service_account',
            client_email: adcContent.client_email,
            private_key: adcContent.private_key,
          };
        } else {
          logger.warn('vertexai', 'Unsupported ADC credential type', { type: adcContent.type });
          onResult({ success: false });
          return false;
        }
      } else if (creds.authType === 'service_account') {
        if (!creds.keyFilePath) {
          onResult({ success: false });
          return false;
        }
        const resolvedPath = path.resolve(creds.keyFilePath);
        if (!fs.existsSync(resolvedPath)) {
          logger.warn('vertexai', 'Service account key file not found');
          onResult({ success: false });
          return false;
        }
        const saContent = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
        if (!saContent.client_email || !saContent.private_key) {
          logger.warn('vertexai', 'Invalid service account key file');
          onResult({ success: false });
          return false;
        }
        this.refreshData = {
          type: 'service_account',
          client_email: saContent.client_email,
          private_key: saContent.private_key,
        };
      } else {
        onResult({ success: false });
        return false;
      }

      this.config = { projectId: creds.projectId, location: creds.location, authType: creds.authType };
      const token = await this.refreshToken();
      if (!token) {
        this.config = null;
        this.refreshData = null;
        logger.warn('vertexai', 'Failed to obtain access token');
        onResult({ success: false });
        return false;
      }

      await this.saveConfig();
      logger.info('vertexai', 'Auth success', { projectId: creds.projectId, location: creds.location });
      onResult({ success: true });
      return true;
    } catch (err: unknown) {
      logger.error('vertexai', 'Auth error', { error: err instanceof Error ? err.message : String(err) });
      this.config = null;
      this.refreshData = null;
      onResult({ success: false });
      return false;
    }
  }

  async autoAuth(credentials: unknown): Promise<boolean> {
    const creds = credentials as { projectId: string; location: string };
    try {
      const configPath = this.getConfigFilePath();
      if (!fs.existsSync(configPath)) return false;
      const encrypted = fs.readFileSync(configPath, 'utf8');
      const decrypted = await decryptString(encrypted);
      if (!decrypted) return false;
      const saved = JSON.parse(decrypted) as { config: VertexAIConfig; refreshData: RefreshData };
      if (saved.config.projectId !== creds.projectId || saved.config.location !== creds.location) {
        return false;
      }
      this.config = saved.config;
      this.refreshData = saved.refreshData;
      const token = await this.refreshToken();
      if (!token) {
        this.config = null;
        this.refreshData = null;
        return false;
      }
      logger.info('vertexai', 'Auto-auth success');
      return true;
    } catch (err: unknown) {
      logger.error('vertexai', 'Auto-auth error', { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  getAuthStatus(): AuthStatus {
    return { authenticated: this.tokenData !== null && !this.isTokenExpired() };
  }

  logout(): void {
    logger.info('vertexai', 'Logout');
    this.tokenData = null;
    this.refreshData = null;
    this.config = null;
    this.chatHistories.clear();
    try {
      const configPath = this.getConfigFilePath();
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    } catch (err: unknown) {
      logger.error('vertexai', 'Failed to delete config file', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  async sendMessage(
    onResponse: (data: ChatResponseData) => void,
    sessionId: string,
    message: string,
    model: string = 'gemini-2.0-flash-001',
    systemInstruction?: string,
  ): Promise<void> {
    if (!VALID_MODEL_PATTERN.test(model)) {
      onResponse({ sessionId, type: 'error', content: 'Invalid model name.' });
      return;
    }
    if (!this.config) {
      onResponse({ sessionId, type: 'error', content: 'Not authenticated. Please connect to Vertex AI.' });
      return;
    }
    const token = await this.getValidToken();
    if (!token) {
      onResponse({ sessionId, type: 'error', content: 'Authentication expired. Please reconnect to Vertex AI.' });
      return;
    }

    if (!this.chatHistories.has(sessionId)) {
      this.chatHistories.set(sessionId, []);
    }
    const history = this.chatHistories.get(sessionId)!;
    history.push({ role: 'user', content: message });

    const { projectId, location } = this.config;
    const apiUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:streamGenerateContent?alt=sse`;

    const contents = history.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }));
    const requestBody: Record<string, unknown> = { contents };
    if (systemInstruction) {
      requestBody.system_instruction = { parts: [{ text: systemInstruction }] };
    }

    const abortController = new AbortController();
    this.abortControllers.set(sessionId, abortController);

    logger.debug('vertexai', 'Sending message', { apiUrl, model });
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
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
            if (!jsonStr) continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (text) {
                fullResponse += text;
                onResponse({ sessionId, type: 'chunk', content: text });
              }
              if (parsed?.usageMetadata) {
                lastUsageMetadata = parsed.usageMetadata;
              }
            } catch {
              // skip malformed JSON chunks
            }
          }
        }
      }

      history.push({ role: 'model', content: fullResponse });
      onResponse({ sessionId, type: 'done', content: fullResponse, usageMetadata: lastUsageMetadata ?? undefined });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      logger.error('vertexai', 'Chat error', { sessionId, error: err instanceof Error ? err.message : String(err) });
      onResponse({ sessionId, type: 'error', content: 'An error occurred while communicating with Vertex AI. Please try again.' });
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

  private getHardcodedModels(): ModelInfo[] {
    return [
      { name: 'gemini-1.5-pro-preview-05-06', displayName: 'Gemini 1.5 Pro Preview (Vertex AI)' },
      { name: 'gemini-2.0-flash-001', displayName: 'Gemini 2.0 Flash (Vertex AI)' },
      { name: 'gemini-1.5-pro-002', displayName: 'Gemini 1.5 Pro (Vertex AI)' },
      { name: 'gemini-1.5-flash-002', displayName: 'Gemini 1.5 Flash (Vertex AI)' },
    ];
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.config) return this.getHardcodedModels();
    const token = await this.getValidToken();
    if (!token) return this.getHardcodedModels();

    try {
      const { location } = this.config;
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15000);
      let response: Response;
      const url = `https://${location}-aiplatform.googleapis.com/v1beta1/publishers/google/models`;
      logger.debug('vertexai', 'Listing models', { url });
      try {
        response = await fetch(
          url,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: ctrl.signal,
          },
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        logger.warn('vertexai', 'listModels API failed, using hardcoded list', { status: response.status });
        return this.getHardcodedModels();
      }

      const data = await response.json() as { publisherModels?: { name: string; displayName?: string }[] };
      const publisherModels = data.publisherModels ?? [];
      const geminiModels: ModelInfo[] = publisherModels
        .filter(m => m.name?.includes('gemini'))
        .map(m => {
          const modelId = m.name.split('/').pop() ?? m.name;
          return { name: modelId, displayName: m.displayName ?? modelId };
        });

      if (geminiModels.length === 0) {
        logger.warn('vertexai', 'No Gemini models found in API response, using hardcoded list');
        return this.getHardcodedModels();
      }

      logger.debug('vertexai', `listModels: fetched ${geminiModels.length} models from API`);
      return geminiModels;
    } catch (err: unknown) {
      logger.warn('vertexai', 'listModels fetch error, using hardcoded list', { error: err instanceof Error ? err.message : String(err) });
      return this.getHardcodedModels();
    }
  }
}
