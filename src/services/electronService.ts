const api = () => window.electronAPI;

export const isAvailable = () => !!window.electronAPI;

export const connectSession = (sessionId: string, config: Record<string, unknown>) => api().connectSession(sessionId, config);
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
export const listSystemFonts = () => api().listSystemFonts();
export const selectImage = () => api().selectImage();
export const selectFolder = () => api().selectFolder();
export const getAppVersion = () => api().getAppVersion();
export const logDebug = (message: string) => api().logDebug(message);
export const openExternal = (url: string) => api().openExternal(url);

export const aiAuthStart = (credentials: unknown) => api().aiAuthStart(credentials);
export const aiAuthAuto = (credentials: unknown) => api().aiAuthAuto(credentials);
export const aiAuthStatus = () => api().aiAuthStatus();
export const aiAuthLogout = () => api().aiAuthLogout();
export const aiChatSend = (sessionId: string, message: string, model: string, systemInstruction?: string) => api().aiChatSend(sessionId, message, model, systemInstruction);
export const aiListModels = () => api().aiListModels();
export const aiListLocations = () => api().aiListLocations();
export const aiChatCancel = (sessionId: string) => api().aiChatCancel(sessionId);
export const aiChatClear = (sessionId: string) => api().aiChatClear(sessionId);
export const aiListProviders = () => api().aiListProviders();
export const aiSetLocation = (location: string) => api().aiSetLocation(location);
export const aiSetProvider = (providerId: string) => api().aiSetProvider(providerId);
export const selectServiceAccountKeyFile = () => api().selectServiceAccountKeyFile();
export const onAiAuthResult = (callback: (result: { success: boolean }) => void) => api().onAiAuthResult(callback);
export const onAiChatResponse = (callback: (data: { sessionId: string; type: string; content: string; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }) => void) => api().onAiChatResponse(callback);

export const showContextMenu = (selection: string, commands?: { id: string; label: string }[], includePaste?: boolean) => api().showContextMenu(selection, commands, includePaste);
export const onAskGemini = (callback: (selection: string, type: string) => void) => api().onAskGemini(callback);
export const onTerminalContextPaste = (callback: () => void) => api().onTerminalContextPaste(callback);
// GCE IAP Tunnel
export const gceIapCheckGcloud = () => api().gceIapCheckGcloud();
export const gceIapCheckAuth = () => api().gceIapCheckAuth();
export const gceIapListProjects = () => api().gceIapListProjects();
export const gceIapListZones = (project: string) => api().gceIapListZones(project);
export const gceIapListInstances = (project: string, zone: string) => api().gceIapListInstances(project, zone);

export const getSshAlgorithms = () => api().getSshAlgorithms();
export const saveSshAlgorithms = (algorithms: Record<string, { name: string; enabled: boolean }[]>) => api().saveSshAlgorithms(algorithms);
export const getThemes = () => api().getThemes();
export const saveCustomTheme = (themeKey: string, themeData: Record<string, unknown>) => api().saveCustomTheme(themeKey, themeData);
export const deleteCustomTheme = (themeKey: string) => api().deleteCustomTheme(themeKey);

export const verifyUser = (password: string) => api().verifyUser(password);
export const encryptSecret = (plaintext: string) => api().encryptSecret(plaintext);
export const decryptSecret = (ciphertext: string) => api().decryptSecret(ciphertext);
export const encryptSecrets = (plaintexts: (string | undefined)[]) => api().encryptSecrets(plaintexts);
export const decryptSecrets = (ciphertexts: (string | undefined)[]) => api().decryptSecrets(ciphertexts);
export const updateLogging = (loggingEnabled: boolean, loggingPath: string) => api().updateLogging(loggingEnabled, loggingPath);
export const listLogFiles = (folderPath: string) => api().listLogFiles(folderPath);
export const readLogFile = (filePath: string) => api().readLogFile(filePath);
export const openDebugLogFolder = () => api().openDebugLogFolder();
export const listWslDistributions = () => api().listWslDistributions();
export const detectGitBash = () => api().detectGitBash();
export const exportHTree = (data: unknown[], password: string) => api().exportHTree(data, password);
export const selectImportFile = () => api().selectImportFile();
export const decryptImportFile = (password: string) => api().decryptImportFile(password);
// File Explorer
export const fileExplorerListDirectory = (dirPath: string) => api().fileExplorerListDirectory(dirPath);
export const fileExplorerGetDrives = () => api().fileExplorerGetDrives();

// Text Editor
export const textEditorOpenFile = () => api().textEditorOpenFile();
export const textEditorSaveFile = (defaultPath?: string) => api().textEditorSaveFile(defaultPath);
export const textEditorReadFile = (filePath: string, encoding: string) => api().textEditorReadFile(filePath, encoding);
export const textEditorWriteFile = (filePath: string, content: string, encoding: string) => api().textEditorWriteFile(filePath, content, encoding);
export const textEditorApproveDroppedFile = (filePath: string) => api().textEditorApproveDroppedFile(filePath);
export const getFilePath = (file: File): string => api().getFilePath(file);
export const onOpenFileInEditor = (callback: (filePath: string) => void) => api().onOpenFileInEditor(callback);

// Ping Monitor
export const pingMonitorStart = (sessionId: string, targets: string[], intervalMs: number, loggingEnabled: boolean, loggingPath: string) =>
    api().pingMonitorStart(sessionId, targets, intervalMs, loggingEnabled, loggingPath);
export const pingMonitorStop = (sessionId: string) => api().pingMonitorStop(sessionId);
export const pingMonitorUpdateTargets = (sessionId: string, targets: string[]) => api().pingMonitorUpdateTargets(sessionId, targets);
export const pingMonitorUpdateInterval = (sessionId: string, intervalMs: number) => api().pingMonitorUpdateInterval(sessionId, intervalMs);
export const onPingMonitorData = (callback: (data: { sessionId: string; results: { target: string; status: string; rtt: number | null; ttl: number | null; timestamp: string }[] }) => void) =>
    api().onPingMonitorData(callback);
export const onPingMonitorLogFile = (callback: (data: { sessionId: string; fileName: string }) => void) =>
    api().onPingMonitorLogFile(callback);

export const onUpdateAvailable = (callback: (data: { version: string; releaseUrl: string }) => void) => api().onUpdateAvailable(callback);
