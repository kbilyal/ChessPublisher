Option Explicit
Dim fso, shell, root, ps1, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(root, "ChessPublisher-WebView.ps1")
If Not fso.FileExists(ps1) Then
  MsgBox "ChessPublisher-WebView.ps1 is missing." & vbCrLf & vbCrLf & root, vbCritical, "chess-publisher"
  WScript.Quit 2
End If
shell.CurrentDirectory = root
cmd = "powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"
' Window style 0 = hidden; False = the launcher exits immediately.
shell.Run cmd, 0, False
