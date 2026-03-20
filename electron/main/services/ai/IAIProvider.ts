import { BrowserWindow } from 'electron';

export interface AuthStatus {
  authenticated: boolean;
  accountInfo?: string;
}

export interface ModelInfo {
  name: string;
  displayName: string;
}

export interface TokenUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export interface ChatResponseData {
  sessionId: string;
  type: 'chunk' | 'done' | 'error';
  content: string;
  usageMetadata?: TokenUsage;
}

export interface IAIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly authType: 'oauth2' | 'service_account' | 'api_key' | 'adc';

  authenticate(
    win: BrowserWindow,
    credentials: unknown,
    onResult: (result: { success: boolean }) => void,
  ): Promise<boolean>;

  autoAuth(credentials: unknown): Promise<boolean>;

  getAuthStatus(): AuthStatus;

  logout(): void;

  sendMessage(
    onResponse: (data: ChatResponseData) => void,
    sessionId: string,
    message: string,
    model: string,
    systemInstruction?: string,
  ): Promise<void>;

  cancelMessage(sessionId: string): void;

  clearHistory(sessionId: string): void;

  listModels(): Promise<ModelInfo[]>;

  /** Set the deployment location/region (e.g. Vertex AI regions). */
  setLocation?(location: string): void;

  /** List available locations/regions for this provider. */
  listLocations?(): Promise<string[]>;
}
