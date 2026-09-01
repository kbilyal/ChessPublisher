#ifndef MyVersion
  #define MyVersion "1.05.00"
#endif
#ifndef MyDate
  #define MyDate "2026-09-01"
#endif
#ifndef MyNumericVersion
  #define MyNumericVersion "1.5.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\\build\\payload"
#endif
#ifndef OutputDir
  #define OutputDir "..\\dist"
#endif
#ifndef ReleaseIcon
  #define ReleaseIcon "..\\ChessPublisher.ico"
#endif

[Setup]
AppId={{C9DA7940-E999-4CDE-A19E-63BD5A6A23D8}
AppName=Chess-Publisher
AppVersion={#MyVersion}
AppPublisher=Kyamran Bilyal
AppPublisherURL=https://github.com/kbilyal/ChessPublisher
AppSupportURL=https://github.com/kbilyal/ChessPublisher/issues
AppUpdatesURL=https://github.com/kbilyal/ChessPublisher
DefaultDirName={localappdata}\Programs\Chess-Publisher
DefaultGroupName=Chess-Publisher
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=Chess-Publisher-v{#MyVersion}-{#MyDate}
SetupIconFile={#ReleaseIcon}
UninstallDisplayIcon={app}\ChessPublisher.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
InfoAfterFile=..\PRIVACY.md
VersionInfoVersion={#MyNumericVersion}
VersionInfoCompany=Kyamran Bilyal
VersionInfoDescription=Chess-Publisher Setup
VersionInfoProductName=Chess-Publisher
VersionInfoProductVersion={#MyVersion}

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Chess-Publisher"; Filename: "{app}\ChessPublisher.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Chess-Publisher"; Filename: "{app}\ChessPublisher.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Dirs]
Name: "{userdocs}\ChessPublisher Tournaments"

[Run]
Filename: "{app}\ChessPublisher.exe"; Description: "Launch Chess-Publisher"; Flags: nowait postinstall skipifsilent
