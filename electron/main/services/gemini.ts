import { BrowserWindow, shell } from 'electron';
import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';

interface TokenData {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  obtained_at: number;
}

interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export class GeminiService {
  private win: BrowserWindow;
  private tokenData: TokenData | null = null;
  private chatHistories: Map<string, ChatMessage[]> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private authServer: http.Server | null = null;
  private clientId: string | null = null;
  private clientSecret: string | null = null;

  constructor(win: BrowserWindow) {
    this.win = win;
  }

  // -- OAuth 2.0 Flow --

  async startAuth(clientId: string, clientSecret: string): Promise<boolean> {
    this.clientId = clientId;
    this.clientSecret = clientSecret;

    return new Promise((resolve) => {
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      this.authServer = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url || '', true);

        if (parsedUrl.pathname === '/callback') {
          const code = parsedUrl.query.code as string;
          const error = parsedUrl.query.error as string;

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<html><body style="background:#1e1e1e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#ef4444">❌ Authentication Error</h1><p>You may close this window.</p></div></body></html>');
            this.cleanupServer();
            this.win.webContents.send('gemini-auth-result', { success: false });
            resolve(false);
            return;
          }

          if (code) {
            try {
              const port = (this.authServer!.address() as any).port;
              await this.exchangeCodeForToken(code, clientId, clientSecret, codeVerifier, `http://localhost:${port}/callback`);
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end('<html><body style="background:#1e1e1e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#4ade80">✅ Authentication Successful</h1><p>You can return to HoTTY. You may close this window.</p></div></body></html>');
              this.cleanupServer();
              this.win.webContents.send('gemini-auth-result', { success: true });
              resolve(true);
            } catch (err: any) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`<html><body style="background:#1e1e1e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#ef4444">❌ Token Exchange Error</h1><p>${err.message}</p></div></body></html>`);
              this.cleanupServer();
              this.win.webContents.send('gemini-auth-result', { success: false });
              resolve(false);
            }
          }
        }
      });

      this.authServer.listen(0, '127.0.0.1', () => {
        const port = (this.authServer!.address() as any).port;
        const redirectUri = `http://localhost:${port}/callback`;
        const scope = 'https://www.googleapis.com/auth/generative-language.retriever';

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', scope);
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');

        shell.openExternal(authUrl.toString());
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.authServer) {
          this.cleanupServer();
          this.win.webContents.send('gemini-auth-result', { success: false });
          resolve(false);
        }
      }, 5 * 60 * 1000);
    });
  }

  private async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<void> {
    const params = new URLSearchParams();
    params.set('code', code);
    params.set('client_id', clientId);
    params.set('client_secret', clientSecret);
    params.set('redirect_uri', redirectUri);
    params.set('grant_type', 'authorization_code');
    params.set('code_verifier', codeVerifier);

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorBody}`);
    }

    const data = await response.json();
    this.tokenData = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
      obtained_at: Date.now(),
    };
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.tokenData?.refresh_token || !this.clientId || !this.clientSecret) return false;

    const params = new URLSearchParams();
    params.set('client_id', this.clientId);
    params.set('client_secret', this.clientSecret);
    params.set('refresh_token', this.tokenData.refresh_token);
    params.set('grant_type', 'refresh_token');

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) return false;

      const data = await response.json();
      this.tokenData = {
        ...this.tokenData,
        access_token: data.access_token,
        expires_in: data.expires_in,
        obtained_at: Date.now(),
      };
      return true;
    } catch {
      return false;
    }
  }

  private isTokenExpired(): boolean {
    if (!this.tokenData) return true;
    const elapsed = Date.now() - this.tokenData.obtained_at;
    return elapsed >= (this.tokenData.expires_in - 60) * 1000;
  }

  private async getValidToken(): Promise<string | null> {
    if (!this.tokenData) return null;

    if (this.isTokenExpired()) {
      const refreshed = await this.refreshAccessToken();
      if (!refreshed) return null;
    }

    return this.tokenData.access_token;
  }

  // -- Chat --

  async sendMessage(sessionId: string, message: string, model: string = 'gemini-2.5-flash', systemInstruction?: string): Promise<void> {
    const token = await this.getValidToken();
    if (!token) {
      this.win.webContents.send('gemini-chat-response', {
        sessionId,
        type: 'error',
        content: 'Authentication expired. Please sign in again.',
      });
      return;
    }

    if (!this.chatHistories.has(sessionId)) {
      this.chatHistories.set(sessionId, []);
    }
    const history = this.chatHistories.get(sessionId)!;
    history.push({ role: 'user', content: message });

    try {
      const contents = history.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.content }],
      }));

      const requestBody: any = { contents };

      if (systemInstruction) {
        requestBody.system_instruction = {
          parts: [{ text: systemInstruction }]
        };
      }

      const abortController = new AbortController();
      this.abortControllers.set(sessionId, abortController);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        },
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API error ${response.status}: ${errorBody}`);
      }

      let fullResponse = '';
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
                this.win.webContents.send('gemini-chat-response', {
                  sessionId,
                  type: 'chunk',
                  content: text,
                });
              }
            } catch {
              // skip malformed JSON chunks
            }
          }
        }
      }

      history.push({ role: 'model', content: fullResponse });
      this.win.webContents.send('gemini-chat-response', {
        sessionId,
        type: 'done',
        content: fullResponse,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Cancelled by user, no error to send
        return;
      }
      console.error('Gemini chat error:', err);
      this.win.webContents.send('gemini-chat-response', {
        sessionId,
        type: 'error',
        content: `Error: ${err.message}`,
      });
    } finally {
      this.abortControllers.delete(sessionId);
    }
  }

  // -- State --

  isAuthenticated(): boolean {
    return this.tokenData !== null;
  }

  async listModels(): Promise<{ name: string; displayName: string }[]> {
    const token = await this.getValidToken();
    if (!token) return [];

    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) return [];

      const data = await response.json();
      return (data.models || [])
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => ({
          name: m.name.replace('models/', ''),
          displayName: m.displayName
        }));
    } catch {
      return [];
    }
  }

  logout(): void {
    this.tokenData = null;
    this.clientId = null;
    this.clientSecret = null;
    this.chatHistories.clear();
  }

  clearHistory(sessionId: string): void {
    this.chatHistories.delete(sessionId);
  }

  cancelMessage(sessionId: string): void {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
  }

  private cleanupServer(): void {
    if (this.authServer) {
      this.authServer.close();
      this.authServer = null;
    }
  }
}
