; Face Mace for Windows: the installer (owner, 2026-10-15: "make the exe file installable"). Built by GitHub on
; Windows with Inno Setup (.github/workflows/facemace-windows.yml) from the FaceMace.exe built there.
; Installs for the current user (no administrator needed), adds Start menu and (optionally) desktop shortcuts, and
; an uninstaller in Settings > Apps. Photos never leave the computer; the program serves Face Mace to the browser at
; 127.0.0.1 only.

#ifndef MyVersion
  #define MyVersion "1.0.0"
#endif

[Setup]
AppId={{6B2F0E4C-7A3D-4F8E-9C51-FACE0ACE2026}
AppName=Face Mace
AppVersion={#MyVersion}
AppVerName=Face Mace {#MyVersion}
AppPublisher=Pi Tech Lab
AppPublisherURL=https://github.com/ex-tern/pi
AppSupportURL=https://github.com/ex-tern/pi/releases/tag/facemace-windows
DefaultDirName={localappdata}\Programs\Face Mace
DefaultGroupName=Face Mace
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\..\..\dist
OutputBaseFilename=FaceMace-Setup
SetupIconFile=assets\facemace.ico
UninstallDisplayIcon={app}\FaceMace.exe
UninstallDisplayName=Face Mace
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
; installing again (a newer FaceMace-Setup.exe, or the same one) updates it in place: the same AppId finds the
; earlier install, its folder and choices are used again (no folder question), a Face Mace still running is
; closed first so its program can be replaced, and what Face Mace remembers (people, answers, scans: kept by the
; browser for facemace.localhost) is not touched (owner, 2026-10-15: "reinstalling on same path updates it")
UsePreviousAppDir=yes
UsePreviousTasks=yes
DisableDirPage=auto
VersionInfoVersion={#MyVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "target\release\facemace.exe"; DestDir: "{app}"; DestName: "FaceMace.exe"; Flags: ignoreversion
Source: "..\..\..\front\facemace\ml\NOTICE.txt"; DestDir: "{app}\licenses"; DestName: "NOTICE-engines.txt"; Flags: ignoreversion
Source: "..\..\..\front\facemace\ml\LICENSE-*.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "..\..\..\front\facemace\heic\*.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "..\..\..\front\facemace\CASCADE-LICENSE.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion

[Icons]
Name: "{group}\Face Mace"; Filename: "{app}\FaceMace.exe"; Comment: "Sort photos and videos by face, on this computer"
Name: "{group}\Uninstall Face Mace"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Face Mace"; Filename: "{app}\FaceMace.exe"; Tasks: desktopicon; Comment: "Sort photos and videos by face, on this computer"

[Run]
Filename: "{app}\FaceMace.exe"; Description: "{cm:LaunchProgram,Face Mace}"; Flags: nowait postinstall skipifsilent

[Code]
// a Face Mace still running (it has no window: it serves the page) is stopped, so FaceMace.exe can be replaced
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{cmd}'), '/C taskkill /IM FaceMace.exe /F', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(600);
  Result := '';
end;


[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /IM FaceMace.exe /F"; Flags: runhidden; RunOnceId: "StopFaceMace"
