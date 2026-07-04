// Боковая панель дерева хостов — панель инструментов, контекстное меню,
// псевдострока «Новое подключение», подсказка пустого состояния, модальное окно
// добавления/изменения/экспорта/импорта, подтверждение удаления и сообщения об
// успехе/неудаче.
export const hostTree = {
  toolbar: {
    addFolder: 'Добавить папку',
    addHost: 'Добавить хост',
    exportTree: 'Экспортировать дерево',
    importTree: 'Импортировать дерево',
  },
  newConnection: 'Новое подключение',
  newConnectionTitle: 'Начать новое подключение (очищает форму)',
  empty: 'Щёлкните правой кнопкой мыши или используйте кнопки + выше, чтобы добавить хосты и папки',
  contextMenu: {
    openAll: 'Открыть все',
    addFolder: 'Добавить папку',
    addHost: 'Добавить хост',
    rename: 'Переименовать (F2)',
    export: 'Экспортировать',
    import: 'Импортировать',
    sortAscending: 'Сортировать по возрастанию',
    sortDescending: 'Сортировать по убыванию',
  },
  openAll: {
    confirmTitle: 'Открыть все хосты',
    // {{count}} = количество хостов, {{name}} = имя папки.
    confirmMessage: 'Открыть все хосты ({{count}}) в «{{name}}»?',
  },
  modal: {
    renameFolder: 'Переименовать папку',
    addFolder: 'Добавить папку',
    editHost: 'Изменить хост',
    addHost: 'Добавить хост',
    exportTitle: 'Экспорт дерева хостов',
    importTitle: 'Импорт дерева хостов',
    displayName: 'Отображаемое имя',
    setEncryptionPassword: 'Задайте пароль шифрования:',
    enterDecryptionPassword: 'Введите пароль расшифровки:',
    exportPasswordHint: 'Этот пароль потребуется для последующего импорта файла.',
    importPasswordHint: 'Введите пароль, который использовался при экспорте этого файла.',
    protocol: 'Протокол',
    useAsJumpbox: 'Использовать как джампбокс',
    hostLabel: 'Хост/IP',
    hostPlaceholder: '192.168.1.1',
    portLabel: 'Порт',
    usernameLabel: 'Имя пользователя',
    passwordLabel: 'Пароль',
    export: 'Экспортировать',
    import: 'Импортировать',
  },
  delete: {
    titleFolder: 'Удалить папку',
    titleHost: 'Удалить хост',
    // {{name}} — отображаемое имя узла. {{warning}} добавляется только если хост
    // используется как джампбокс (см. jumpboxWarning ниже); иначе пусто.
    message: 'Вы уверены, что хотите удалить «{{name}}»?\nЭто действие нельзя отменить.{{warning}}',
    // {{count}} хостов, {{names}} = список имён хостов через запятую.
    jumpboxWarning:
      '\n\nЭтот хост используется как джампбокс следующими хостами ({{count}}): {{names}}. Их настройка джампбокса будет очищена.',
  },
  messages: {
    importErrorTitle: 'Ошибка импорта',
    // {{error}} — текст базовой ошибки.
    importErrorBody: 'Не удалось открыть файл: {{error}}',
    exportSuccessTitle: 'Экспорт выполнен',
    exportSuccessBody: 'Дерево хостов успешно экспортировано.',
    exportFailedTitle: 'Ошибка экспорта',
    importSuccessTitle: 'Импорт выполнен',
    importSuccessBody: 'Хосты успешно импортированы.',
    // {{folderName}} — сгенерированное имя папки «Imported_<file>».
    importSuccessIntoFolder: 'Хосты импортированы и добавлены в папку «{{folderName}}».',
    importFailedTitle: 'Ошибка импорта',
  },
};
