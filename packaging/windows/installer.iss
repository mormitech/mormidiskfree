; Inno Setup script for mormiDiskFree. Per-user install (no admin rights), adds a Start menu entry, no startup entry.
; Silent install, as winget runs it:  mormidiskfree-setup-<version>-windows-x64.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
; CI replaces __VERSION__ and compiles it (see .github/workflows/build.yml).
[Setup]
AppId={{7D2C4B8E-3A51-4F6D-9C0B-1E8A5F2D7B64}
AppName=mormiDiskFree
AppVersion=__VERSION__
AppPublisher=mormitech
; product name and version in the file properties, kept the same as the app .exe (SignPath wants them consistent)
VersionInfoVersion=__VERSION__
VersionInfoProductName=mormiDiskFree
AppPublisherURL=https://github.com/mormitech/mormidiskfree
AppSupportURL=https://github.com/mormitech/mormidiskfree/issues
DefaultDirName={autopf}\mormidiskfree
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist
OutputBaseFilename=mormidiskfree-setup-__VERSION__-windows-x64
UninstallDisplayName=mormiDiskFree
UninstallDisplayIcon={app}\mormidiskfree.exe
Compression=lzma2
SolidCompression=yes

[Files]
Source: "..\..\build\bin\mormidiskfree.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\mormiDiskFree"; Filename: "{app}\mormidiskfree.exe"

[Run]
Filename: "{app}\mormidiskfree.exe"; Description: "Start mormiDiskFree"; Flags: nowait postinstall skipifsilent

[Code]
// taskkill returns before Windows has released the file of the killed process, so wait a moment before the installer
// replaces or deletes it.
procedure StopMormidiskfree;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM mormidiskfree.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(1500);
end;

// An upgrade replaces a file that may be in use, so close the running app first.
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then StopMormidiskfree;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then StopMormidiskfree;
end;
