' start-ungoogled-cdp.vbs
' ---------------------------------------------------------------------------
' Purpose : launch ungoogled-chromium from this folder with a remote CDP
'           endpoint so a remote agent (for example cdp-browser on Linux) can
'           attach over the LAN.
' Usage   : copy this file next to chrome.exe, then double-click it
'           (or run: wscript start-ungoogled-cdp.vbs).
'
' IMPORTANT
' - Keep --user-data-dir on a dedicated folder. Chrome 136+ ignores
'   --remote-debugging-port when the default profile directory is used.
' - If chrome.exe is already running with the same user-data-dir, the new
'   flags are ignored by the existing instance. Fully quit that profile's
'   chrome.exe processes first, then run this script.
' - CDP has NO authentication: anyone who can reach the port can control the
'   whole browser profile (cookies, sessions, downloads, arbitrary JS).
'   Restrict access with a firewall rule or use an SSH/netsh tunnel.
' ---------------------------------------------------------------------------

Option Explicit

' ---- configuration --------------------------------------------------------
Const CDP_PORT = 9222             ' DevTools/CDP port
Const CDP_ADDRESS = "0.0.0.0"     ' bind all interfaces; "192.168.133.1" narrows it
Const ALLOW_ORIGINS = True        ' adds --remote-allow-origins=* when True
Const WINDOW_STYLE = 0            ' 0 = hidden, 1 = normal window
' ---------------------------------------------------------------------------

Dim objFSO, objShell, strScriptDir, strChromePath, strUserData, strCommand
Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")

' Resolve this script's own folder, ignoring the current working directory.
strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
strChromePath = strScriptDir & "\chrome.exe"
strUserData = strScriptDir & "\UserData"

If Not objFSO.FileExists(strChromePath) Then
  MsgBox "chrome.exe was not found next to this script:" & vbCrLf & strChromePath, 16, "ungoogled-chromium CDP"
  WScript.Quit 1
End If

strCommand = Chr(34) & strChromePath & Chr(34) & _
  " --user-data-dir=" & Chr(34) & strUserData & Chr(34) & _
  " --remote-debugging-port=" & CDP_PORT & _
  " --remote-debugging-address=" & CDP_ADDRESS & _
  " --disable-machine-id --disable-encryption --ignore-certificate-errors --test-type"

If ALLOW_ORIGINS Then
  strCommand = strCommand & " --remote-allow-origins=*"
End If

' Run with the configured window style and do not block the script.
objShell.Run strCommand, WINDOW_STYLE, False
