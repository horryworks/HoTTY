import { BrowserWindow, shell, app, ipcMain } from 'electron';
import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { encryptString, decryptString } from './dpapi';

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
  private tokenData: TokenData | null = null;
  private chatHistories: Map<string, ChatMessage[]> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private authServer: http.Server | null = null;
  private clientId: string | null = null;
  private clientSecret: string | null = null;

  constructor() {
  }

  // -- Token Persistence --

  private getTokenFilePath(): string {
    return path.join(app.getPath('userData'), 'gemini_token.json');
  }

  private async saveToken(): Promise<void> {
    if (!this.tokenData || !this.tokenData.refresh_token) return;

    try {
      const dataToSave = {
        refresh_token: this.tokenData.refresh_token,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        obtained_at: this.tokenData.obtained_at
      };

      const jsonString = JSON.stringify(dataToSave);
      const encrypted = await encryptString(jsonString);
      fs.writeFileSync(this.getTokenFilePath(), encrypted, 'utf8');
      console.log('Gemini token saved successfully.');
    } catch (err) {
      console.error('Failed to save Gemini token:', err);
    }
  }

  private async loadToken(): Promise<boolean> {
    try {
      const tokenPath = this.getTokenFilePath();
      if (!fs.existsSync(tokenPath)) return false;

      const encrypted = fs.readFileSync(tokenPath, 'utf8');
      const decrypted = await decryptString(encrypted);
      if (!decrypted) return false;

      const data = JSON.parse(decrypted);

      if (!data.refresh_token || !data.client_id || !data.client_secret) {
        return false;
      }

      this.clientId = data.client_id;
      this.clientSecret = data.client_secret;
      this.tokenData = {
        access_token: '', // We don't save access token since it expires quickly
        refresh_token: data.refresh_token,
        expires_in: 0,
        token_type: 'Bearer',
        obtained_at: data.obtained_at || 0,
      };

      // Try reading and refreshing access token
      const success = await this.refreshAccessToken();
      return success;

    } catch (err) {
      console.error('Failed to load Gemini token:', err);
      return false;
    }
  }

  // -- Auto Auth Flow --

  async autoAuth(clientId: string, clientSecret: string): Promise<boolean> {
    // If we're already authenticated and have a valid token (or can refresh one), just return true.
    if (this.isAuthenticated() && this.clientId === clientId && this.clientSecret === clientSecret) {
      const token = await this.getValidToken();
      if (token) return true;
    }

    try {
      const tokenPath = this.getTokenFilePath();
      if (!fs.existsSync(tokenPath)) {
        return false; // No saved credentials
      }

      const success = await this.loadToken();
      if (success) {
        // Validate that the stored clientId/secret matches what we were passed
        if (this.clientId !== clientId || this.clientSecret !== clientSecret) {
          console.log("Gemini auto-auth failed: saved credentials do not match provided credentials.");
          this.logout();
          return false;
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('Auto auth error:', err);
      return false;
    }
  }

  // -- OAuth 2.0 Flow --

  async startAuth(win: BrowserWindow, clientId: string, clientSecret: string): Promise<boolean> {
    this.clientId = clientId;
    this.clientSecret = clientSecret;

    return new Promise((resolve) => {
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');
      const oauthState = crypto.randomBytes(16).toString('hex');

      this.authServer = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url || '', true);

        if (parsedUrl.pathname === '/callback') {
          const code = parsedUrl.query.code as string;
          const error = parsedUrl.query.error as string;
          const receivedState = parsedUrl.query.state as string;

          const securityHeaders = {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'Access-Control-Allow-Origin': 'null',
          };

          // CSRF protection: validate state parameter
          if (!receivedState || receivedState !== oauthState) {
            res.writeHead(400, securityHeaders);
            res.end('<html><body style="background:#1e1e1e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#ef4444">❌ Invalid State</h1><p>Security validation failed. You may close this window.</p></div></body></html>');
            this.cleanupServer();
            win.webContents.send('gemini-auth-result', { success: false });
            resolve(false);
            return;
          }

          if (error) {
            res.writeHead(200, securityHeaders);
            res.end('<html><body style="background:#1e1e1e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#ef4444">❌ Authentication Error</h1><p>You may close this window.</p></div></body></html>');
            this.cleanupServer();
            win.webContents.send('gemini-auth-result', { success: false });
            resolve(false);
            return;
          }

          if (code) {
            try {
              const port = (this.authServer!.address() as any).port;
              await this.exchangeCodeForToken(code, clientId, clientSecret, codeVerifier, `http://localhost:${port}/callback`);

              // Save token immediately after authenticating
              await this.saveToken();

              res.writeHead(200, securityHeaders);
              res.end('<html><body style="background:#1e1e1e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#4ade80">✅ Authentication Successful</h1><p>You can return to HoTTY. You may close this window.</p></div></body></html>');
              this.cleanupServer();
              win.webContents.send('gemini-auth-result', { success: true });

              // Trigger internal event to close window
              ipcMain.emit('gemini-auth-result-internal');

              resolve(true);
            } catch (err: any) {
              console.error('Gemini token exchange error:', err);
              res.writeHead(200, securityHeaders);
              res.end('<html><body style="background:#1e1e1e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#ef4444">&#10060; Token Exchange Error</h1><p>Authentication failed. You may close this window and try again.</p></div></body></html>');
              this.cleanupServer();
              win.webContents.send('gemini-auth-result', { success: false });
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
        authUrl.searchParams.set('state', oauthState);

        const authWin = new BrowserWindow({
          width: 600,
          height: 800,
          parent: win,
          modal: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
          autoHideMenuBar: true,
        });

        authWin.loadURL(authUrl.toString());

        authWin.on('closed', () => {
          // If user closes the window manually before callback happens
          if (this.authServer) {
            this.cleanupServer();
            win.webContents.send('gemini-auth-result', { success: false });
            resolve(false);
          }
        });

        // When auth is complete, close the auth window
        // Use ipcMain.once instead of win.webContents.once
        ipcMain.once('gemini-auth-result-internal', () => {
          if (!authWin.isDestroyed()) {
            authWin.close();
          }
        });

      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.authServer) {
          this.cleanupServer();
          win.webContents.send('gemini-auth-result', { success: false });
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

    const exchangeController = new AbortController();
    const exchangeTimeout = setTimeout(() => exchangeController.abort(), 30000);
    let response: Response;
    try {
      response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: exchangeController.signal,
      });
    } finally {
      clearTimeout(exchangeTimeout);
    }

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status}`);
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
      const refreshController = new AbortController();
      const refreshTimeout = setTimeout(() => refreshController.abort(), 15000);
      let response: Response;
      try {
        response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
          signal: refreshController.signal,
        });
      } finally {
        clearTimeout(refreshTimeout);
      }

      if (!response.ok) return false;

      const data = await response.json();
      this.tokenData = {
        ...this.tokenData,
        access_token: data.access_token,
        expires_in: data.expires_in,
        obtained_at: Date.now(),
      };

      // Save the updated token data (specifically `obtained_at`)
      await this.saveToken();

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

  async sendMessage(win: BrowserWindow, sessionId: string, message: string, model: string = 'gemini-1.5-flash', systemInstruction?: string): Promise<void> {
    const token = await this.getValidToken();
    if (!token) {
      win.webContents.send('gemini-chat-response', {
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
                win.webContents.send('gemini-chat-response', {
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
      win.webContents.send('gemini-chat-response', {
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
      win.webContents.send('gemini-chat-response', {
        sessionId,
        type: 'error',
        content: 'An error occurred while communicating with Gemini. Please try again.',
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
      const listController = new AbortController();
      const listTimeout = setTimeout(() => listController.abort(), 15000);
      let response: Response;
      try {
        response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: listController.signal,
        });
      } finally {
        clearTimeout(listTimeout);
      }
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

    // Remove the saved token file
    try {
      const tokenPath = this.getTokenFilePath();
      if (fs.existsSync(tokenPath)) {
        fs.unlinkSync(tokenPath);
      }
    } catch (err) {
      console.error('Failed to delete Gemini token file:', err);
    }
  }

  clearHistory(sessionId: string): void {
    this.chatHistories.delete(sessionId);
  }

  cancelMessage(sessionId: string): void {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.set(sessionId, controller); // Actually delete it below
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
