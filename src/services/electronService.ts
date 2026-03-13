const api = () => window.electronAPI;

export const connectSession = (sessionId: string, config: any) => api().connectSession(sessionId, config);
export const disconnectSession = (sessionId: string) => api().disconnectSession(sessionId);
export const sendInput = (sessionId: string, data: string) => api().sendInput(sessionId, data);
export const resize = (sessionId: string, cols: number, rows: number) => api().resize(sessionId, cols, rows);
export const updateSessionEncoding = (sessionId: string, encoding: string) => api().updateSessionEncoding(sessionId, encoding);
export const setWindowSize = (width: number, height: number) => api().setWindowSize(width, height);
export const writeClipboard = (text: string) => api().writeClipboard(text);
export const focusWindow = () => api().focusWindow();

export const onSessionData = (callback: (sessionId: string, data: string) => void) => api().onSessionData(callback);
export const onSessionStatus = (callback: (sessionId: string, status: string) => void) => api().onSessionStatus(callback);
export const onSessionError = (callback: (sessionId: string, error: string) => void) => api().onSessionError(callback);
export const listSerialPorts = () => api().listSerialPorts();
export const selectImage = () => api().selectImage();
export const selectFolder = () => api().selectFolder();
export const authorizeMediaPath = (path: string) => api().authorizeMediaPath(path);
export const getAppVersion = () => api().getAppVersion();
export const logDebug = (message: string) => api().logDebug(message);
export const openExternal = (url: string) => api().openExternal(url);

export const geminiAuthStart = (clientId: string, clientSecret: string) => api().geminiAuthStart(clientId, clientSecret);
export const geminiAuthAuto = (clientId: string, clientSecret: string) => api().geminiAuthAuto(clientId, clientSecret);
export const geminiAuthStatus = () => api().geminiAuthStatus();
export const geminiAuthLogout = () => api().geminiAuthLogout();
export const geminiChatSend = (sessionId: string, message: string, model: string, systemInstruction?: string) => api().geminiChatSend(sessionId, message, model, systemInstruction);
export const geminiListModels = () => api().geminiListModels();
export const geminiChatCancel = (sessionId: string) => api().geminiChatCancel(sessionId);
export const geminiChatClear = (sessionId: string) => api().geminiChatClear(sessionId);
export const onGeminiAuthResult = (callback: (result: { success: boolean }) => void) => api().onGeminiAuthResult(callback);
export const onGeminiChatResponse = (callback: (data: { sessionId: string; type: string; content: string }) => void) => api().onGeminiChatResponse(callback);

export const showContextMenu = (selection: string, commands?: { id: string; label: string }[]) => api().showContextMenu(selection, commands);
export const onAskGemini = (callback: (selection: string, type: string) => void) => api().onAskGemini(callback);
export const onTerminalContextPaste = (callback: () => void) => api().onTerminalContextPaste(callback);
export const getSshAlgorithms = () => api().getSshAlgorithms();
export const saveSshAlgorithms = (algorithms: any) => api().saveSshAlgorithms(algorithms);
export const getThemes = () => api().getThemes();
export const saveThemes = (themes: any) => api().saveThemes(themes);

export const encryptSecret = (plaintext: string) => api().encryptSecret(plaintext);
export const decryptSecret = (ciphertext: string) => api().decryptSecret(ciphertext);
export const encryptSecrets = (plaintexts: (string | undefined)[]) => api().encryptSecrets(plaintexts);
export const decryptSecrets = (ciphertexts: (string | undefined)[]) => api().decryptSecrets(ciphertexts);
export const updateLogging = (loggingEnabled: boolean, loggingPath: string) => api().updateLogging(loggingEnabled, loggingPath);
export const listLogFiles = (folderPath: string) => api().listLogFiles(folderPath);
export const readLogFile = (filePath: string) => api().readLogFile(filePath);
