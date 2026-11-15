# Picked up automatically by electron-builder (buildResources/installer.nsh).
#
# Reinstalling, updating and uninstalling all run the previous version's
# uninstaller. Its default removes "$INSTDIR" recursively, which would also
# delete anything else the user keeps inside the installation directory. This
# macro replaces that step and removes only what the installer itself laid down
# (the Electron runtime plus the app), then removes "$INSTDIR" only if it is
# left empty. Anything else in the directory is left exactly as it was.
#
# Keep the file list in sync with the top level of the Electron Windows
# distribution when upgrading Electron: an unlisted new top-level file is left
# behind rather than deleted.
!macro customRemoveFiles
  # Move out of $INSTDIR so it can be removed.
  SetOutPath $TEMP

  Delete "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  # Cannot delete itself while running; the next install overwrites it.
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"

  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\vk_swiftshader_icd.json"

  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"

  # Non-recursive: succeeds only when nothing else is left inside.
  RMDir "$INSTDIR"
!macroend

# Replaces electron-builder's app-running check, which ends the processes it
# finds and then carries on. An external agent client can restart its DeepWrite
# MCP bridge (it runs this executable) at any moment, and the update then copies
# around the locked files while reporting success. Before anything is removed,
# this waits until no process holds the executable, ending whatever
# still runs from $INSTDIR; if that never happens it stops and keeps the current
# version instead.
#
# Defining the macro makes allowOnlyOneInstallerInstance.nsh skip these two.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING

  StrCpy $R1 0
  deepwriteProbeAppFiles:
  ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    # Write access to a running executable fails with a sharing violation (32);
    # nothing is written. Other failures, such as a folder that needs
    # elevation, are not "in use" and are left to the install steps.
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\${APP_EXECUTABLE_FILENAME}", i 0x40000000, i 7, p 0, i 3, i 0x80, p 0) i.R0 ?e'
    Pop $R2
    ${if} $R0 != -1
      System::Call 'kernel32::CloseHandle(i R0)'
    ${elseIf} $R2 == 32
      IntOp $R1 $R1 + 1
      ${if} $R1 <= 5
        DetailPrint `Waiting for "${PRODUCT_NAME}" files to be released.`
        !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 1
        Sleep 1000
        Goto deepwriteProbeAppFiles
      ${endIf}
      StrCpy $R1 0
      ${if} $LANGUAGE == 2052
      ${orIf} $LANGUAGE == 1028
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "DeepWrite 的程序文件仍被占用，无法更新。$\r$\n$\r$\n常见原因是 Claude Code、Codex 等外部智能体客户端的 MCP 连接正在使用 DeepWrite。请退出这些客户端后点“重试”；点“取消”将保留当前版本。" /SD IDCANCEL IDRETRY deepwriteProbeAppFiles
      ${else}
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "DeepWrite's program files are still in use and cannot be updated.$\r$\n$\r$\nThis is usually an MCP connection from an external agent client such as Claude Code or Codex. Quit those clients and click Retry, or click Cancel to keep the current version." /SD IDCANCEL IDRETRY deepwriteProbeAppFiles
      ${endIf}
      SetErrorLevel 2
      Quit
    ${endIf}
  ${endIf}
!macroend
