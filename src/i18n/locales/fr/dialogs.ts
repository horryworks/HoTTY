// Modal dialogs — confirmation, paste, SSH host key, system prompt,
// Ask AI, IAP VM start, and Save-to-Host-Tree. Grouped one key block per dialog.
export const dialogs = {
  closeAiWindow: {
    title: 'Fermer AI Chat',
    message_one: 'Fermer cette fenêtre met fin à {{count}} conversation.',
    message_other: 'Fermer cette fenêtre met fin à {{count}} conversations.',
    workers_one: 'Le terminal ouvert par l’IA sera également déconnecté.',
    workers_other: 'Les {{count}} terminaux ouverts par l’IA seront également déconnectés.',
    hint: 'Pour les garder, utilisez « Réintégrer ».',
    confirmLabel: 'Fermer',
  },
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
  moveByPrefix: {
    title: 'Trier par plage IP',
    scopeFolder: 'Hôtes dans {{name}}',
    scopeTree: 'Tous les hôtes',
    matchIn: 'Comparer avec',
    matchScope: '{{name}} et son contenu ({{count}})',
    matchTree: 'Tout l’arbre ({{count}})',
    scopeHint: 'Restreindre la portée est la seule issue quand NetBox réutilise la même plage privée sur chaque site.',
    willMove: 'À déplacer ({{count}})',
    alreadyPlaced: 'Déjà dans le bon dossier ({{count}})',
    ambiguous: 'Plusieurs dossiers les revendiquent ({{count}})',
    ambiguousHint: 'Laissés en place : HoTTY ne tranche pas entre des dossiers qui revendiquent la même plage. Déplacez-les vous-même, ou corrigez le chevauchement dans NetBox.',
    unmatched: 'Aucune correspondance ({{count}})',
    reasonNotAnAddress: 'pas une adresse IP',
    reasonNoMatch: 'hors de tous les préfixes',
    moveRow: '{{from}} → {{to}}',
    topLevel: 'Niveau supérieur',
    noPrefixes: 'Aucun dossier de l’arbre ne porte encore de préfixe NetBox. Synchronisez avec NetBox en activant le placement par préfixe.',
    nothingToDo: 'Chaque hôte est déjà là où son adresse l’indique.',
    apply: 'Déplacer {{count}}',
    cancel: 'Annuler',
    moved: '{{count}} hôtes déplacés',
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
    netboxSuggested: 'Dossier couvrant {{prefix}} sélectionné dans NetBox.',
    netboxAmbiguous: 'Plusieurs dossiers NetBox couvrent {{prefix}}, aucun n’a donc été choisi : {{folders}}',
  },
};
