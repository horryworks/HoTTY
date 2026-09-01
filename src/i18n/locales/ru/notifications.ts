// Уведомления и оверлеи — временный интерфейс уровня приложения (всплывающие
// сообщения об ошибках, оверлей подключения, баннер обновления, экран сбоя).
// Источник истины — английский.
export const notifications = {
  error: {
    dismiss: 'Закрыть уведомление об ошибке',
  },
  connecting: {
    label: 'Подключение к',
  },
  update: {
    titleAvailable: 'Доступна новая версия: v{{version}}',
    prereleaseSuffix: ' (предварительный выпуск)',
    running: 'У вас установлена версия v{{version}}',
    viewRelease: 'Открыть выпуск',
    dismiss: 'Закрыть',
    dismissAria: 'Закрыть уведомление об обновлении',
  },
  // Toast text for logError() call sites. logError pushes into the error
  // notification store, so every literal handed to it is user-facing UI and
  // must be a key here rather than an inline string.
  errors: {
    aiChatSendFailed: 'Не удалось отправить запрос ИИ',
    aiChatLogDisabled: 'Ведение журнала чата с ИИ отключено',
    aiCredentialEncrypt: 'Не удалось зашифровать учётные данные ИИ',
    aiSignInStart: 'Не удалось начать вход',
    aiLogout: 'Не удалось выйти из системы',
    aiAutoAuth: 'Не удалось выполнить автоматический вход',
    aiAuthListener: 'Не удалось получить результаты входа',
    aiLogoutListener: 'Не удалось получить события выхода',
    aiResponseListener: 'Не удалось получить ответы ИИ',
    iapVmPromptListen: 'Не удалось получить запросы на запуск ВМ',
    iapVmPromptRespond: 'Не удалось ответить на запрос о запуске ВМ',
    sshHostKeyListen: 'Не удалось получить запросы ключа хоста SSH',
    browserPaneCreate: 'Не удалось открыть панель веб-браузера',
    browserNavigate: 'Не удалось перейти на страницу',
    browserClearData: 'Не удалось очистить данные просмотра',
    trafficSettingsRestore: 'Не удалось восстановить настройки панели трафика',
    trafficListener: 'Не удалось получить события трафика',
    pingMonitorListener: 'Не удалось получить события монитора ping',
    fileServerListener: 'Не удалось получить события файлового сервера',
    credentialBatch: 'Не удалось обработать учётные данные {{label}}',
    hostTreeEncrypt: 'Не удалось зашифровать дерево хостов',
    credentialMigration: 'Не удалось перенести учётные данные',
    credentialPreload: 'Не удалось расшифровать учётные данные в фоновом режиме',
    sessionLoggingUpdate: 'Не удалось обновить журнал сеанса',
    sessionListener: 'Не удалось получить события сеанса',
    clipboardCopy: 'Не удалось скопировать выделенное',
  },
  errorBoundary: {
    title: 'Что-то пошло не так',
    reload: 'Перезагрузить',
    dismiss: 'Закрыть',
  },
};
