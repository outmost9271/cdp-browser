' start-ungoogled-cdp.vbs
' ---------------------------------------------------------------------------
' Starts ungoogled-chromium (or any Chromium build) from this folder with a
' remote CDP endpoint, and optionally exposes it to the LAN through a bundled
' port forwarder.
'
' How it works
'   1. Chromium is launched with --remote-debugging-port on 127.0.0.1.
'      (Chromium/Chrome refuses to bind DevTools to a non-loopback address.)
'   2. If gost.exe sits next to this script, it is started as a hidden
'      forwarder:  0.0.0.0:<FORWARD_PORT> -> 127.0.0.1:<CDP_PORT>
'   3. This script keeps running and watches the Chromium process that owns the
'      debug port. When that browser fully exits, the forwarder is stopped and
'      this script exits.
'
' Setup
'   - Put this file next to chrome.exe (UserData is created in the same folder).
'   - Optional LAN access: download gost (single static binary, no runtime
'     dependencies) from https://github.com/go-gost/gost/releases
'       file  : gost_3.3.0_windows_amd64.zip
'       sha256: cc8ac946f86994a3aed47ef1f838cfb6b7649d9245c91fcb9899654b33d61170
'     Unzip gost.exe next to this script. Without gost.exe the script still
'     works, but only the local 127.0.0.1 endpoint is available.
'
' IMPORTANT
'   - Keep --user-data-dir on a dedicated folder; Chrome 136+ ignores
'     --remote-debugging-port when the default profile directory is used.
'   - Fully quit every chrome.exe of this profile before running this script.
'     An already-running instance keeps its old command line and ignores these
'     flags, so the debug port would never open.
'   - CDP has no authentication: anyone who can reach the port controls the
'     whole browser profile. Restrict the port with a firewall rule when the
'     network is shared.
' ---------------------------------------------------------------------------

Option Explicit

' ---- configuration --------------------------------------------------------
Const CDP_PORT = 9222             ' local DevTools/CDP port
Const FORWARD_PORT = 9223         ' LAN-facing port (used only when gost.exe is present)
Const FORWARDER_EXE = "gost.exe"  ' optional port forwarder next to this script
Const WINDOW_STYLE = 0            ' 0 = hide the launched console window (browser windows still show), 1 = normal
Const STARTUP_WAIT_MS = 30000     ' max wait for the debug port owner
Const POLL_INTERVAL_MS = 3000     ' Chromium liveness poll interval
' ---------------------------------------------------------------------------

Dim objFSO, objShell, objWMIService
Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")
Set objWMIService = GetObject("winmgmts:\\.\root\cimv2")

Dim strScriptDir, strChromePath, strUserData, strForwarderPath
strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
strChromePath = strScriptDir & "\chrome.exe"
strUserData = strScriptDir & "\UserData"
strForwarderPath = strScriptDir & "\" & FORWARDER_EXE

If Not objFSO.FileExists(strChromePath) Then
  MsgBox "chrome.exe was not found next to this script:" & vbCrLf & strChromePath, 16, "ungoogled-chromium CDP"
  WScript.Quit 1
End If

' 1) Launch Chromium with the CDP endpoint on loopback.
'    --remote-debugging-address is intentionally not used: current Chromium
'    builds ignore it and always bind DevTools to 127.0.0.1.
Dim strCommand
strCommand = Chr(34) & strChromePath & Chr(34) & _
  " --user-data-dir=" & Chr(34) & strUserData & Chr(34) & _
  " --remote-debugging-port=" & CDP_PORT & _
  " --remote-allow-origins=*" & _
  " --disable-machine-id --disable-encryption --ignore-certificate-errors --test-type"
objShell.Run strCommand, WINDOW_STYLE, False

' 2) Wait until a chrome.exe process owns the debug port.
Dim elapsed
elapsed = 0
Do While Not IsChromeRunning
  WScript.Sleep 500
  elapsed = elapsed + 500
  If elapsed >= STARTUP_WAIT_MS Then Exit Do
Loop

If Not IsChromeRunning Then
  MsgBox "No chrome.exe with --remote-debugging-port=" & CDP_PORT & " was detected within " & (STARTUP_WAIT_MS \ 1000) & "s." & vbCrLf & vbCrLf & _
         "Quit every chrome.exe of this profile first, then run this script again.", 48, "ungoogled-chromium CDP"
  WScript.Quit 1
End If

' 3) Start the optional LAN forwarder when it is present.
If objFSO.FileExists(strForwarderPath) Then
  If Not IsForwarderReady Then StartForwarder
End If

' 4) Keep this script alive until Chromium fully exits.
Do While IsChromeRunning
  WScript.Sleep POLL_INTERVAL_MS
Loop

' 5) Stop the forwarder, then exit.
StopForwarder

' ---------------------------------------------------------------------------
' Helpers
' ---------------------------------------------------------------------------

' True while any chrome.exe of this profile (the process that owns the debug
' port) is alive. Chromium's main process always carries this flag.
Function IsChromeRunning
  Dim procs, p
  IsChromeRunning = False
  On Error Resume Next
  Set procs = objWMIService.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='chrome.exe'")
  For Each p In procs
    If Not IsNull(p.CommandLine) Then
      If InStr(1, p.CommandLine, "--remote-debugging-port=" & CDP_PORT, vbTextCompare) > 0 Then
        IsChromeRunning = True
        Exit Function
      End If
    End If
  Next
  On Error GoTo 0
End Function

' True when something already answers Chrome's version endpoint on the
' forwarded port (for example a leftover gost.exe from an earlier run).
Function IsForwarderReady
  Dim http
  IsForwarderReady = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setProxy 1
  http.setTimeouts 1000, 1000, 2000, 3000
  http.open "GET", "http://127.0.0.1:" & FORWARD_PORT & "/json/version", False
  http.send
  If Err.Number = 0 Then
    If http.status = 200 Then IsForwarderReady = True
  End If
  On Error GoTo 0
End Function

' Launch gost.exe hidden: 0.0.0.0:FORWARD_PORT -> 127.0.0.1:CDP_PORT.
Sub StartForwarder
  Dim startupClass, startupConfig, processClass, spawnedPid, result
  On Error Resume Next
  Set startupClass = objWMIService.Get("Win32_ProcessStartup")
  Set startupConfig = startupClass.SpawnInstance_
  startupConfig.ShowWindow = 0
  Set processClass = objWMIService.Get("Win32_Process")
  result = processClass.Create( _
    Chr(34) & strForwarderPath & Chr(34) & _
    " -L tcp://0.0.0.0:" & FORWARD_PORT & "/127.0.0.1:" & CDP_PORT, _
    strScriptDir, startupConfig, spawnedPid)
  On Error GoTo 0
End Sub

' Terminate every forwarder process that serves our forwarded port.
Sub StopForwarder
  Dim procs, p
  On Error Resume Next
  Set procs = objWMIService.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='" & FORWARDER_EXE & "'")
  For Each p In procs
    If Not IsNull(p.CommandLine) Then
      If InStr(1, p.CommandLine, ":" & FORWARD_PORT, vbTextCompare) > 0 Then
        p.Terminate
      End If
    End If
  Next
  On Error GoTo 0
End Sub
