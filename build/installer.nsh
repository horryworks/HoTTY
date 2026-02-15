!macro customUnInstall
  IfSilent done
  MessageBox MB_YESNO "Do you want to completely delete all user data (settings, credentials, and history)?" IDYES delete IDNO done
  delete:
  RMDir /r "$APPDATA\HoTTY"
  done:
!macroend
