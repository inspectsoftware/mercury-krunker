; Mercury Client installer (Inno Setup 6). Built by `cargo xtask installer`, which passes /DAppVersion.
; Per-user install, no admin. The player's data (%LOCALAPPDATA%\Mercury: settings, profile, swaps, scripts) is
; never touched, uninstall included.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{5E1F0C9A-7B42-4D8E-9A61-3C2F8B7D4E10}
AppName=Mercury Client
AppVersion={#AppVersion}
AppVerName=Mercury Client {#AppVersion}
AppPublisher=Mercury Client
DefaultDirName={localappdata}\Programs\Mercury Client
DefaultGroupName=Mercury Client
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\target\installer
OutputBaseFilename=MercuryClient-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\mercury.exe
; Updates run this installer silently while Mercury is open: close it, never restart Windows.
CloseApplications=force
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "..\target\bundle\*"; DestDir: "{app}"; Excludes: "*.pdb"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Mercury Client"; Filename: "{app}\mercury.exe"
Name: "{autodesktop}\Mercury Client"; Filename: "{app}\mercury.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\mercury.exe"; Description: "Start Mercury Client"; Flags: nowait postinstall skipifsilent
; After a silent update (the auto-updater), start the new version.
Filename: "{app}\mercury.exe"; Flags: nowait; Check: WizardSilent
