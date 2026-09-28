; Lore Forever Windows installer (Inno Setup 6).
; Installs the add-on into <WoW>\_classic_beta_\Interface\AddOns\LoreForever. The WoW folder is found from
; Battle.net's uninstall entry, and the player can change it on the folder page. Running a newer installer
; updates in place.
;
; Built by .github/workflows/release.yml:
;   iscc /DAppVersion=0.2.0 /DSourceDir=<folder holding LoreForever\> /DOutputDir=dist release\installer\LoreForever.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\stage"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist"
#endif

#define AddOnDir "{app}\_classic_beta_\Interface\AddOns\LoreForever"

[Setup]
AppId={{6B7E3F52-4C1D-4E8A-9A57-1F0D2C8B5E31}
AppName=Lore Forever
AppVersion={#AppVersion}
AppVerName=Lore Forever {#AppVersion}
AppPublisher=Mei Liu
AppPublisherURL=https://loreforever.mliu.io
AppSupportURL=https://github.com/mliudev/LoreForever/issues
AppUpdatesURL=https://github.com/mliudev/LoreForever/releases
DefaultDirName={code:DefaultWoWDir}
DirExistsWarning=no
AppendDefaultDirName=no
UsePreviousAppDir=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
; The AddOns folder is writable by normal users, so no admin prompt.
PrivilegesRequired=lowest
; Keep the uninstaller out of the game folder.
UninstallFilesDir={localappdata}\LoreForever
UninstallDisplayName=Lore Forever (WoW add-on)
UninstallDisplayIcon={uninstallexe}
SetupIconFile=..\logo.ico
WizardSmallImageFile=wizard-small.bmp,wizard-small-150.bmp,wizard-small-200.bmp
WizardImageFile=wizard-large.bmp,wizard-large-150.bmp,wizard-large-200.bmp
OutputDir={#OutputDir}
OutputBaseFilename=LoreForever-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel2=This puts the Lore Forever add-on into your World of Warcraft: Forever install.%n%nIf WoW is running, close it first (or type /reload in game afterwards).
SelectDirLabel3=Setup found this World of Warcraft folder. It should contain the _classic_beta_ folder (WoW Forever).
SelectDirBrowseLabel=If that's not your WoW folder, click Browse and pick the one that holds _classic_beta_.
FinishedLabel=Lore Forever is installed.%n%nStart WoW Forever, pick a key when it asks, or type /lore in chat. If it doesn't show up, click AddOns on the character screen and tick "Load out of date AddOns".

[InstallDelete]
; Data chunks change names between versions; clear them so old ones don't linger.
Type: filesandordirs; Name: "{#AddOnDir}\Data"

[Files]
Source: "{#SourceDir}\LoreForever\*"; DestDir: "{#AddOnDir}"; Flags: ignoreversion recursesubdirs createallsubdirs

[UninstallDelete]
Type: filesandordirs; Name: "{#AddOnDir}"

[Run]
Filename: "https://loreforever.mliu.io"; Description: "Open the Lore Forever website"; Flags: postinstall shellexec nowait unchecked

[Code]
function FindWoW(): String;
var
  Path: String;
  Drives: String;
  I: Integer;
begin
  Result := '';
  if RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\World of Warcraft', 'InstallLocation', Path) and DirExists(AddBackslash(Path) + '_classic_beta_') then begin
    Result := Path; Exit;
  end;
  if RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\World of Warcraft', 'InstallLocation', Path) and DirExists(AddBackslash(Path) + '_classic_beta_') then begin
    Result := Path; Exit;
  end;
  Drives := 'CDEFGH';
  for I := 1 to Length(Drives) do begin
    Path := Drives[I] + ':\Program Files (x86)\World of Warcraft';
    if DirExists(Path + '\_classic_beta_') then begin Result := Path; Exit; end;
    Path := Drives[I] + ':\World of Warcraft';
    if DirExists(Path + '\_classic_beta_') then begin Result := Path; Exit; end;
    Path := Drives[I] + ':\Games\World of Warcraft';
    if DirExists(Path + '\_classic_beta_') then begin Result := Path; Exit; end;
    Path := Drives[I] + ':\Battle.net\World of Warcraft';
    if DirExists(Path + '\_classic_beta_') then begin Result := Path; Exit; end;
    Path := Drives[I] + ':\BattleNet\World of Warcraft';
    if DirExists(Path + '\_classic_beta_') then begin Result := Path; Exit; end;
  end;
end;

function DefaultWoWDir(Param: String): String;
begin
  Result := FindWoW();
  if Result = '' then
    Result := ExpandConstant('{commonpf32}\World of Warcraft');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Dir: String;
begin
  Result := True;
  if CurPageID = wpSelectDir then begin
    Dir := WizardDirValue();
    // Accept the _classic_beta_ folder itself, or its AddOns folder, by walking up to the WoW root.
    if CompareText(ExtractFileName(Dir), 'AddOns') = 0 then Dir := ExtractFileDir(ExtractFileDir(ExtractFileDir(Dir)));
    if CompareText(ExtractFileName(Dir), '_classic_beta_') = 0 then Dir := ExtractFileDir(Dir);
    if not DirExists(AddBackslash(Dir) + '_classic_beta_') then begin
      MsgBox('There''s no _classic_beta_ folder in' + #13#10 + Dir + #13#10#13#10 +
             'Pick your World of Warcraft folder: the one that holds _classic_beta_ (WoW Forever).', mbError, MB_OK);
      Result := False;
    end else
      WizardForm.DirEdit.Text := Dir;
  end;
end;
