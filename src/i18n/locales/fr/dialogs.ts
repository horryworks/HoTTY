// Modal dialogs — confirmation, paste, SSH host key, system prompt,
// Ask AI, IAP VM start, and Save-to-Host-Tree. Grouped one key block per dialog.
export const dialogs = {
  confirm: {
    title: 'Confirmer',
    // Default confirm-button label when a caller does not pass one.
    confirmLabel: 'Supprimer',
  },
  paste: {
    header: 'Confirmation de collage',
    newlineWarning: '⚠️ Avertissement : contient des caractères de saut de ligne',
    paste: 'Coller',
  },
  sshHostKey: {
    titleChanged: "La clé d'hôte a CHANGÉ",
    titleUnknown: "Clé d'hôte inconnue",
    warning:
      "AVERTISSEMENT : la clé d'hôte de ce serveur a changé depuis la dernière connexion. Cela pourrait indiquer une attaque de l'homme du milieu.",
    host: 'Hôte :',
    keyType: 'Type de clé :',
    fingerprint: 'Empreinte :',
    reject: 'Rejeter',
    acceptOnce: 'Accepter une fois',
    acceptRemember: 'Accepter et mémoriser',
  },
  systemPrompt: {
    ariaLabel: 'Visionneuse de prompt système',
    // {{persona}} is interpolated.
    title: 'Prompt système — {{persona}}',
  },
  iapVmStart: {
    title: 'Démarrer la VM GCE ?',
    // <0>{{status}}</0> wraps the current status in a <strong> via <Trans>.
    message:
      "La VM cible est actuellement <0>{{status}}</0>. La démarrer maintenant pour poursuivre la connexion IAP ?",
    instance: 'Instance :',
    project: 'Projet :',
    zone: 'Zone :',
    startVm: 'Démarrer la VM',
  },
  saveToHostTree: {
    title: "Enregistrer dans l'arborescence des hôtes",
    unsupported:
      'Cette session ne peut pas être enregistrée (seules les sessions SSH et Telnet sont prises en charge).',
    nameLabel: 'Nom',
    folderLabel: 'Dossier',
    rootFolder: '(Racine)',
    newFolderPlaceholder: 'Nom du nouveau dossier',
    create: 'Créer',
    newFolder: '+ Nouveau dossier',
  },
};
