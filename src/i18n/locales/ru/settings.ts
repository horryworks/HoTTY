// Модальное окно настроек — каркас, подписи вкладок и содержимое всех вкладок.
export const settings = {
  title: 'Настройки',
  tabs: {
    general: 'Общие',
    appearance: 'Внешний вид',
    protocols: 'Протоколы',
    features: 'Функции',
    ai: 'ИИ',
    about: 'О программе',
  },
  general: {
    // Выбор языка (этот шаг)
    languageSection: 'Язык',
    languageLabel: 'Язык интерфейса',
    languageHelp:
      'Изменяет язык интерфейса приложения. (Язык ответа ИИ настраивается отдельно на панели ИИ-чата.)',
    // Журналирование
    loggingSection: 'Журналирование',
    enableLogging: 'Включить журналирование',
    logFolderPath: 'Путь к папке журналов',
    logFolderPathHelp: 'Журналы сохраняются как YYYYMMDDHHMMSS-(Протокол)-(IP).txt',
    logFolderPathPlaceholder: 'Выберите папку или введите путь...',
    // Терминал
    terminalSection: 'Терминал',
    scrollbackBuffer: 'Буфер прокрутки',
    scrollbackHelp: 'Максимальное число строк, хранимых в памяти на терминал (по умолчанию: 10000).',
    enableLineWrap: 'Включить перенос строк',
    // Ввод
    inputSection: 'Ввод',
    backspaceSendsDel: 'Backspace отправляет DEL (0x7F)',
    backspaceSendsDelHelp:
      'Если отключено, Backspace отправляет 0x08 (BS). Включите, если сервер ожидает 0x7F.',
    rightClickPaste: 'Вставка правой кнопкой мыши',
    rightClickPasteHelp: 'Щелчок правой кнопкой мыши по терминалу показывает диалог подтверждения вставки.',
    // Диагностика
    diagnosticsSection: 'Диагностика',
    debugLog: 'Журнал отладки',
    debugLogHelp: 'Прикрепите последний файл журнала при сообщении об ошибке.',
    openDebugLogFolder: 'Открыть папку журналов отладки',
  },
  appearance: {
    // Макет
    layoutSection: 'Макет',
    sidebarPosition: 'Положение боковой панели',
    sidebarLeft: 'слева',
    sidebarRight: 'справа',
    // Тема
    themeSection: 'Тема',
    themeLabel: 'Тема',
    deleteTheme: 'Удалить',
    createCustomTheme: 'Создать свою тему',
    deleteThemeTitle: 'Удалить тему',
    deleteThemeMessage:
      'Удалить пользовательскую тему «{{name}}»? Это нельзя отменить.',
    // Фон неиспользуемой панели
    unusedPaneBackground: 'Фон неиспользуемой панели',
    paneBackgroundColor: 'цвет',
    paneBackgroundImage: 'изображение',
    paneBackgroundImagePlaceholder: 'напр. http://asset.localhost/...',
    browse: 'Обзор…',
    clearImage: 'Очистить изображение',
    clear: 'Очистить',
    // Шрифт
    fontSection: 'Шрифт',
    fontFamily: 'Семейство шрифтов',
    systemMonospaceDefault: 'Системный моноширинный (по умолчанию)',
    scanning: 'Сканирование...',
    rescan: 'Пересканировать',
    fontSize: 'Размер шрифта (px)',
    // Отображение терминала
    terminalDisplaySection: 'Отображение терминала',
    defaultEncoding: 'Кодировка по умолчанию',
    defaultEncodingHelp: 'Применяется к новым подключениям.',
    promptHighlight: 'Подсветка промпта',
    enableUserInputHighlight: 'Включить подсветку ввода пользователя',
    highlightColor: 'Цвет подсветки',
    promptPatternsRegex: 'Шаблоны промптов (регулярные выражения)',
    namePlaceholder: 'Имя',
    regexPlaceholder: 'Регулярное выражение',
    addPattern: '+ Добавить шаблон',
    resetToDefault: 'Сбросить по умолчанию',
  },
  protocols: {
    // SSH
    sshSection: 'SSH',
    connectTimeout: 'Тайм-аут подключения',
    timeoutSeconds: 'Тайм-аут (секунды)',
    sshTimeoutHelp:
      'Максимальное время ожидания первоначального TCP- и SSH-рукопожатия перед отказом. По умолчанию: 5 секунд.',
    keepAlive: 'KeepAlive',
    enable: 'Включить',
    sshKeepAliveHelp: 'Отправляет пустые пакеты для предотвращения тайм-аутов.',
    intervalSeconds: 'Интервал (секунды)',
    // Алгоритмы
    algorithms: 'Алгоритмы',
    algorithmsHelp: 'Выберите, какие алгоритмы включить. Изменения применяются к новым сессиям.',
    categoryServerHostKey: 'Ключ хоста сервера',
    categoryKex: 'Обмен ключами',
    categoryCipher: 'Шифр',
    categoryMac: 'MAC',
    // Telnet
    telnetSection: 'Telnet',
    telnetTimeoutHelp:
      'Максимальное время ожидания первоначального TCP-подключения перед отказом. По умолчанию: 5 секунд.',
    telnetKeepAliveHelp: 'Отправляет команды Telnet NOP для предотвращения тайм-аутов простоя.',
    // Предупреждение DH-GEX SHA-1
    dhGexTitle: 'Включить diffie-hellman-group-exchange-sha1?',
    dhGexConfirm: 'Включить',
    dhGexWarning:
      'diffie-hellman-group-exchange-sha1 опирается на SHA-1, который считается ' +
      'взломанным и был удалён из стандартных настроек OpenSSH в версии 8.2. Включайте его только если ' +
      'необходимо работать с устаревшими устройствами, не предлагающими более надёжный обмен ключами.\n\n' +
      'Предпочитайте diffie-hellman-group-exchange-sha256, diffie-hellman-group14-sha256 ' +
      'или curve25519-sha256, когда удалённое устройство их поддерживает.\n\n' +
      'Всё равно включить diffie-hellman-group-exchange-sha1?',
  },
  features: {
    section: 'Функции',
    sectionHelp: 'Включайте или отключайте функциональные панели. Уже открытые панели не затрагиваются.',
    aiChatLabel: 'ИИ-чат',
    aiChatDescription: 'Панель чата на базе ИИ для помощи с терминалом',
    logViewerLabel: 'Просмотр журналов',
    logViewerDescription: 'Просмотр и анализ журналов сессий',
    pingMonitorLabel: 'Ping-мониторинг',
    pingMonitorDescription: 'Непрерывный ICMP ping-мониторинг',
    textEditorLabel: 'Текстовый редактор',
    textEditorDescription: 'Встроенный редактор текстовых файлов',
    fileExplorerLabel: 'Проводник файлов',
    fileExplorerDescription: 'Просмотр и управление файлами',
  },
  ai: {
    // Провайдер
    providerSection: 'Провайдер',
    aiProvider: 'Провайдер ИИ',
    aiProviderHelp:
      'Vertex AI и Gemini используют Google OAuth. Anthropic и OpenAI требуют API-ключи.',
    providerVertexAi: 'Google Cloud Vertex AI',
    providerGemini: 'Google AI Studio (Gemini)',
    providerAnthropic: 'Anthropic (Claude)',
    providerOpenai: 'OpenAI',
    // Аутентификация
    authentication: 'Аутентификация',
    authenticated: 'Аутентифицирован',
    notAuthenticated: 'Не аутентифицирован',
    logout: 'Выйти',
    // Персоны
    personasSection: 'Персоны',
    addPersona: 'Добавить персону',
    personaName: 'Имя персоны',
    displayNamePlaceholder: 'Отображаемое имя',
    systemPrompt: 'Системный промпт',
    systemPromptPlaceholder: 'Системный промпт',
    askAiCommands: 'Команды «Спросить ИИ»',
    dragToReorder: 'Перетащите для изменения порядка',
    labelPlaceholder: 'Метка',
    promptTemplatePlaceholder: 'Шаблон промпта ({selection} будет заменён)',
    promptTemplateHelp: 'Используйте плейсхолдер {selection} для выделенного текста.',
    addCommand: '+ Добавить команду',
    resetCommands: 'Сбросить команды',
    deletePersona: 'Удалить персону',
    atLeastOnePersona: 'Требуется хотя бы одна персона',
    deletePersonaTitle: 'Удалить «{{label}}»',
    resetAllPersonas: 'Сбросить все персоны',
    newPersonaLabel: 'Новая персона',
    newCommandLabel: 'Новая команда',
    // Выполнение команд
    commandExecutionSection: 'Выполнение команд',
    commandExecutionHelp:
      'Режим выполнения и лимит автозапуска настраиваются на панели ИИ-чата (под полем ввода сообщения).',
    commandSafetyClassifier: 'Классификатор безопасности команд',
    commandSafetyClassifierHelp:
      'Как HoTTY решает, выполнять ли предложенную ИИ команду автоматически. Чёрный список всегда проверяется первым (при совпадении запрашивается подтверждение перед выполнением). Статический: белый список выполняется автоматически, всё остальное запрашивает подтверждение. ИИ: ИИ оценивает всё, что не в чёрном списке. Гибридный (рекомендуется): белый список выполняется автоматически, остальное оценивает ИИ, иначе запрашивается подтверждение.',
    classifierStatic: 'Статический белый список',
    classifierAi: 'Оценка ИИ',
    classifierHybrid: 'Гибридный (рекомендуется)',
    aiConfidenceThreshold: 'Порог уверенности ИИ: {{percent}}%',
    aiConfidenceThresholdHelp:
      'Минимальная уверенность ИИ, требуемая для автоматического выполнения команды, оценённой как «только для чтения». Ниже этого значения команда ожидает ручного запуска. Выше = осторожнее. По умолчанию: 70%.',
    deviceResponseTimeout: 'Тайм-аут ответа устройства (секунды)',
    deviceResponseTimeoutHelp:
      'Если устройство не выдаёт нового вывода в течение указанного числа секунд после команды, ИИ сообщается, что устройство перестало отвечать, чтобы цикл мог продолжиться. 0 отключает определение простоя. По умолчанию: 10.',
    sleepAsClientDelay: 'Выполнять начальный `sleep` как задержку на стороне клиента',
    sleepAsClientDelayHelp:
      'Когда ИИ выдаёт команду, начинающуюся с `sleep N` (напр. `sleep 120 && validate`), ожидать N секунд в HoTTY вместо выполнения sleep на устройстве. Это не даёт указанному выше тайм-ауту ответа устройства сработать ложно во время ожидания. Любая последующая команда выполняется после ожидания. По умолчанию: включено.',
    maxClientDelay: 'Макс. задержка на стороне клиента (секунды)',
    maxClientDelayHelp:
      'Верхняя граница задержки sleep на стороне клиента; более длинные значения sleep ограничиваются этим пределом с пометкой. 0 = без ограничения. По умолчанию: 900 (15 мин).',
    whitelist: 'Белый список (автовыполнение)',
    whitelistHelp:
      'Команды, совпавшие здесь, выполняются автоматически. Одно слово совпадает как базовая команда (напр. «docker» совпадает с любой командой docker); запись с пробелами совпадает как подстрока (напр. «git log»). Заполнено безопасными значениями по умолчанию; полностью редактируется.',
    whitelistPlaceholder: 'напр., docker, kubectl get',
    add: 'Добавить',
    resetToDefaults: 'Сбросить по умолчанию',
    resetWhitelistTitle: 'Сбросить белый список к встроенным значениям по умолчанию',
    removeEntry: 'Удалить {{cmd}}',
    blacklist: 'Чёрный список (запрашивать перед выполнением)',
    blacklistHelp:
      'Команды, совпавшие здесь, никогда не выполняются автоматически — ручной запуск всё ещё разрешён, с предупреждением. Одно слово совпадает как базовая команда; запись с пробелами совпадает как подстрока (напр. «rm -rf», «git push»). Заполнено деструктивными значениями по умолчанию; полностью редактируется.',
    blacklistPlaceholder: 'напр., rm -rf, git push',
    resetBlacklistTitle: 'Сбросить чёрный список к встроенным значениям по умолчанию',
    // Модальные окна
    privacyNoticeTitle: 'Уведомление о конфиденциальности',
    privacyNoticeMessage:
      'Google AI Studio (Gemini) может использовать ваши данные для обучения ИИ на бесплатном тарифе. Включите оплату для проекта Google Cloud, чтобы отказаться.',
    privacyNoticeConfirm: 'OK',
    logoutTitle: 'Выйти',
    logoutMessage:
      'Вы уверены, что хотите выйти? Чтобы снова использовать провайдер ИИ, потребуется повторная аутентификация.',
    logoutConfirm: 'Выйти',
  },
  about: {
    version: 'v{{version}}',
    author: 'Katsumasa "Horry" Horiuchi',
    descriptionLine1: 'Эмулятор терминала SSH/Telnet/Serial',
    descriptionLine2: 'Создано на Tauri, React и TypeScript',
    licenseLine1: 'Эта программа является свободным ПО, выпущенным под',
    licenseLine2: 'GNU General Public License v3.0 или более поздней.',
    viewLicense: 'Открыть GNU General Public License v3.0',
    logoAlt: 'Логотип HoTTY',
  },
  customTheme: {
    title: 'Создание своей темы',
    cancel: 'Отмена',
    themeName: 'Имя темы',
    themeNamePlaceholder: 'напр. My Dark Blue',
    baseTheme: 'Базовая тема',
    saveTheme: 'Сохранить тему',
    saving: 'Сохранение...',
    terminalSectionTitle: 'Терминал',
    terminalSectionDesc: 'Цвета терминала xterm.js',
    // Проверка
    errorEmptyName: 'Введите имя темы.',
    errorNoAlphanumeric: 'Имя темы должно содержать хотя бы один буквенно-цифровой символ.',
    errorProtectedName: 'Нельзя использовать «dark», «medium» или «light» как имя темы.',
    errorSaveFailed: 'Не удалось сохранить тему.',
    // Заголовки и описания разделов
    sectionBackgroundsTitle: 'Фоны и текст',
    sectionBackgroundsDesc: 'Основной фон и цвета текста',
    sectionBordersTitle: 'Границы и акценты',
    sectionBordersDesc: 'Цвета границ и акцентов/подсветки',
    sectionInputsTitle: 'Поля ввода, кнопки и наведение',
    sectionInputsDesc: 'Цвета полей ввода, кнопок и состояний наведения',
    sectionStatusTitle: 'Статус и сигналы',
    sectionStatusDesc: 'Цвета индикаторов успеха, ошибки, предупреждения и опасности',
    sectionAiChatTitle: 'ИИ-чат',
    sectionAiChatDesc: 'Цвета для сообщений ИИ-чата и блоков кода',
    sectionUiTitle: 'Специфичные компоненты интерфейса',
    sectionUiDesc: 'Боковая панель, вкладки, контекстные меню, значки и другие элементы интерфейса',
    sectionProvidersTitle: 'Провайдеры ИИ',
    sectionProvidersDesc:
      'Фирменные цвета, используемые для значков провайдеров ИИ (Gemini, OpenAI, Anthropic, Vertex AI)',
    sectionSearchTitle: 'Поиск и подсветка',
    sectionSearchDesc: 'Цвета подсветки результатов поиска',
    sectionOverlaysTitle: 'Оверлеи и модальные окна',
    sectionOverlaysDesc: 'Модальные диалоги, оверлеи и баннеры уведомлений',
    sectionEffectsTitle: 'Футуристические эффекты',
    sectionEffectsDesc:
      'Неоновое свечение и эффекты стеклянного морфизма, применяемые к активным панелям, боковым панелям и модальным окнам',
    // Строки цветов терминала
    terminalForeground: 'Передний план',
    terminalForegroundDesc: 'Цвет текста по умолчанию внутри терминала',
    terminalBackground: 'Фон (активный)',
    terminalBackgroundDesc: 'Фон для активного/сфокусированного терминала',
    terminalBackgroundInactive: 'Фон (неактивный)',
    terminalBackgroundInactiveDesc: 'Фон для неактивных/несфокусированных терминалов',
    terminalPaneBackground: 'Фон панели',
    terminalPaneBackgroundDesc: 'Цвет пространства вокруг терминала',
  },
};
