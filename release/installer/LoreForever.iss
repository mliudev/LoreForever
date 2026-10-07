; Lore Forever Windows installer (Inno Setup 6).
; Installs the add-on into <WoW>\_classic_beta_\Interface\AddOns\LoreForever and the packs from the release zip next
; to it: the English default narration voice (LoreForever_Voice_Default), its Alliance and Horde lands and quest
; packs. Other languages come with their optional voice downloads. Existing translations are left in place.
; The WoW folder is found from Battle.net's
; uninstall entry, and the player can change it on the folder page. Running a newer installer updates in place.
;
; Extra narrator voices (optional): a page after the folder page offers each voice in the [Code] voice table. A ticked
; voice's all-in-one zip downloads from this version's GitHub release while installing and is unzipped next to the
; add-on. Voices already installed start ticked, so running a newer installer updates them. A failed download never
; fails the install: the finish page says where to get the voice instead.
;
; Command line (on top of Inno's own /SILENT, /VERYSILENT, /SUPPRESSMSGBOXES, /DIR=):
;   /VOICES=female       voices to install, comma-separated ids from the voice table; also "all" or "none". Without
;                        it, a silent install updates the voices already installed and adds none.
;   /VOICEURL=<base>     where the voice zips come from instead of this version's release, e.g.
;                        https://github.com/mliudev/LoreForever/releases/latest/download/ (to smoke-test a build
;                        whose release isn't published yet)
;   /QA                  requires an explicit scratch /DIR; companion files and voice stay under it. No registry,
;                        shortcuts, app launch, process stop or uninstaller; leaves the real installation alone.
;
; Built by .github/workflows/release.yml from the unzipped release zip:
;   iscc /DAppVersion=0.3.0 /DSourceDir=<folder holding the zip's add-on folders> /DOutputDir=dist release\installer\LoreForever.iss
; With the companion app (LOR-132), when the release build made one, add
;   /DCompanionDir=<the built LoreForeverCompanion folder> /DCompanionIss=<companion\packaging\companion.iss>
; which adds a components page (the add-on; the companion; its narration voice). Without them, Setup is as before.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\stage"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist"
#endif
; The voice zips of this very version, so a voice always matches the add-on it's installed with.
#define VoiceBase "https://github.com/mliudev/LoreForever/releases/download/v" + AppVersion + "/"

#define AddOnDir "{app}\_classic_beta_\Interface\AddOns\LoreForever"
#define VoiceDir "{app}\_classic_beta_\Interface\AddOns\LoreForever_Voice_Default"
#define AllianceDir "{app}\_classic_beta_\Interface\AddOns\LoreForever_Voice_Default_Alliance"
#define HordeDir "{app}\_classic_beta_\Interface\AddOns\LoreForever_Voice_Default_Horde"
#define FemaleDir "{app}\_classic_beta_\Interface\AddOns\LoreForever_Voice_Female"
#define FemaleAllianceDir "{app}\_classic_beta_\Interface\AddOns\LoreForever_Voice_Female_Alliance"
#define FemaleHordeDir "{app}\_classic_beta_\Interface\AddOns\LoreForever_Voice_Female_Horde"

[Setup]
AppId={{6B7E3F52-4C1D-4E8A-9A57-1F0D2C8B5E31}
AppName=Lore Forever
AppVersion={#AppVersion}
AppVerName=Lore Forever {#AppVersion}
AppPublisher=Mei Liu
AppPublisherURL=https://loreforeverwow.com
AppSupportURL=https://github.com/mliudev/LoreForever/issues
AppUpdatesURL=https://github.com/mliudev/LoreForever/releases
DefaultDirName={code:DefaultWoWDir}
DirExistsWarning=no
AppendDefaultDirName=no
UsePreviousAppDir=not IsQA
DisableProgramGroupPage=yes
DisableReadyPage=no
; The AddOns folder is writable by normal users, so no admin prompt.
PrivilegesRequired=lowest
; Keep the uninstaller out of the game folder.
UninstallFilesDir={localappdata}\LoreForever
; /QA: a test install leaves no uninstaller or Apps & features entry behind.
Uninstallable=not IsQA
UninstallDisplayName=Lore Forever (WoW add-on)
UninstallDisplayIcon={uninstallexe}
SetupIconFile=..\logo.ico
WizardSmallImageFile=wizard-small.bmp,wizard-small-150.bmp,wizard-small-200.bmp
WizardImageFile=wizard-large.bmp,wizard-large-150.bmp,wizard-large-200.bmp
OutputDir={#OutputDir}
OutputBaseFilename=LoreForever-Setup
Compression=lzma2/max
SolidCompression=yes
; Compress in four blocks side by side (the release runner has four cores): 40 s in place of 66 for 0.2 MB more.
LZMANumBlockThreads=4
WizardStyle=modern
ShowLanguageDialog=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel2=This puts the Lore Forever add-on into your World of Warcraft: Forever install.%n%nIf WoW is running, close it first, or type /reload in game afterwards.
SelectDirLabel3=Setup found this World of Warcraft folder. It should contain the _classic_beta_ folder (WoW Forever).
SelectDirBrowseLabel=If that's not your WoW folder, click Browse and pick the one that holds _classic_beta_.
FinishedLabel=Lore Forever is installed.%n%nStart WoW Forever, pick a key when it asks, or type /lore in chat. If it doesn't show up, click AddOns on the character screen and tick "Load out of date AddOns".

[InstallDelete]
; Data chunks change names between versions; clear them so old ones don't linger.
Type: filesandordirs; Name: "{#AddOnDir}\Data"
; Narration used to live in LoreForever\Audio; it ships in the voice pack now.
Type: filesandordirs; Name: "{#AddOnDir}\Audio"
; Replace the packs wholesale so recordings and data chunks dropped from them don't linger.
Type: filesandordirs; Name: "{#VoiceDir}"
Type: filesandordirs; Name: "{#AllianceDir}"
Type: filesandordirs; Name: "{#HordeDir}"

[Files]
; The voice packs' mp3 recordings are compressed already: they go in as they are (nocompression), as in the zip.
; LZMA over them tripled the compile (196 s against 66 on a fast PC) and a player's install time (51 s against 23) for
; 3% of their size. Everything else, .ogg recordings included if a pack ever has any, is compressed (Compression above).
Source: "{#SourceDir}\LoreForever\*"; DestDir: "{#AddOnDir}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\LoreForever_Voice_Default\*"; Excludes: "*.mp3"; DestDir: "{#VoiceDir}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\LoreForever_Voice_Default\*.mp3"; DestDir: "{#VoiceDir}"; Flags: ignoreversion recursesubdirs createallsubdirs nocompression skipifsourcedoesntexist
Source: "{#SourceDir}\LoreForever_Voice_Default_Alliance\*"; Excludes: "*.mp3"; DestDir: "{#AllianceDir}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\LoreForever_Voice_Default_Alliance\*.mp3"; DestDir: "{#AllianceDir}"; Flags: ignoreversion recursesubdirs createallsubdirs nocompression skipifsourcedoesntexist
Source: "{#SourceDir}\LoreForever_Voice_Default_Horde\*"; Excludes: "*.mp3"; DestDir: "{#HordeDir}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\LoreForever_Voice_Default_Horde\*.mp3"; DestDir: "{#HordeDir}"; Flags: ignoreversion recursesubdirs createallsubdirs nocompression skipifsourcedoesntexist

[UninstallDelete]
Type: filesandordirs; Name: "{#AddOnDir}"
Type: filesandordirs; Name: "{#VoiceDir}"
Type: filesandordirs; Name: "{#AllianceDir}"
Type: filesandordirs; Name: "{#HordeDir}"
; Extra voices: only the ones this installer put there (a voice unzipped by hand stays).
Type: filesandordirs; Name: "{#FemaleDir}"; Check: VoiceChosen('female')
Type: filesandordirs; Name: "{#FemaleAllianceDir}"; Check: VoiceChosen('female')
Type: filesandordirs; Name: "{#FemaleHordeDir}"; Check: VoiceChosen('female')

[Run]
Filename: "https://loreforeverwow.com"; Description: "Open the Lore Forever website"; Flags: postinstall shellexec nowait unchecked; Check: not IsQA

[Code]
// ---- Extra narrator voices ----------------------------------------------------------------------------------
// The voice table: one entry per optional voice, in page order. Asset is its all-in-one zip on the GitHub release
// (scripts/build-voice-packs.sh builds it) and Folders the add-on folders inside it, ';'-separated. A new voice
// needs a row here and its folders in [UninstallDelete]; pipeline/tests/qa_artifact.py checks both against
// build-voice-packs.sh.
var
  VoiceIds, VoiceNames, VoiceAssets, VoiceFolders: array of String;
  VoiceWanted: array of Boolean;
  VoicesDecided: Boolean;
  VoicePage: TInputOptionWizardPage;
  VoicePageDir: String;
  VoiceProblems: String;

procedure InitVoices();
begin
  SetArrayLength(VoiceIds, 1);
  SetArrayLength(VoiceNames, 1);
  SetArrayLength(VoiceAssets, 1);
  SetArrayLength(VoiceFolders, 1);
  SetArrayLength(VoiceWanted, 1);
  VoiceIds[0] := 'female';
  VoiceNames[0] := 'Female narrator (stories, answers and lands)';
  VoiceAssets[0] := 'LoreForever_Voice_Female-complete.zip';
  VoiceFolders[0] := 'LoreForever_Voice_Female;LoreForever_Voice_Female_Alliance;LoreForever_Voice_Female_Horde';
end;

// A bare /QA on the command line. ({param:QA} only sees /QA=value, so it's checked by hand.)
function IsQA(): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/QA') = 0 then Result := True;
end;

function InitializeSetup(): Boolean;
begin
  // Abort before default-folder discovery or any installation side effects.
  Result := (not IsQA()) or (Trim(ExpandConstant('{param:DIR|}')) <> '');
  if not Result then
    SuppressibleMsgBox('/QA needs an explicit /DIR pointing to a scratch WoW folder.', mbError, MB_OK, IDOK);
end;
function AddOnsDir(): String;
begin
  Result := AddBackslash(WizardDirValue()) + '_classic_beta_\Interface\AddOns';
end;

// Voice I's folders as a list (the caller frees it).
function FoldersOf(I: Integer): TStringList;
var
  S: String;
begin
  S := VoiceFolders[I];
  StringChangeEx(S, ';', #13#10, True);
  Result := TStringList.Create;
  Result.Text := S;
end;

// A voice counts as installed when its first folder has its .toc.
function VoiceInstalled(I: Integer): Boolean;
var
  F: TStringList;
begin
  F := FoldersOf(I);
  try
    Result := FileExists(AddOnsDir() + '\' + F[0] + '\' + F[0] + '.toc');
  finally
    F.Free;
  end;
end;

// /VOICES=female,other | all | none. Returns False when the switch isn't given.
function VoiceFromSwitch(I: Integer; var Wanted: Boolean): Boolean;
var
  V: String;
begin
  V := Lowercase(ExpandConstant('{param:VOICES|*}'));
  Result := V <> '*';
  if Result then
    Wanted := (V = 'all') or (Pos(',' + VoiceIds[I] + ',', ',' + V + ',') > 0);
end;

// Which voices this run installs: the page's ticks, or for a silent install the /VOICES switch (else the voices
// already there, to update them). Decided once, the first time anything asks.
procedure DecideVoices();
var
  I: Integer;
  W: Boolean;
begin
  if VoicesDecided then Exit;
  for I := 0 to GetArrayLength(VoiceIds) - 1 do begin
    if not WizardSilent() then
      VoiceWanted[I] := VoicePage.Values[I]
    else if VoiceFromSwitch(I, W) then
      VoiceWanted[I] := W
    else
      VoiceWanted[I] := VoiceInstalled(I);
  end;
  VoicesDecided := True;
end;

// [UninstallDelete] Check: the uninstaller removes a voice's folders only if this installer put them there.
function VoiceChosen(Id: String): Boolean;
var
  I: Integer;
begin
  DecideVoices();
  Result := False;
  for I := 0 to GetArrayLength(VoiceIds) - 1 do
    if VoiceIds[I] = Id then Result := VoiceWanted[I];
end;

function OnVoiceProgress(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
begin
  if ProgressMax > 0 then
    WizardForm.ProgressGauge.Position := WizardForm.ProgressGauge.Min +
      Integer((WizardForm.ProgressGauge.Max - WizardForm.ProgressGauge.Min) * Progress div ProgressMax);
  Result := True;
end;

// Unzips with Windows' own tar (Windows 10 1803 and later), else PowerShell's Expand-Archive. Both have finished
// when they return; Shell.Application's CopyHere hasn't (it copies in the background, with no way to tell when it's
// done), so it isn't used.
function Unzip(Zip, Dest: String): Boolean;
var
  Tar, Ps, Z, D: String;
  Code: Integer;
begin
  Result := False;
  Tar := ExpandConstant('{sysnative}\tar.exe');
  if not FileExists(Tar) then Tar := ExpandConstant('{sys}\tar.exe');
  if FileExists(Tar) then
    Result := Exec(Tar, '-xf "' + Zip + '" -C "' + Dest + '"', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
  if not Result then begin
    Log('tar did not unzip ' + Zip + '; trying PowerShell');
    Z := Zip;
    D := Dest;
    StringChangeEx(Z, '''', '''''', True);
    StringChangeEx(D, '''', '''''', True);
    Ps := ExpandConstant('{sysnative}\WindowsPowerShell\v1.0\powershell.exe');
    if not FileExists(Ps) then Ps := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    Result := Exec(Ps, '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ProgressPreference = ''SilentlyContinue''; ' +
      'Expand-Archive -LiteralPath ''' + Z + ''' -DestinationPath ''' + D + ''' -Force"', '', SW_HIDE,
      ewWaitUntilTerminated, Code) and (Code = 0);
  end;
end;

// Downloads and unpacks voice I. The old copy is replaced only once the new zip is here, so a failed download
// leaves an installed voice as it was.
procedure InstallVoice(I: Integer);
var
  Url, Zip, Dest: String;
  F: TStringList;
  K: Integer;
  Ok: Boolean;
begin
  Url := ExpandConstant('{param:VOICEURL|{#VoiceBase}}');
  if Copy(Url, Length(Url), 1) <> '/' then Url := Url + '/';
  Url := Url + VoiceAssets[I];
  Dest := AddOnsDir();
  WizardForm.StatusLabel.Caption := 'Downloading: ' + VoiceNames[I];
  Log('voice ' + VoiceIds[I] + ': downloading ' + Url);
  try
    DownloadTemporaryFile(Url, VoiceAssets[I], '', @OnVoiceProgress);
  except
    Log('voice ' + VoiceIds[I] + ': download failed: ' + GetExceptionMessage());
    VoiceProblems := VoiceProblems + #13#10 + '- ' + VoiceNames[I] + ': the download didn''t work.';
    Exit;
  end;
  Zip := ExpandConstant('{tmp}\') + VoiceAssets[I];
  WizardForm.StatusLabel.Caption := 'Unpacking: ' + VoiceNames[I];
  F := FoldersOf(I);
  try
    for K := 0 to F.Count - 1 do DelTree(Dest + '\' + F[K], True, True, True);
    Ok := Unzip(Zip, Dest);
    for K := 0 to F.Count - 1 do
      if not FileExists(Dest + '\' + F[K] + '\' + F[K] + '.toc') then Ok := False;
  finally
    F.Free;
  end;
  DeleteFile(Zip);
  if Ok then
    Log('voice ' + VoiceIds[I] + ': installed')
  else begin
    Log('voice ' + VoiceIds[I] + ': unpacking failed');
    VoiceProblems := VoiceProblems + #13#10 + '- ' + VoiceNames[I] + ': it downloaded but couldn''t be unpacked.';
  end;
end;

procedure InitializeWizard();
var
  I: Integer;
begin
  InitVoices();
  VoicePage := CreateInputOptionPage(wpSelectDir, 'Extra narrator voices',
    'Lore Forever comes with the male narrator. Want another voice too?',
    'Tick a voice to download it while Lore Forever installs, or skip this: voices are also at ' +
    'loreforeverwow.com/downloads. In game, pick one under Options > Narration voices.', False, False);
  for I := 0 to GetArrayLength(VoiceIds) - 1 do VoicePage.Add(VoiceNames[I]);
end;

procedure CurPageChanged(CurPageID: Integer);
var
  I: Integer;
  W: Boolean;
begin
  // Tick what's already installed in the chosen folder (or what /VOICES asks for), again if the folder changes.
  if (CurPageID = VoicePage.ID) and (VoicePageDir <> WizardDirValue()) then begin
    VoicePageDir := WizardDirValue();
    for I := 0 to GetArrayLength(VoiceIds) - 1 do begin
      if not VoiceFromSwitch(I, W) then W := VoiceInstalled(I);
      VoicePage.Values[I] := W;
    end;
  end;
  if (CurPageID = wpFinished) and (VoiceProblems <> '') then
    WizardForm.FinishedLabel.Caption := WizardForm.FinishedLabel.Caption + #13#10#13#10 +
      'Some voices couldn''t be installed:' + VoiceProblems + #13#10 +
      'Get them at loreforeverwow.com/downloads. Lore Forever itself is installed and works without them.';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  I: Integer;
begin
  if CurStep = ssInstall then DecideVoices();
  if CurStep = ssPostInstall then
    for I := 0 to GetArrayLength(VoiceIds) - 1 do
      if VoiceWanted[I] then InstallVoice(I);
end;

// ---- The WoW folder ------------------------------------------------------------------------------------------
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
  if IsQA() then begin
    Result := ExpandConstant('{param:DIR|}');
    Exit;
  end;
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
    if IsQA() then
      Dir := ExpandConstant('{param:DIR|}')
    else begin
      // Accept the _classic_beta_ folder itself, or its AddOns folder, by walking up to the WoW root.
      if CompareText(ExtractFileName(Dir), 'AddOns') = 0 then Dir := ExtractFileDir(ExtractFileDir(ExtractFileDir(Dir)));
      if CompareText(ExtractFileName(Dir), '_classic_beta_') = 0 then Dir := ExtractFileDir(Dir);
    end;
    if not DirExists(AddBackslash(Dir) + '_classic_beta_') then begin
      // SuppressibleMsgBox: a silent install (/SUPPRESSMSGBOXES) with a wrong /DIR fails instead of hanging on the box.
      SuppressibleMsgBox('There''s no _classic_beta_ folder in' + #13#10 + Dir + #13#10#13#10 +
             'Pick your World of Warcraft folder: the one that holds _classic_beta_ (WoW Forever).', mbError, MB_OK, IDOK);
      Result := False;
    end else
      WizardForm.DirEdit.Text := Dir;
  end;
end;

// The companion app's part of Setup (LOR-132; see the header). It goes last: its [Setup] header ends this [Code]
// section, its event handlers run alongside the ones above, and its #defines (it has its own VoiceBase) come after
// every use of this file's.
#ifdef CompanionIss
  #include CompanionIss
#endif
