!macro customUnInstall
  MessageBox MB_YESNO "Do you want to completely delete all user data (settings, credentials, and history)?" IDYES +1 IDNO done
  RMDir /r "$APPDATA\HoTTY"
  done:
!macroend
