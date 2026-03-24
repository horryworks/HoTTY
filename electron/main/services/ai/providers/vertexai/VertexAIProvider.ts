import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { IAIProvider, AuthStatus, ModelInfo, ChatResponseData, TokenUsage } from '../../IAIProvider';
import { encryptString, decryptString } from '../../../dpapi';
import { logger } from '../../../Logger';

const CREDENTIAL_FILE_MAX_SIZE = 10 * 1024; // 10 KB
const VALID_MODEL_PATTERN = /^[a-zA-Z0-9/._-]+$/;
// GCP project IDs: 6-30 chars, lowercase letters/digits/hyphens, starts with letter
const VALID_PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const VALID_LOCATION_PATTERN = /^(?:global|[a-z][a-z0-9-]+)$/;

/** Build the Vertex AI API base URL, handling the global endpoint correctly. */
function vertexBaseUrl(loc: string, apiVersion: string): string {
  const host = loc === 'global'
    ? 'aiplatform.googleapis.com'
    : `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/${apiVersion}`;
}

/** Build a resource path prefix like `projects/{pid}/locations/{loc}`. */
function vertexResourcePrefix(projectId: string, loc: string): string {
  return `projects/${projectId}/locations/${loc}`;
}

// Keywords indicating non-text (video / audio / image) models to exclude from the model list
const NON_TEXT_MODEL_KEYWORDS = [
  'imagen', 'imagegeneration', 'imagetext', 'veo', 'chirp',
  'speech', 'audio', 'video', 'lyria', 'voice',
  'stable-diffusion', 'flux', 'text-to-speech',
  'translate', 'virtual-try-on',
];

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
        if (fs.statSync(adcPath).size > CREDENTIAL_FILE_MAX_SIZE) {
          logger.warn('vertexai', 'ADC file exceeds size limit');
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
        if (fs.statSync(resolvedPath).size > CREDENTIAL_FILE_MAX_SIZE) {
          logger.warn('vertexai', 'Service account key file exceeds size limit');
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
      if (fs.statSync(configPath).size > CREDENTIAL_FILE_MAX_SIZE) {
        logger.warn('vertexai', 'Config file exceeds size limit');
        return false;
      }
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

  setLocation(location: string): void {
    if (!this.config) return;
    if (!VALID_LOCATION_PATTERN.test(location)) return;
    this.config = { ...this.config, location };
    logger.debug('vertexai', 'Location changed', { location });
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

    const abortController = new AbortController();
    this.abortControllers.set(sessionId, abortController);

    // Route to publisher-specific implementation to handle API format differences
    const modelPath = model.startsWith('publishers/') ? model : `publishers/google/models/${model}`;
    const publisher = modelPath.split('/')[1] ?? 'google';

    try {
      let result: { fullResponse: string; usageMetadata?: TokenUsage };
      if (publisher === 'anthropic') {
        result = await this.callAnthropicApi(sessionId, modelPath, history, systemInstruction, token, abortController.signal, onResponse);
      } else {
        result = await this.callGoogleApi(sessionId, modelPath, history, systemInstruction, token, abortController.signal, onResponse);
      }
      history.push({ role: 'model', content: result.fullResponse });
      onResponse({ sessionId, type: 'done', content: result.fullResponse, usageMetadata: result.usageMetadata });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('vertexai', 'Chat error', { sessionId, error: errMsg });
      onResponse({ sessionId, type: 'error', content: this.formatUserErrorMessage(errMsg, model) });
    } finally {
      this.abortControllers.delete(sessionId);
    }
  }

  private async callGoogleApi(
    sessionId: string,
    modelPath: string,
    history: ChatMessage[],
    systemInstruction: string | undefined,
    token: string,
    signal: AbortSignal,
    onResponse: (data: ChatResponseData) => void,
  ): Promise<{ fullResponse: string; usageMetadata?: TokenUsage }> {
    const { projectId, location } = this.config!;
    const apiUrl = `${vertexBaseUrl(location, 'v1beta1')}/${vertexResourcePrefix(projectId, location)}/${modelPath}:streamGenerateContent?alt=sse`;

    const contents = history.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }));
    const requestBody: Record<string, unknown> = { contents };
    if (systemInstruction) {
      requestBody.system_instruction = { parts: [{ text: systemInstruction }] };
    }

    logger.debug('vertexai', 'Sending message (Google)', { apiUrl });
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(requestBody),
      signal,
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API error ${response.status}: ${errorBody}`);
    }

    let fullResponse = '';
    let usageMetadata: TokenUsage | undefined;
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
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (text) {
            fullResponse += text;
            onResponse({ sessionId, type: 'chunk', content: text });
          }
          if (parsed?.usageMetadata) usageMetadata = parsed.usageMetadata;
        } catch { /* skip malformed JSON chunks */ }
      }
    }
    return { fullResponse, usageMetadata };
  }

  private async callAnthropicApi(
    sessionId: string,
    modelPath: string,
    history: ChatMessage[],
    systemInstruction: string | undefined,
    token: string,
    signal: AbortSignal,
    onResponse: (data: ChatResponseData) => void,
  ): Promise<{ fullResponse: string; usageMetadata?: TokenUsage }> {
    const { projectId, location } = this.config!;
    const apiUrl = `${vertexBaseUrl(location, 'v1')}/${vertexResourcePrefix(projectId, location)}/${modelPath}:streamRawPredict`;

    // Anthropic uses 'assistant' instead of 'model' for the AI role
    const messages = history.map(msg => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.content,
    }));
    const requestBody: Record<string, unknown> = {
      anthropic_version: 'vertex-2023-10-16',
      messages,
      max_tokens: 8096,
      stream: true,
    };
    if (systemInstruction) {
      requestBody.system = systemInstruction;
    }

    logger.debug('vertexai', 'Sending message (Anthropic)', { apiUrl });
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Goog-User-Project': projectId,
      },
      body: JSON.stringify(requestBody),
      signal,
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
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed?.type === 'content_block_delta' && parsed?.delta?.type === 'text_delta') {
            const text = parsed.delta.text || '';
            if (text) {
              fullResponse += text;
              onResponse({ sessionId, type: 'chunk', content: text });
            }
          } else if (parsed?.type === 'message_start') {
            inputTokens = parsed?.message?.usage?.input_tokens ?? 0;
          } else if (parsed?.type === 'message_delta') {
            outputTokens = parsed?.usage?.output_tokens ?? 0;
          }
        } catch { /* skip malformed JSON chunks */ }
      }
    }

    const usageMetadata: TokenUsage = {
      promptTokenCount: inputTokens,
      candidatesTokenCount: outputTokens,
      totalTokenCount: inputTokens + outputTokens,
    };
    return { fullResponse, usageMetadata };
  }

  private formatUserErrorMessage(errMsg: string, model: string): string {
    const shortModel = model.split('/').pop() ?? model;

    // Region not supported for this model
    if (/not servable in region/i.test(errMsg)) {
      const regionMatch = errMsg.match(/region\s+(\S+)/);
      const region = regionMatch?.[1]?.replace(/[.]$/, '') ?? 'the current region';
      return `"${shortModel}" is not available in region "${region}". Try switching to a supported region (e.g. us-east5, europe-west1) in AI settings.`;
    }

    // Model not found or not enabled
    if (/not found|does not have access/i.test(errMsg)) {
      return `"${shortModel}" is not enabled in your GCP project. Please enable the model in the Google Cloud Console (Vertex AI > Model Garden) and try again.`;
    }

    // Permission denied
    if (/permission denied|forbidden/i.test(errMsg)) {
      return `Permission denied for "${shortModel}". Check that your GCP account has access to this model.`;
    }

    // Quota exceeded
    if (/quota|rate limit|resource exhausted/i.test(errMsg)) {
      return `Quota exceeded for "${shortModel}". Your GCP project may need a quota increase for this model. See: https://cloud.google.com/vertex-ai/docs/generative-ai/quotas-genai`;
    }

    // Generic with status code
    const statusMatch = errMsg.match(/API error (\d+)/);
    if (statusMatch) {
      return `"${shortModel}" returned error ${statusMatch[1]}. Please check your Vertex AI configuration and try again.`;
    }

    return 'An error occurred while communicating with Vertex AI. Please try again.';
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

  async listLocations(): Promise<string[]> {
    if (!this.config) return [];
    const token = await this.getValidToken();
    if (!token) return [];

    const { projectId, location } = this.config;
    const url = `${vertexBaseUrl(location, 'v1')}/projects/${projectId}/locations`;
    logger.debug('vertexai', 'Fetching locations', { url });

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Goog-User-Project': projectId,
        },
        signal: ctrl.signal,
      });
      if (!response.ok) {
        logger.warn('vertexai', 'Failed to fetch locations', { status: response.status });
        return [];
      }
      const data = await response.json() as { locations?: { locationId: string }[] };
      const locations = (data.locations ?? []).map(l => l.locationId).sort();
      logger.debug('vertexai', `listLocations: fetched ${locations.length} locations`);
      return locations;
    } catch (err: unknown) {
      logger.warn('vertexai', 'listLocations error', { error: err instanceof Error ? err.message : String(err) });
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.config) return [];
    const token = await this.getValidToken();
    if (!token) return [];

    const { projectId, location } = this.config;
    const publishers = ['google', 'anthropic', 'meta', 'mistral-ai', 'cohere'];
    // Use us-central1 for the model catalog (most complete), but verify in the target region
    const catalogRegion = 'us-central1';
    const catalogBase = `https://${catalogRegion}-aiplatform.googleapis.com/v1beta1`;
    logger.debug('vertexai', 'Fetching models from publishers', { publishers, catalogRegion, targetRegion: location });

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    try {
      const results = await Promise.allSettled(
        publishers.map(publisher =>
          fetch(`${catalogBase}/publishers/${publisher}/models`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Goog-User-Project': projectId,
            },
            signal: ctrl.signal,
          }).then(async res => {
            if (!res.ok) {
              logger.debug('vertexai', `No models for publisher ${publisher}`, { status: res.status });
              return [] as { name: string; displayName?: string }[];
            }
            const data = await res.json() as { publisherModels?: { name: string; displayName?: string; supportedActions?: Record<string, unknown> }[] };
            const allPublisherModels = data.publisherModels ?? [];
            const withAiStudio = allPublisherModels
              .filter(m => !!m.supportedActions?.['openGenerationAiStudio']);
            const textModels = withAiStudio
              .filter(m => {
                const shortName = m.name.split('/').pop()?.toLowerCase() ?? '';
                return !NON_TEXT_MODEL_KEYWORDS.some(kw => shortName.includes(kw));
              });
            logger.debug('vertexai', `Catalog: ${publisher}`, {
              total: allPublisherModels.length,
              withAiStudio: withAiStudio.length,
              textModels: textModels.length,
              names: textModels.map(m => m.name.split('/').pop()),
            });
            return textModels;
          }),
        ),
      );

      const allModels: ModelInfo[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const m of result.value) {
            const parts = m.name.split('/');
            const publisher = parts[1] ?? '';
            const shortName = parts[parts.length - 1] ?? m.name;
            const pubPrefix = publisher.charAt(0).toUpperCase() + publisher.slice(1);
            allModels.push({
              name: m.name,
              displayName: m.displayName ? `${m.displayName} (${pubPrefix})` : `${shortName} (${pubPrefix})`,
            });
          }
        }
      }

      if (allModels.length === 0) {
        logger.warn('vertexai', 'No models found from any publisher');
        return [];
      }

      // Verify model accessibility per publisher.
      // Google models: use countTokens (lightweight, no inference).
      // Anthropic models: use streamRawPredict with empty messages — a 422 validation
      // error means the model is accessible; 404/400 "not servable" means it is not.
      const googleModels = allModels.filter(m => m.name.startsWith('publishers/google/'));
      const anthropicModels = allModels.filter(m => m.name.startsWith('publishers/anthropic/'));
      const otherModels = allModels.filter(m =>
        !m.name.startsWith('publishers/google/') && !m.name.startsWith('publishers/anthropic/'),
      );

      const verifyCtrl = new AbortController();
      const verifyTimeout = setTimeout(() => verifyCtrl.abort(), 20000);
      let verifiedGoogleModels: ModelInfo[];
      let verifiedAnthropicModels: ModelInfo[];
      try {
        const [googleResults, anthropicResults] = await Promise.all([
          Promise.allSettled(
            googleModels.map(m =>
              fetch(`${vertexBaseUrl(location, 'v1beta1')}/${vertexResourcePrefix(projectId, location)}/${m.name}:countTokens`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                  'X-Goog-User-Project': projectId,
                },
                body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] }),
                signal: verifyCtrl.signal,
              }).then(async res => {
                if (res.ok) return m;
                if (res.status === 429) {
                  logger.debug('vertexai', `Model quota exhausted: ${m.name}`);
                  return { ...m, displayName: `${m.displayName} [Quota limit]` };
                }
                const body = await res.text().catch(() => '');
                logger.debug('vertexai', `Google model verification failed: ${m.name}`, { status: res.status, body: body.slice(0, 200) });
                return null;
              }),
            ),
          ),
          Promise.allSettled(
            anthropicModels.map(m =>
              fetch(
                `${vertexBaseUrl(location, 'v1')}/${vertexResourcePrefix(projectId, location)}/${m.name}:streamRawPredict`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-Goog-User-Project': projectId,
                  },
                  body: JSON.stringify({
                    anthropic_version: 'vertex-2023-10-16',
                    messages: [],
                    max_tokens: 1,
                  }),
                  signal: verifyCtrl.signal,
                },
              ).then(async res => {
                // 422 = validation error (model is accessible, just invalid request)
                // 200 would also be fine but unlikely with empty messages
                if (res.ok || res.status === 422) return m;
                // 429 = quota exhausted — model exists but unusable right now
                if (res.status === 429) {
                  logger.debug('vertexai', `Model quota exhausted: ${m.name}`);
                  return { ...m, displayName: `${m.displayName} [Quota limit]` };
                }
                const body = await res.text().catch(() => '');
                // 400 "not servable in region" or 404 "not found" means inaccessible
                if (res.status === 404 || /not servable in region/i.test(body)) {
                  logger.debug('vertexai', `Model not accessible: ${m.name}`, { status: res.status });
                  return null;
                }
                // Other 400 errors (e.g. validation) mean the model IS accessible
                return m;
              }),
            ),
          ),
        ]);
        verifiedGoogleModels = googleResults
          .filter((r): r is PromiseFulfilledResult<ModelInfo | null> => r.status === 'fulfilled')
          .map(r => r.value)
          .filter((m): m is ModelInfo => m !== null);
        verifiedAnthropicModels = anthropicResults
          .filter((r): r is PromiseFulfilledResult<ModelInfo | null> => r.status === 'fulfilled')
          .map(r => r.value)
          .filter((m): m is ModelInfo => m !== null);
      } finally {
        clearTimeout(verifyTimeout);
      }

      const verifiedModels = [...verifiedGoogleModels, ...verifiedAnthropicModels, ...otherModels];

      if (verifiedModels.length === 0) {
        logger.warn('vertexai', 'No accessible models found for this project');
        return [];
      }

      // Sort: Google first, then alphabetically by displayName
      verifiedModels.sort((a, b) => {
        const aIsGoogle = a.name.includes('publishers/google');
        const bIsGoogle = b.name.includes('publishers/google');
        if (aIsGoogle && !bIsGoogle) return -1;
        if (!aIsGoogle && bIsGoogle) return 1;
        return a.displayName.localeCompare(b.displayName);
      });

      logger.debug('vertexai', `listModels: ${verifiedModels.length} models verified in region "${location}"`, {
        models: verifiedModels.map(m => m.displayName),
      });
      return verifiedModels;
    } catch (err: unknown) {
      logger.warn('vertexai', 'listModels error', { error: err instanceof Error ? err.message : String(err) });
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}
