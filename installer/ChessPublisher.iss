#ifndef MyVersion
  #define MyVersion "1.03.64"
#endif
#ifndef MyDate
  #define MyDate "2026-08-29"
#endif
#ifndef SourceDir
  #define SourceDir "..\\build\\payload"
#endif
#ifndef OutputDir
  #define OutputDir "..\\dist"
#endif

[Setup]
AppId={{C9DA7940-E999-4CDE-A19E-63BD5A6A23D8}
AppName=ChessPublisher
AppVersion={#MyVersion}
AppPublisher=Kyamran Bilyal
AppPublisherURL=https://github.com/kbilyal/ChessPublisher
AppSupportURL=https://github.com/kbilyal/ChessPublisher/issues
AppUpdatesURL=https://github.com/kbilyal/ChessPublisher
DefaultDirName={localappdata}\Programs\ChessPublisher
DefaultGroupName=ChessPublisher
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=ChessPublisher-v{#MyVersion}-{#MyDate}
UninstallDisplayIcon={app}\ChessPublisher.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
InfoAfterFile=..\PRIVACY.md
VersionInfoVersion=1.3.64.0
VersionInfoCompany=Kyamran Bilyal
VersionInfoDescription=ChessPublisher Setup
VersionInfoProductName=ChessPublisher
VersionInfoProductVersion={#MyVersion}

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\ChessPublisher"; Filename: "{app}\ChessPublisher.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\ChessPublisher"; Filename: "{app}\ChessPublisher.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Dirs]
Name: "{userdocs}\ChessPublisher Tournaments"

[Run]
Filename: "{app}\ChessPublisher.exe"; Description: "Launch ChessPublisher"; Flags: nowait postinstall skipifsilent
