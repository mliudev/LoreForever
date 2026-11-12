; Lore Forever Windows installer (Inno Setup 6).
; Installs the add-on into <WoW>\_forever_\Interface\AddOns\LoreForever (WoW Forever's launch client; the beta's
; _classic_beta_ when there's no _forever_) and the packs from the release zip next to it: the English default
; narration voice (LoreForever_Voice_Default), its Alliance and Horde lands and quest packs. Other languages come with their optional voice downloads. Existing translations are left in place.
; The WoW folder is found from Battle.net's
; uninstall entry, and the player can change it on the folder page. Running a newer installer updates in place.
;
; Extra narrator voices (optional): a page after the folder page offers each voice in the [Code] voice table. A ticked
; voice's zips download from this version's GitHub release once the add-on is in, several at a time on a fast line
; and the starting zones' first (RunDownloadQueue), and are unzipped next to the add-on. Voices already installed start
; ticked, so running a newer installer updates them. A failed download never fails the install: the finish page says
; where to get the voice instead.
;
; The pick from loreforeverwow.com/downloads (LOR-848): the site serves this same signed file under a name that says
; what the player picked there, "Lore Forever Setup (female, en, storyteller).exe" (narrator, language, bundle), and
; the rows of that pick start ticked too.
;
; Command line (on top of Inno's own /SILENT, /VERYSILENT, /SUPPRESSMSGBOXES, /DIR=):
;   /VOICES=female       voices to install, comma-separated ids from the voice table; also "all" or "none". Without
;                        it, a silent install updates the voices already installed and adds the name's pick.
;   /VOICEURL=<base>     where the voice zips come from instead of this version's release, e.g.
;                        https://github.com/mliudev/LoreForever/releases/latest/download/ (to smoke-test a build
;                        whose release isn't published yet)
;   /QA                  requires an explicit scratch /DIR. No registry, shortcuts, website or uninstaller; leaves
;                        the real installation alone.
;   /DOWNLOADSLOTS=N     at most N voice packs download at once (1-4; one more starts only on a fast line); 0 uses
;                        Setup's own downloader only, one pack at a time, as before.
;   /REDOWNLOAD          fetch every ticked pack again, even one an earlier run of this version already put in place
;                        (by default a second run skips those, so "Stop for now" loses nothing).
;
; Built by .github/workflows/release.yml from the unzipped release zip:
;   iscc /DAppVersion=0.3.0 /DSourceDir=<folder holding the zip's add-on folders> /DOutputDir=dist release\installer\LoreForever.iss
; Willo, the companion app, is a download of its own (Willo-Setup.exe, companion/packaging/Willo.iss in the private
; repo); this Setup used to offer it as a component.

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

#define AddOnDir "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever"
#define VoiceDir "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Default"
#define AllianceDir "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Default_Alliance"
#define HordeDir "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Default_Horde"
#define GiversDir "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_QuestGivers_Start"
#define FemaleDir "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Female"
#define FemaleAllianceDir "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Female_Alliance"
#define FemaleHordeDir "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Female_Horde"

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
; Each run's uninstall log replaces the last one instead of adding to it. Setup.exe used to install the companion app
; (Willo) too, and an appended log would remember its files: uninstalling the add-on would then delete Willo, which
; Willo-Setup.exe now installs in that same folder. What this run installs is what the uninstaller removes.
UninstallLogMode=overwrite
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
; Always keep a log ("Setup Log <date> #NNN.txt" in %TEMP%): when a player says Setup hung, it says which step took how
; long (the status lines of the narration downloads, LOR-337).
SetupLogging=yes

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel2=This puts the Lore Forever add-on into your World of Warcraft: Forever install.%n%nIf WoW is running, close it first, or type /reload in game afterwards.
SelectDirLabel3=Setup found this World of Warcraft folder. It should contain the _forever_ folder (WoW Forever).
SelectDirBrowseLabel=If that's not your WoW folder, click Browse and pick the one that holds _forever_.
FinishedLabel=Lore Forever is installed.%n%nStart WoW Forever, pick a key when it asks, or type /lore in chat. If it doesn't show up, click AddOns on the character screen and tick "Load out of date AddOns".%n%nIf World of Warcraft is open, type /reload in the game's chat to load the update.
; Inno shows this one, not FinishedLabel, when Setup makes no shortcuts (always, here): the same words.
FinishedLabelNoIcons=Lore Forever is installed.%n%nStart WoW Forever, pick a key when it asks, or type /lore in chat. If it doesn't show up, click AddOns on the character screen and tick "Load out of date AddOns".%n%nIf World of Warcraft is open, type /reload in the game's chat to load the update.

[InstallDelete]
; Data chunks change names between versions; clear them so old ones don't linger.
Type: filesandordirs; Name: "{#AddOnDir}\Data"
; Narration used to live in LoreForever\Audio; it ships in the voice pack now.
Type: filesandordirs; Name: "{#AddOnDir}\Audio"
; Replace the packs wholesale so recordings and data chunks dropped from them don't linger.
Type: filesandordirs; Name: "{#VoiceDir}"
Type: filesandordirs; Name: "{#AllianceDir}"
Type: filesandordirs; Name: "{#HordeDir}"
Type: filesandordirs; Name: "{#GiversDir}"

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
Source: "{#SourceDir}\LoreForever_Voice_QuestGivers_Start\*"; Excludes: "*.mp3"; DestDir: "{#GiversDir}"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "{#SourceDir}\LoreForever_Voice_QuestGivers_Start\*.mp3"; DestDir: "{#GiversDir}"; Flags: ignoreversion recursesubdirs createallsubdirs nocompression skipifsourcedoesntexist

[UninstallDelete]
Type: filesandordirs; Name: "{#AddOnDir}"
Type: filesandordirs; Name: "{#VoiceDir}"
Type: filesandordirs; Name: "{#AllianceDir}"
Type: filesandordirs; Name: "{#HordeDir}"
Type: filesandordirs; Name: "{#GiversDir}"
; Which voice packs Setup put in place, so a second run skips them (RunDownloadQueue).
Type: files; Name: "{app}\.lf-voices-installed.txt"
; Extra voices: only the ones this installer put there (a voice unzipped by hand stays).
Type: filesandordirs; Name: "{#FemaleDir}"; Check: VoiceChosen('female')
Type: filesandordirs; Name: "{#FemaleAllianceDir}"; Check: VoiceChosen('female')
Type: filesandordirs; Name: "{#FemaleHordeDir}"; Check: VoiceChosen('female')

Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Female_MorePlaces"; Check: VoiceChosen('female-more')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Female_MorePeople"; Check: VoiceChosen('female-more')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Female_MoreItems"; Check: VoiceChosen('female-more')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Female_MoreQuests1"; Check: VoiceChosen('female-more')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Female_MoreQuests2"; Check: VoiceChosen('female-more')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Female_MoreQuests3"; Check: VoiceChosen('female-more')

Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Female_Quests"; Check: VoiceChosen('female-quests')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Female_Quests2"; Check: VoiceChosen('female-quests')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Female_Quests3"; Check: VoiceChosen('female-quests')

Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Default_MorePlaces"; Check: VoiceChosen('more')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Default_MorePeople"; Check: VoiceChosen('more')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Default_MoreItems"; Check: VoiceChosen('more')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Default_MoreQuests1"; Check: VoiceChosen('more')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Default_MoreQuests2"; Check: VoiceChosen('more')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Default_MoreQuests3"; Check: VoiceChosen('more')

Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Default_Quests"; Check: VoiceChosen('quests')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Default_Quests2"; Check: VoiceChosen('quests')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Default_Quests3"; Check: VoiceChosen('quests')

Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_QuestGivers"; Check: VoiceChosen('givers')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_QuestGivers2"; Check: VoiceChosen('givers')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_QuestGivers3"; Check: VoiceChosen('givers')

Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Original"; Check: VoiceChosen('original')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Original_Alliance"; Check: VoiceChosen('original')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Original_Horde"; Check: VoiceChosen('original')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Original_MorePlaces"; Check: VoiceChosen('original')
Type: filesandordirs; Name: "{app}\{code:GameFlavor}\Interface\AddOns\LoreForever_Voice_Original_MorePeople"; Check: VoiceChosen('original')

#ifdef DownloadUninstallIss
  #include DownloadUninstallIss
#endif

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
  VoicePageRow: array of Integer;   // voice I's row on the page; -1 off the page
  VoicePageDir: String;
  VoiceProblems: String;
  PickNarrator, PickLang, PickBundle: String;

procedure InitVoices();
begin
  SetArrayLength(VoiceIds, 7);
  SetArrayLength(VoiceNames, 7);
  SetArrayLength(VoiceAssets, 7);
  SetArrayLength(VoiceFolders, 7);
  SetArrayLength(VoiceWanted, 7);
  // The rows follow the downloads page's cards (LOR-848): the female narrator is The add-on, more from a narrator
  // makes it Storyteller, quest dialogue and the quest givers make it Everything.
  VoiceIds[0] := 'female';
  VoiceNames[0] := 'Female narrator: the same stories in a second voice, with the Alliance and Horde lands';
  VoiceAssets[0] := 'LoreForever_Voice_Female-complete.zip';
  VoiceFolders[0] := 'LoreForever_Voice_Female;LoreForever_Voice_Female_Alliance;LoreForever_Voice_Female_Horde';
  VoiceIds[1] := 'female-more';
  VoiceNames[1] := 'More from the female narrator: people and bosses, more places, item and quest stories';
  VoiceAssets[1] := 'LoreForever_Voice_Female_MorePlaces.zip';
  VoiceFolders[1] := 'LoreForever_Voice_Female_MorePlaces';
  VoiceIds[2] := 'female-quests';
  VoiceNames[2] := 'Quest dialogue, read by the female narrator';
  VoiceAssets[2] := 'LoreForever_Voice_Female_Quests.zip';
  VoiceFolders[2] := 'LoreForever_Voice_Female_Quests';
  VoiceIds[3] := 'more';
  VoiceNames[3] := 'More from the male narrator: people and bosses, more places, item and quest stories';
  VoiceAssets[3] := 'LoreForever_Voice_Default_MorePlaces.zip';
  VoiceFolders[3] := 'LoreForever_Voice_Default_MorePlaces';
  VoiceIds[4] := 'quests';
  VoiceNames[4] := 'Quest dialogue, read by the male narrator';
  VoiceAssets[4] := 'LoreForever_Voice_Default_Quests.zip';
  VoiceFolders[4] := 'LoreForever_Voice_Default_Quests';
  VoiceIds[5] := 'givers';
  VoiceNames[5] := 'Quest givers'' voices: each quest giver speaks their own words';
  VoiceAssets[5] := 'LoreForever_Voice_QuestGivers.zip';
  VoiceFolders[5] := 'LoreForever_Voice_QuestGivers';
  // Off the page (Mike, 10/26: drop the original male narrator), still updated for the players who have him.
  VoiceIds[6] := 'original';
  VoiceNames[6] := 'Original male narrator';
  VoiceAssets[6] := 'LoreForever_Voice_Original-complete.zip';
  VoiceFolders[6] := 'LoreForever_Voice_Original;LoreForever_Voice_Original_Alliance;LoreForever_Voice_Original_Horde';
#ifndef DownloadIss
  // Keep unavailable download choices hidden until exact release hashes are compiled.
  SetArrayLength(VoiceIds, 0);
  SetArrayLength(VoiceNames, 0);
  SetArrayLength(VoiceAssets, 0);
  SetArrayLength(VoiceFolders, 0);
  SetArrayLength(VoiceWanted, 0);
#endif
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
// The game's folder in the WoW folder Root: WoW Forever's launch client (_forever_), else the beta's (_classic_beta_);
// '' when neither is there.
function FlavorIn(Root: String): String;
begin
  Result := '';
  if DirExists(AddBackslash(Root) + '_forever_') then Result := '_forever_'
  else if DirExists(AddBackslash(Root) + '_classic_beta_') then Result := '_classic_beta_';
end;

// {code:GameFlavor}: the game's folder in the WoW folder being installed into (the folder page checked it's there).
function GameFlavor(Param: String): String;
begin
  Result := FlavorIn(ExpandConstant('{app}'));
  if Result = '' then Result := '_forever_';
end;

function AddOnsDir(): String;
begin
  Result := FlavorIn(WizardDirValue());
  if Result = '' then Result := '_forever_';
  Result := AddBackslash(WizardDirValue()) + Result + '\Interface\AddOns';
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

// What the player picked on loreforeverwow.com/downloads, from this file's name (LOR-848): the site serves it as
// "Lore Forever Setup (female, en, storyteller).exe" (functions/download/setup). The first "(...)" counts: a browser
// puts its " (1)" for a second download after it. Any other name picks nothing.
procedure ReadPick();
var
  S: String;
  P: Integer;
begin
  S := Lowercase(ExtractFileName(ExpandConstant('{srcexe}')));
  P := Pos('(', S);
  if P = 0 then Exit;
  S := Copy(S, P + 1, Length(S));
  P := Pos(')', S);
  if P = 0 then Exit;
  S := Copy(S, 1, P - 1) + ',';
  StringChangeEx(S, ' ', '', True);
  P := Pos(',', S); PickNarrator := Copy(S, 1, P - 1); S := Copy(S, P + 1, Length(S));
  P := Pos(',', S); PickLang := Copy(S, 1, P - 1); S := Copy(S, P + 1, Length(S));
  P := Pos(',', S); PickBundle := Copy(S, 1, P - 1);
  Log('picked on the website: ' + PickNarrator + ', ' + PickLang + ', ' + PickBundle);
end;

// The rows the pick's card holds (site/lib/bundles.js): the narrator's own for The add-on, more from them for
// Storyteller, quest dialogue and the quest givers for Everything. Only the English narrators have rows so far; the
// site names a language read in English (Russian) "en", and says a language's own narration isn't in Setup yet.
function PickedVoice(Id: String): Boolean;
var
  Want: String;
begin
  Want := '';
  if (PickLang = 'en') and (PickNarrator = 'male') then begin
    if PickBundle = 'storyteller' then Want := 'more'
    else if PickBundle = 'everything' then Want := 'more,quests,givers';
  end else if (PickLang = 'en') and (PickNarrator = 'female') then begin
    if PickBundle = 'addon' then Want := 'female'
    else if PickBundle = 'storyteller' then Want := 'female,female-more'
    else if PickBundle = 'everything' then Want := 'female,female-more,female-quests,givers';
  end;
  Result := Pos(',' + Id + ',', ',' + Want + ',') > 0;
end;

// Which voices this run installs: the page's ticks, or for a silent install the /VOICES switch (else the voices
// already there, to update them, and the name's pick). A voice off the page goes by the switch, else installed.
// Decided once, the first time anything asks.
procedure DecideVoices();
var
  I: Integer;
  W: Boolean;
begin
  if VoicesDecided then Exit;
  for I := 0 to GetArrayLength(VoiceIds) - 1 do begin
    if not WizardSilent() and (VoicePageRow[I] >= 0) then
      VoiceWanted[I] := VoicePage.Values[VoicePageRow[I]]
    else if VoiceFromSwitch(I, W) then
      VoiceWanted[I] := W
    else
      VoiceWanted[I] := VoiceInstalled(I) or (WizardSilent() and PickedVoice(VoiceIds[I]));
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

// The bar and the status lines while a voice downloads (LOR-337). The bar follows the download and the status counts
// the megabytes, so a slow connection still shows it moving. After the last byte Setup checks the file's SHA-256,
// unpacks it and moves it into place: for the quest pack (about 340 MB in about 5,800 files) that can take minutes,
// longer while antivirus scans each new file. A full bar under "Downloading" for all that time looked stuck at 99%,
// so then the bar turns into a moving one and the status says what Setup is doing. Each step goes in the Setup log too
// (with its time), which shows how long one took when a player says it hung.
var
  DownloadCaption, DownloadDoneCaption: String;
  DownloadShownMB: Int64;
  QActive: Boolean;   // the download queue owns the bar and the words (RunDownloadQueue)

procedure ShowBusy(Caption: String);
begin
  if QActive then begin
    Log('status: ' + Caption);
    Exit;
  end;
  if WizardForm.StatusLabel.Caption <> Caption then begin
    WizardForm.StatusLabel.Caption := Caption;
    WizardForm.FilenameLabel.Caption := 'This can take a few minutes. Please leave Setup open.';
    Log('status: ' + Caption);
  end;
  if WizardForm.ProgressGauge.Style <> npbstMarquee then WizardForm.ProgressGauge.Style := npbstMarquee;
end;

procedure StartDownloadStatus(What: String);
begin
  DownloadCaption := 'Downloading ' + What;
  DownloadDoneCaption := 'Checking ' + What + '...';
  DownloadShownMB := -1;
  WizardForm.ProgressGauge.Style := npbstNormal;
  WizardForm.StatusLabel.Caption := DownloadCaption + '...';
  WizardForm.FilenameLabel.Caption := '';
  Log('status: ' + DownloadCaption);
end;

function OnVoiceProgress(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
var
  MB: Int64;
begin
  Result := True;
  if (ProgressMax > 0) and (Progress >= ProgressMax) and (DownloadDoneCaption <> '') then begin
    ShowBusy(DownloadDoneCaption);   // the last byte is in: the SHA-256 check runs now, before this call returns
    Exit;
  end;
  if ProgressMax > 0 then
    WizardForm.ProgressGauge.Position := WizardForm.ProgressGauge.Min +
      Integer((WizardForm.ProgressGauge.Max - WizardForm.ProgressGauge.Min) * Progress div ProgressMax);
  MB := Progress div 1000000;
  if (DownloadCaption <> '') and (MB <> DownloadShownMB) then begin
    DownloadShownMB := MB;
    if ProgressMax > 0 then
      WizardForm.StatusLabel.Caption := DownloadCaption + ' (' + IntToStr(MB) + ' of ' + IntToStr(ProgressMax div 1000000) + ' MB)...'
    else
      WizardForm.StatusLabel.Caption := DownloadCaption + ' (' + IntToStr(MB) + ' MB)...';
  end;
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
  StartDownloadStatus(VoiceNames[I]);
  Log('voice ' + VoiceIds[I] + ': downloading ' + Url);
  try
    DownloadTemporaryFile(Url, VoiceAssets[I], '', @OnVoiceProgress);
  except
    Log('voice ' + VoiceIds[I] + ': download failed: ' + GetExceptionMessage());
    VoiceProblems := VoiceProblems + #13#10 + '- ' + VoiceNames[I] + ': the download didn''t work.';
    Exit;
  end;
  Zip := ExpandConstant('{tmp}\') + VoiceAssets[I];
  ShowBusy('Unpacking ' + VoiceNames[I] + '...');
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

// Exact SHA-checked downloads share a stage on the game drive. All sibling shards
// are verified before any folder is promoted, and promotion rolls back as a group.
var
  DownloadStage: String;
  DownloadFolders, DownloadProof: TStringList;

function BackupHasEntries(Path: String): Boolean;
var
  Found: TFindRec;
begin
  Result := False;
  if FindFirst(Path + '\*', Found) then begin
    try
      repeat
        if (Found.Name <> '.') and (Found.Name <> '..') then Result := True;
      until Result or not FindNext(Found);
    finally
      FindClose(Found);
    end;
  end;
end;

procedure ClearDownloadStage();
begin
  DownloadStage := WizardDirValue() + '\.lf-download-stage';
  if FileExists(DownloadStage + '\recovery-needed.txt') or BackupHasEntries(DownloadStage + '\old') then
    RaiseException('A previous folder replacement needs recovery: ' + DownloadStage);
  if not DelTree(DownloadStage, True, True, True) and DirExists(DownloadStage) then
    RaiseException('Could not clear the previous narration download stage.');
  ForceDirectories(DownloadStage);
end;

procedure BeginDownloadGroup();
begin
  ClearDownloadStage();
  DownloadFolders := TStringList.Create;
  DownloadProof := TStringList.Create;
end;

function DownloadLabel(Asset: String): String;
begin
  if Pos('LoreForever_Voice_QuestGivers', Asset) > 0 then Result := 'quest givers'' voices'
  else if Pos('LoreForever_Voice_Female', Asset) > 0 then Result := 'female narration'
  else if Pos('LoreForever_Voice_Original', Asset) > 0 then Result := 'original male narration'
  else if (Pos('Default_Quests', Asset) > 0) or (Pos('Default_Answers', Asset) > 0) then Result := 'extra quest narration'
  else if Pos('Default_More', Asset) > 0 then Result := 'more male narration'
  else Result := 'included narration';
end;

function VoiceUrlBase(): String;
begin
  Result := ExpandConstant('{param:VOICEURL|{#VoiceBase}}');
  if Copy(Result, Length(Result), 1) <> '/' then Result := Result + '/';
end;

// Checks the unpacked folders in DownloadStage (this version, and a transport shard's source and receipt) and lists
// them for FinishDownloadGroup. Raises at the first that's wrong.
procedure StageFolders(FolderNames, Source, Receipt: String);
var
  Folder: String;
  Text: AnsiString;
  F: TStringList;
  K: Integer;
begin
  F := TStringList.Create;
  try
    StringChangeEx(FolderNames, ';', #13#10, True);
    F.Text := FolderNames;
    for K := 0 to F.Count - 1 do begin
      Folder := F[K];
      if not LoadStringFromFile(DownloadStage + '\' + Folder + '\' + Folder + '.toc', Text) then
        RaiseException('Missing add-on folder: ' + DownloadStage + '\' + Folder + '\' + Folder + '.toc');
      Text := Text + #13#10;
      if (Pos('## Version: {#AppVersion}' + #13#10, Text) = 0) and
         (Pos('## Version: {#AppVersion}' + #10, Text) = 0) then RaiseException('Wrong add-on version: ' + Folder);
      if (Source <> '') and (Pos('## Dependencies: ' + Source + #10, Text) = 0) and
         (Pos('## Dependencies: ' + Source + #13#10, Text) = 0) then RaiseException('Wrong transport dependency: ' + Folder);
      if (Receipt <> '') and (GetSHA256OfFile(DownloadStage + '\' + Folder + '\Transport.json') <> Receipt) then
        RaiseException('Changed transport receipt: ' + Folder);
      DownloadFolders.Add(Folder);
    end;
  finally
    F.Free;
  end;
end;

function PrepareDownload(Asset, Digest, FolderNames, Source, Receipt: String): Boolean;
var
  Zip: String;
begin
  Result := False;
  try
    StartDownloadStatus(DownloadLabel(Asset));
    DownloadTemporaryFile(VoiceUrlBase() + Asset, Asset, Digest, @OnVoiceProgress);
    Zip := ExpandConstant('{tmp}\') + Asset;
    ShowBusy('Unpacking ' + DownloadLabel(Asset) + '...');
    if not Unzip(Zip, DownloadStage) then RaiseException('Could not unpack ' + Asset);
    StageFolders(FolderNames, Source, Receipt);
    Result := True;
    DownloadProof.Add(Asset + #9 + Digest);
    Log('verified download staged: ' + Asset + ' sha256 ' + Digest);
  except
    Log('verified download failed: ' + Asset + ': ' + GetExceptionMessage());
    VoiceProblems := VoiceProblems + #13#10 + '- ' + DownloadLabel(Asset) + ': download or installation failed; retry Setup.';
    if IsQA() then SaveStringToFile(WizardDirValue() + '\lore-download-status.tsv', Asset + #9 + Digest + #9 + 'failed' + #13#10, True);
  end;
end;

function FinishDownloadGroup(Ready: Boolean): Boolean;
var
  K, Promoted: Integer;
  Folder, Backup, Status: String;
  HadOld: array of Boolean;
  RecoveryNeeded: Boolean;
begin
  Result := False;
  RecoveryNeeded := False;
  Backup := DownloadStage + '\old';
  try
    if Ready then begin
      ShowBusy('Putting the new narration in place...');
      ForceDirectories(Backup);
      SetArrayLength(HadOld, DownloadFolders.Count);
      Promoted := 0;
      for K := 0 to DownloadFolders.Count - 1 do begin
        Folder := DownloadFolders[K];
        HadOld[K] := DirExists(AddOnsDir() + '\' + Folder);
        if HadOld[K] and not RenameFile(AddOnsDir() + '\' + Folder, Backup + '\' + Folder) then Break;
        if not RenameFile(DownloadStage + '\' + Folder, AddOnsDir() + '\' + Folder) then begin
          if HadOld[K] and not RenameFile(Backup + '\' + Folder, AddOnsDir() + '\' + Folder) then RecoveryNeeded := True;
          Break;
        end;
        Promoted := Promoted + 1;
      end;
      Result := Promoted = DownloadFolders.Count;
      if not Result then begin
        for K := 0 to Promoted - 1 do begin
          if not DelTree(AddOnsDir() + '\' + DownloadFolders[K], True, True, True) then RecoveryNeeded := True;
          if HadOld[K] and not RenameFile(Backup + '\' + DownloadFolders[K], AddOnsDir() + '\' + DownloadFolders[K]) then RecoveryNeeded := True;
        end;
        VoiceProblems := VoiceProblems + #13#10 + '- Could not replace downloaded add-on folders.';
      end;
    end;
    if Result then Status := 'passed' else Status := 'failed';
    if IsQA() then
      for K := 0 to DownloadProof.Count - 1 do
        SaveStringToFile(WizardDirValue() + '\lore-download-status.tsv', DownloadProof[K] + #9 + Status + #13#10, True);
    // Preserve any unrestored backup on failure; never discard working audio.
    if RecoveryNeeded then SaveStringToFile(DownloadStage + '\recovery-needed.txt', 'Folder rollback is incomplete; preserve the old backups.', False)
    else DelTree(DownloadStage, True, True, True);
  finally
    DownloadFolders.Free;
    DownloadProof.Free;
  end;
end;

function OwnedTransportFolder(Source, Folder: String): Boolean;
var
  Tail: String;
  I: Integer;
  Toc: AnsiString;
begin
  Result := False;
  Tail := Copy(Folder, Length(Source + '_Transport_') + 1, 14);
  if (Copy(Folder, 1, Length(Source + '_Transport_')) <> Source + '_Transport_') or
     (Length(Folder) <> Length(Source + '_Transport_') + 14) or (Copy(Tail, 4, 1) <> '_') then Exit;
  for I := 1 to 3 do if Pos(Copy(Tail, I, 1), '0123456789') = 0 then Exit;
  for I := 5 to 14 do if Pos(Copy(Tail, I, 1), '0123456789abcdef') = 0 then Exit;
  if not LoadStringFromFile(AddOnsDir() + '\' + Folder + '\' + Folder + '.toc', Toc) then Exit;
  Toc := Toc + #13#10;
  Result := ((Pos('## Dependencies: ' + Source + #10, Toc) > 0) or
             (Pos('## Dependencies: ' + Source + #13#10, Toc) > 0)) and
            ((Pos('## X-LoreForever-Transport-For: ' + Source + #10, Toc) > 0) or
             (Pos('## X-LoreForever-Transport-For: ' + Source + #13#10, Toc) > 0));
end;

procedure PruneTransport(Source, Required: String);
var
  Found: TFindRec;
  Folder, Retired, Candidate: String;
  Suffix: Integer;
begin
  // Retire only proven owned generations by atomic same-volume move outside
  // AddOns. Partial cleanup can never leave an old TOC loading missing audio.
  if FindFirst(AddOnsDir() + '\' + Source + '_Transport_*', Found) then begin
    try
      repeat
        Folder := Found.Name;
        if ((Found.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0) and
           (Pos(';' + Folder + ';', ';' + Required + ';') = 0) and
           OwnedTransportFolder(Source, Folder) then begin
          Retired := WizardDirValue() + '\.lf-retired-transport\' + Folder;
          Candidate := Retired;
          Suffix := 0;
          while DirExists(Candidate) or FileExists(Candidate) do begin
            Suffix := Suffix + 1;
            Candidate := Retired + '_' + IntToStr(Suffix);
          end;
          if not ForceDirectories(ExtractFileDir(Candidate)) or
             not RenameFile(AddOnsDir() + '\' + Folder, Candidate) then begin
            Log('could not retire superseded transport folder: ' + Folder);
            VoiceProblems := VoiceProblems + #13#10 + '- Older narration could not be replaced. Close the game and run Setup again.';
          end else if not DelTree(Candidate, True, True, True) then
            Log('retired transport backup preserved outside AddOns: ' + Candidate);
        end;
      until not FindNext(Found);
    finally
      FindClose(Found);
    end;
  end;
end;

// ---- The voice packs, several at a time ----------------------------------------------------------------------
// Mike, 11/10: "Right now it can take several minutes to install" and "the progress bar is rather uninformative, it
// doesn't show how many quest packs are left". The generated InstallVerifiedDownloads queues the ticked packs, most
// needed first (installer_downloads.py: a narrator's own stories and lands, then the starting zones' packs, then the
// rest), and RunDownloadQueue fetches them with Windows' own curl.exe: one at a time to begin with, and one more beside
// them (up to MaxSlots) each time every running download still gets SlotSpeed, so a slow line stays at one at a time,
// in order, as before. Each finished pack has its size checked, then its SHA-256 (certutil, else Setup's own check)
// and is unpacked in the background while the others download; then it's staged on the game drive and put in place
// with rollback by FinishDownloadGroup, one pack at a time. A pack curl can't fetch gets a second try with Setup's own
// downloader, which is also how every pack comes on a Windows without curl.exe. One bar fills once for all of it.
// "Stop for now" keeps the packs that are ready, and the next run skips them (.lf-voices-installed.txt in the WoW
// folder; /REDOWNLOAD fetches them anyway).
const
  QWaiting = 0;       // not started
  QDownloading = 1;   // curl.exe, or Setup's own downloader, is on it
  QRetry = 2;         // curl didn't get it: Setup's own downloader next
  QDownloaded = 3;    // here, its size right; to be checked and unpacked
  QUnpacking = 4;
  QReady = 5;         // in place, or already was
  QFailed = 6;
  QStopped = 7;       // the player stopped before it was ready
  MaxSlots = 4;
  SlotSpeed = 1500000;   // bytes a second each running download must get before another one starts beside them

var
  QAsset, QDigest, QFolders, QLabel: array of String;
  QBytes, QGot: array of Int64;
  QState: array of Integer;
  QSkipped, QChecked: array of Boolean;
  QSetupTries: array of Integer;
  QCount, QSlots, QUnzip, QSetupFetch, QCurlWins, QCurlFails, QSamples: Integer;
  QCurl, QCurlProto, QTmp, QStage: String;
  QMaxSlots: Integer;
  QStop, QRecovery: Boolean;
  QSpeed, QLastBytes, QTrialSpeed: Int64;
  QTrialSamples: Integer;
  QLastTick, QStopTick, QLastPoll: DWord;
  QEtaLabel, QStopLabel: TNewStaticText;
  QOldCancel: TNotifyEvent;
  QOldCloseQuery: TCloseQueryEvent;
  QOldCancelCaption: String;
  QOldCancelEnabled: Boolean;
  QOldCancelLeft, QOldCancelWidth: Integer;

function GetTickCount(): DWord; external 'GetTickCount@kernel32.dll stdcall';

// Windows' MSG record (Setup is a 32-bit program), for WaitABit's message loop.
type
  TQueueMsg = record
    hwnd: HWND;
    message: Cardinal;
    wParam: Longint;
    lParam: Longint;
    time: DWord;
    ptX: Longint;
    ptY: Longint;
    lPrivate: DWord;
  end;

function PeekMessage(var lpMsg: TQueueMsg; hWnd: HWND; wMsgFilterMin, wMsgFilterMax, wRemoveMsg: Cardinal): BOOL;
  external 'PeekMessageW@user32.dll stdcall';
function TranslateMessage(const lpMsg: TQueueMsg): BOOL; external 'TranslateMessage@user32.dll stdcall';
function DispatchMessage(const lpMsg: TQueueMsg): Longint; external 'DispatchMessageW@user32.dll stdcall';

function HasSwitch(Name: String): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), Name) = 0 then Result := True;
end;

// A program of Windows' own (System32), '' if this Windows hasn't got it.
function SystemTool(Name: String): String;
begin
  Result := ExpandConstant('{sysnative}\') + Name;
  if not FileExists(Result) then Result := ExpandConstant('{sys}\') + Name;
  if not FileExists(Result) then Result := '';
end;

function ReceiptFile(): String;
begin
  Result := AddBackslash(WizardDirValue()) + '.lf-voices-installed.txt';
end;

function CountFiles(Dir: String): Integer;
var
  Found: TFindRec;
begin
  Result := 0;
  if FindFirst(Dir + '\*', Found) then begin
    try
      repeat
        if (Found.Name <> '.') and (Found.Name <> '..') then begin
          if (Found.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0 then Result := Result + CountFiles(Dir + '\' + Found.Name)
          else Result := Result + 1;
        end;
      until not FindNext(Found);
    finally
      FindClose(Found);
    end;
  end;
end;

// The files a pack's folders hold now.
function PackFiles(FolderNames: String): Integer;
var
  F: TStringList;
  K: Integer;
begin
  Result := 0;
  F := TStringList.Create;
  try
    StringChangeEx(FolderNames, ';', #13#10, True);
    F.Text := FolderNames;
    for K := 0 to F.Count - 1 do Result := Result + CountFiles(AddOnsDir() + '\' + F[K]);
  finally
    F.Free;
  end;
end;

// True when an earlier run put this very zip in place and its folders are still there whole: at this version, with as
// many files as when it was put in place (a file deleted or taken by antivirus since means it's fetched again).
function PackCurrent(Asset, Digest, FolderNames: String): Boolean;
var
  L, F: TStringList;
  K: Integer;
  Toc: AnsiString;
begin
  Result := False;
  if HasSwitch('/REDOWNLOAD') or not FileExists(ReceiptFile()) then Exit;
  L := TStringList.Create;
  F := TStringList.Create;
  try
    L.LoadFromFile(ReceiptFile());
    Result := L.IndexOf(Asset + #9 + Lowercase(Digest) + #9 + IntToStr(PackFiles(FolderNames))) >= 0;
    StringChangeEx(FolderNames, ';', #13#10, True);
    F.Text := FolderNames;
    for K := 0 to F.Count - 1 do
      if Result then begin
        Result := LoadStringFromFile(AddOnsDir() + '\' + F[K] + '\' + F[K] + '.toc', Toc);
        Toc := Toc + #13#10;
        Result := Result and ((Pos('## Version: {#AppVersion}' + #13#10, Toc) > 0) or (Pos('## Version: {#AppVersion}' + #10, Toc) > 0));
      end;
  finally
    L.Free;
    F.Free;
  end;
end;

// Written only once the pack's folders are in place: the zip, its SHA-256 and the files it put there.
procedure SaveReceipt(Asset, Digest, FolderNames: String);
var
  L: TStringList;
  K: Integer;
begin
  L := TStringList.Create;
  try
    if FileExists(ReceiptFile()) then L.LoadFromFile(ReceiptFile());
    for K := L.Count - 1 downto 0 do
      if Copy(L[K], 1, Length(Asset) + 1) = Asset + #9 then L.Delete(K);
    L.Add(Asset + #9 + Digest + #9 + IntToStr(PackFiles(FolderNames)));
    L.SaveToFile(ReceiptFile());
  except
    Log('could not note ' + Asset + ' as installed: ' + GetExceptionMessage());
  end;
  L.Free;
end;

// The generated InstallVerifiedDownloads calls this for each ticked pack, most needed first.
procedure QueueDownload(Asset, Digest, FolderNames, PackName: String; Bytes: Int64);
var
  K: Integer;
begin
  K := QCount;
  QCount := QCount + 1;
  SetArrayLength(QAsset, QCount);
  SetArrayLength(QDigest, QCount);
  SetArrayLength(QFolders, QCount);
  SetArrayLength(QLabel, QCount);
  SetArrayLength(QBytes, QCount);
  SetArrayLength(QGot, QCount);
  SetArrayLength(QState, QCount);
  SetArrayLength(QSkipped, QCount);
  SetArrayLength(QChecked, QCount);
  SetArrayLength(QSetupTries, QCount);
  QAsset[K] := Asset;
  QDigest[K] := Lowercase(Digest);
  QFolders[K] := FolderNames;
  QLabel[K] := PackName;
  QBytes[K] := Bytes;
  QGot[K] := 0;
  QState[K] := QWaiting;
  QChecked[K] := False;
  QSetupTries[K] := 0;
  QSkipped[K] := PackCurrent(Asset, Digest, FolderNames);
  if QSkipped[K] then begin
    QState[K] := QReady;
    Log('voice pack ' + Asset + ': already in place at this version, skipped');
    if IsQA() then SaveStringToFile(WizardDirValue() + '\lore-download-status.tsv', Asset + #9 + Digest + #9 + 'current' + #13#10, True);
  end;
end;

function QFile(K: Integer; Ext: String): String;
begin
  Result := QTmp + QAsset[K] + Ext;
end;

// What a helper script wrote when it finished: its exit code, or -1 while it's still running. A program that was
// ended from outside exits -1 or another negative code: that counts as a failure (1), never as still running.
function DoneCode(Path: String): Integer;
var
  S: AnsiString;
begin
  Result := -1;
  if LoadStringFromFile(Path, S) and (Trim(S) <> '') then begin
    Result := StrToIntDef(Trim(S), 1);
    if Result < 0 then Result := 1;
  end;
end;

procedure WriteHelpers();
begin
  // lf-get.cmd CURL PART URL DONE "PROTOCOLS": one download; curl's exit code goes in DONE when it ends, its complaint
  // in DONE.log. PROTOCOLS keeps it to https (QCurlProto). curl stops by itself on a stall (under 1 kB/s for a minute).
  SaveStringToFile(QTmp + 'lf-get.cmd',
    '@echo off' + #13#10 +
    '"%~1" %~5 --fail --silent --show-error --location --retry 3 --connect-timeout 30 --speed-limit 1024 --speed-time 60 --output "%~2" "%~3" 2>"%~4.log"' + #13#10 +
    '>"%~4" echo %errorlevel%' + #13#10, False);
  // lf-unpack.cmd TAR ZIP DEST DONE SHA256 CERTUTIL POWERSHELL (every program by its full System32 path, never PATH or
  // the folder Setup ran from): checks the zip's SHA-256 (- when Setup's own downloader already did), then
  // unpacks it with Windows' tar, else PowerShell. DONE: 0 unpacked, 1 couldn't unpack or stopped, 2 SHA-256 differs
  // or unread. Once Stop for now leaves lf-stopping beside it, it starts nothing more (the Architect's hold on #3584:
  // a stopped tar used to fall through to PowerShell, still unpacking 52 s later). PowerShell's command ends in a
  // comment naming the zip, so lf-stop.ps1 finds it by this Setup's temporary folder too.
  SaveStringToFile(QTmp + 'lf-unpack.cmd',
    '@echo off' + #13#10 +
    'setlocal' + #13#10 +
    'set "LF_ZIP=%~2"' + #13#10 +
    'set "LF_DEST=%~3"' + #13#10 +
    'if "%~5"=="-" goto unpack' + #13#10 +
    'set "LF_SHA="' + #13#10 +
    'for /f "skip=1 delims=" %%h in (''call "%~6" -hashfile "%~2" SHA256'') do if not defined LF_SHA set "LF_SHA=%%h"' + #13#10 +
    'if not defined LF_SHA (>"%~4" echo 2& exit /b)' + #13#10 +
    'set "LF_SHA=%LF_SHA: =%"' + #13#10 +
    'if /i not "%LF_SHA%"=="%~5" (>"%~4" echo 2& exit /b)' + #13#10 +
    ':unpack' + #13#10 +
    'set LF_RC=1' + #13#10 +
    'if exist "%~dp0lf-stopping" (>"%~4" echo 1& exit /b)' + #13#10 +
    'if exist "%~1" "%~1" -xf "%~2" -C "%~3" && set LF_RC=0' + #13#10 +
    'if exist "%~dp0lf-stopping" (>"%~4" echo 1& exit /b)' + #13#10 +
    'if not "%LF_RC%"=="0" if exist "%~7" "%~7" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ProgressPreference = ''SilentlyContinue''; Expand-Archive -LiteralPath $env:LF_ZIP -DestinationPath $env:LF_DEST -Force #%~2" && set LF_RC=0' + #13#10 +
    '>"%~4" echo %LF_RC%' + #13#10, False);
  // lf-stop.ps1 DIR: ends this Setup's downloads, checks and unpacking, the ones whose command lines name its own
  // temporary folder (several Setups can run side by side), never itself.
  SaveStringToFile(QTmp + 'lf-stop.ps1',
    '$dir = $args[0]' + #13#10 +
    'Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and @(''curl.exe'', ''tar.exe'', ''certutil.exe'', ''powershell.exe'') -contains $_.Name.ToLower() -and $_.CommandLine -and $_.CommandLine.Contains($dir) } | ' +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }' + #13#10, False);
end;

// Starts a helper script in the background, hidden (no window, no focus).
function RunHidden(Script, Args: String): Boolean;
var
  Code: Integer;
begin
  Result := Exec(ExpandConstant('{cmd}'), '/c ""' + QTmp + Script + '" ' + Args + '"', QTmp, SW_HIDE, ewNoWait, Code);
end;

// Wait: block until the stop script ends (only when Setup is closing). Otherwise the window keeps answering and the
// queue's loop waits for the helpers to report.
procedure KillJobs(Wait: Boolean);
var
  Code: Integer;
  How: TExecWait;
begin
  if Wait then How := ewWaitUntilTerminated else How := ewNoWait;
  // First the flag, so a helper script starts nothing new; then end what's running.
  SaveStringToFile(QTmp + 'lf-stopping', 'stop', False);
  Exec(SystemTool('WindowsPowerShell\v1.0\powershell.exe'), '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    QTmp + 'lf-stop.ps1" "' + RemoveBackslash(QTmp) + '"', '', SW_HIDE, How, Code);
end;

function ActiveCurls(): Integer;
var
  K: Integer;
begin
  Result := 0;
  for K := 0 to QCount - 1 do
    if (QState[K] = QDownloading) and (K <> QSetupFetch) then Result := Result + 1;
end;

// The running downloads that hold a slot: one with about two seconds left at its share of the speed doesn't, so the
// next pack starts before it ends and the line never sits idle between packs (Setup notices an end only once a second).
function SlotsInUse(): Integer;
var
  K, Active: Integer;
  Share: Int64;
begin
  Active := ActiveCurls();
  Share := 0;
  if (Active > 0) and (QSamples > 0) then Share := QSpeed * 2 div Active;
  Result := 0;
  for K := 0 to QCount - 1 do
    if (QState[K] = QDownloading) and (K <> QSetupFetch) and
       ((QBytes[K] <= 0) or (QBytes[K] - QGot[K] > Share)) then Result := Result + 1;
end;

// Zips downloaded and not yet unpacked: no new download starts while two wait, so a fast line with slow unpacking
// doesn't pile zips up on disk.
function WaitingZips(): Integer;
var
  K: Integer;
begin
  Result := 0;
  for K := 0 to QCount - 1 do
    if QState[K] = QDownloaded then Result := Result + 1;
end;

// A proxy set in Windows: curl doesn't read it, so Setup's own downloader (which does) fetches every pack.
function ProxySet(): Boolean;
var
  Enabled: Cardinal;
  Auto: String;
begin
  Result := (RegQueryDWordValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Internet Settings', 'ProxyEnable', Enabled) and (Enabled <> 0)) or
    (RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Internet Settings', 'AutoConfigURL', Auto) and (Auto <> ''));
end;

function QueueBusy(): Boolean;
var
  K: Integer;
begin
  Result := False;
  for K := 0 to QCount - 1 do
    case QState[K] of
      QWaiting, QDownloading, QRetry, QDownloaded, QUnpacking: Result := True;
    end;
end;

procedure PackFailed(K: Integer; Why: String);
begin
  Log('verified download failed: ' + QAsset[K] + ': ' + Why);
  QState[K] := QFailed;
  VoiceProblems := VoiceProblems + #13#10 + '- ' + QLabel[K] + ': download or installation failed; retry Setup.';
  if IsQA() then SaveStringToFile(WizardDirValue() + '\lore-download-status.tsv', QAsset[K] + #9 + QDigest[K] + #9 + 'failed' + #13#10, True);
  DeleteFile(QFile(K, ''));
  DeleteFile(QFile(K, '.part'));
end;

procedure StartCurl(K: Integer);
begin
  DeleteFile(QFile(K, '.part'));
  DeleteFile(QFile(K, '.got'));
  QGot[K] := 0;
  if RunHidden('lf-get.cmd', '"' + QCurl + '" "' + QFile(K, '.part') + '" "' + VoiceUrlBase() + QAsset[K] + '" "' + QFile(K, '.got') + '" "' + QCurlProto + '"') then begin
    QState[K] := QDownloading;
    Log('voice pack ' + QAsset[K] + ': downloading (' + IntToStr(ActiveCurls()) + ' at once)');
  end else begin
    Log('voice pack ' + QAsset[K] + ': curl did not start');
    QState[K] := QRetry;
  end;
end;

procedure StartUnpack(K: Integer; Digest: String);
var
  Dest: String;
begin
  Dest := QStage + '\' + IntToStr(K);
  DelTree(Dest, True, True, True);
  ForceDirectories(Dest);
  DeleteFile(QFile(K, '.unpacked'));
  if RunHidden('lf-unpack.cmd', '"' + SystemTool('tar.exe') + '" "' + QFile(K, '') + '" "' + Dest + '" "' + QFile(K, '.unpacked') + '" "' + Digest + '" "' + SystemTool('certutil.exe') + '" "' +
    SystemTool('WindowsPowerShell\v1.0\powershell.exe') + '"') then begin
    QState[K] := QUnpacking;
    QUnzip := K;
    Log('voice pack ' + QAsset[K] + ': checking and unpacking');
  end else
    PackFailed(K, 'could not start unpacking');
end;

procedure CurlDone(K, Code: Integer);
var
  Size: Int64;
  Why: AnsiString;
begin
  if QStop then begin
    QState[K] := QStopped;
    DeleteFile(QFile(K, '.part'));
    Exit;
  end;
  DeleteFile(QFile(K, ''));
  if (Code = 0) and FileSize64(QFile(K, '.part'), Size) and ((QBytes[K] <= 0) or (Size = QBytes[K])) and
     RenameFile(QFile(K, '.part'), QFile(K, '')) then begin
    QGot[K] := Size;
    QState[K] := QDownloaded;
    QCurlWins := QCurlWins + 1;
    Log('voice pack ' + QAsset[K] + ': downloaded, ' + IntToStr(Size) + ' bytes');
    Exit;
  end;
  if not LoadStringFromFile(QFile(K, '.got.log'), Why) then Why := '';
  Log('voice pack ' + QAsset[K] + ': curl did not get all of it (exit ' + IntToStr(Code) + ') ' + Trim(Why) +
    '; trying again with Setup''s own downloader');
  DeleteFile(QFile(K, '.part'));
  QGot[K] := 0;
  QState[K] := QRetry;
  QCurlFails := QCurlFails + 1;
  if (QCurlWins = 0) and (QCurlFails >= 2) then begin
    QCurl := '';
    Log('curl is not getting through here: the other packs come one at a time with Setup''s own downloader');
  end;
end;

procedure UnpackDone(K, Code: Integer);
var
  Ready, Same: Boolean;
  Stage: String;
begin
  QUnzip := -1;
  Stage := QStage + '\' + IntToStr(K);
  if QStop then begin
    QState[K] := QStopped;
    DelTree(Stage, True, True, True);
    DeleteFile(QFile(K, ''));
    Exit;
  end;
  if Code = 2 then begin
    // certutil didn't vouch for the bytes: Setup checks the SHA-256 itself before it gives up on them.
    Same := False;
    try
      Same := Lowercase(GetSHA256OfFile(QFile(K, ''))) = QDigest[K];
    except
    end;
    if Same then begin
      Log('voice pack ' + QAsset[K] + ': certutil could not check it; Setup''s own SHA-256 check passed');
      StartUnpack(K, '-');
    end else begin
      Log('voice pack ' + QAsset[K] + ': SHA-256 differs; trying again with Setup''s own downloader');
      DelTree(Stage, True, True, True);
      DeleteFile(QFile(K, ''));
      QGot[K] := 0;
      QState[K] := QRetry;
    end;
    Exit;
  end;
  DownloadStage := Stage;
  DownloadFolders := TStringList.Create;
  DownloadProof := TStringList.Create;
  Ready := False;
  try
    if Code <> 0 then RaiseException('Could not unpack ' + QAsset[K]);
    StageFolders(QFolders[K], '', '');
    DownloadProof.Add(QAsset[K] + #9 + QDigest[K]);
    Ready := True;
    Log('verified download staged: ' + QAsset[K] + ' sha256 ' + QDigest[K]);
  except
    Log('verified download failed: ' + QAsset[K] + ': ' + GetExceptionMessage());
    VoiceProblems := VoiceProblems + #13#10 + '- ' + QLabel[K] + ': download or installation failed; retry Setup.';
    if IsQA() then SaveStringToFile(WizardDirValue() + '\lore-download-status.tsv', QAsset[K] + #9 + QDigest[K] + #9 + 'failed' + #13#10, True);
  end;
  DeleteFile(QFile(K, ''));
  if FinishDownloadGroup(Ready) then begin
    QState[K] := QReady;
    SaveReceipt(QAsset[K], QDigest[K], QFolders[K]);
    Log('voice pack ' + QAsset[K] + ': in place');
  end else
    QState[K] := QFailed;
  if FileExists(Stage + '\recovery-needed.txt') then begin
    QRecovery := True;
    SaveStringToFile(QStage + '\recovery-needed.txt', 'Folder rollback is incomplete; preserve the old backups in ' + Stage + '.', False);
  end;
end;

procedure MeasureSpeed();
var
  TickNow: DWord;
  Got, Rate: Int64;
  K: Integer;
begin
  TickNow := GetTickCount();
  if TickNow - QLastTick < 2000 then Exit;
  Got := 0;
  for K := 0 to QCount - 1 do Got := Got + QGot[K];
  Rate := 0;
  if Got > QLastBytes then Rate := (Got - QLastBytes) * 1000 div (TickNow - QLastTick);
  if QSamples = 0 then QSpeed := Rate else QSpeed := (QSpeed * 2 + Rate) div 3;
  QSamples := QSamples + 1;
  QLastTick := TickNow;
  QLastBytes := Got;
  // A trial slot that didn't pay: three samples after it opened, the speed isn't 15% up, so one stream already
  // filled the line (11/10 on Mike's PC: 55 MB/s on one stream, no more on four). Back to the slots before it, and
  // no more trials.
  if (QTrialSamples > 0) and (QSamples >= QTrialSamples + 3) then begin
    if QSpeed * 100 < QTrialSpeed * 115 then begin
      QSlots := QSlots - 1;
      QMaxSlots := QSlots;
      Log('more downloads at once didn''t help (' + IntToStr(QTrialSpeed div 1000) + ' kB/s before, ' +
        IntToStr(QSpeed div 1000) + ' kB/s after): keeping ' + IntToStr(QSlots));
    end;
    QTrialSamples := 0;
  end;
  // One more download beside the others, as a trial, while each running one still gets SlotSpeed: a slow line keeps
  // one at a time, so the first pack still comes first.
  if (QSamples >= 2) and (QTrialSamples = 0) and (ActiveCurls() >= QSlots) and (QSlots < QMaxSlots) and
     (QSpeed >= SlotSpeed * QSlots) then begin
    QSlots := QSlots + 1;
    QTrialSpeed := QSpeed;
    QTrialSamples := QSamples;
    Log('trying ' + IntToStr(QSlots) + ' voice packs at once (' + IntToStr(QSpeed div 1000) + ' kB/s so far)');
  end;
end;

function GBText(Bytes: Int64): String;
var
  T: Int64;
begin
  T := (Bytes + 50000000) div 100000000;
  Result := IntToStr(T div 10) + '.' + IntToStr(T mod 10);
end;

// The words and the bar (the Design Lead's, 11/10): one count throughout, one bar that fills once and keeps a last
// slice for unpacking, so it's never full while work remains.
procedure ShowQueue();
var
  K, Ready, Settled, Fetching, InFlight, FirstFetch, Unpacking, BarPos: Integer;
  All, Got, Mins: Int64;
  Line1, Line2, Line3: String;
begin
  Ready := 0; Settled := 0; Fetching := 0; InFlight := 0; FirstFetch := -1; Unpacking := 0;
  All := 0; Got := 0;
  for K := 0 to QCount - 1 do begin
    case QState[K] of
      QReady: begin Ready := Ready + 1; Settled := Settled + 1; end;
      QFailed, QStopped: Settled := Settled + 1;
      QWaiting, QRetry: Fetching := Fetching + 1;
      QDownloading: begin
        Fetching := Fetching + 1;
        InFlight := InFlight + 1;
        if FirstFetch < 0 then FirstFetch := K;
      end;
      QDownloaded, QUnpacking: Unpacking := Unpacking + 1;
    end;
    if not QSkipped[K] and (QState[K] <> QFailed) and (QState[K] <> QStopped) then begin
      All := All + QBytes[K];
      case QState[K] of
        QWaiting, QDownloading, QRetry: Got := Got + QGot[K];
      else
        Got := Got + QBytes[K];
      end;
    end;
  end;
  Line1 := IntToStr(Ready) + ' of ' + IntToStr(QCount) + ' voice packs ready ' + #$00B7 + ' ';
  if Fetching > 0 then Line1 := Line1 + GBText(Got) + ' of ' + GBText(All) + ' GB downloaded'
  else Line1 := Line1 + 'everything downloaded';
  Line2 := '';
  if InFlight > 0 then begin
    Line2 := 'Now: ' + QLabel[FirstFetch];
    if InFlight > 1 then Line2 := Line2 + ', and ' + IntToStr(InFlight - 1) + ' more';
  end else if QUnzip >= 0 then begin
    Line2 := 'Now unpacking: ' + QLabel[QUnzip];
    if Unpacking > 1 then Line2 := Line2 + ', and ' + IntToStr(Unpacking - 1) + ' more';
  end;
  Line3 := '';
  if Fetching > 0 then begin
    if (QSamples >= 3) and (QSpeed > 0) and (All > Got) then begin
      Mins := ((All - Got) div QSpeed + 59) div 60;
      if Mins <= 1 then Line3 := 'About a minute of downloading left at this speed.'
      else Line3 := 'About ' + IntToStr(Mins) + ' minutes of downloading left at this speed.';
    end;
  end else if Unpacking > 0 then
    Line3 := 'This part can be slow. It''s still working.';
  if QStop then begin
    Line1 := 'Stopping. Keeping the ' + IntToStr(Ready) + ' voice packs that are ready.';
    Line2 := '';
    Line3 := '';
  end;
  if WizardForm.StatusLabel.Caption <> Line1 then WizardForm.StatusLabel.Caption := Line1;
  if WizardForm.FilenameLabel.Caption <> Line2 then WizardForm.FilenameLabel.Caption := Line2;
  if QEtaLabel.Caption <> Line3 then QEtaLabel.Caption := Line3;
  if WizardForm.ProgressGauge.Style <> npbstNormal then WizardForm.ProgressGauge.Style := npbstNormal;
  // While stopping, stopped packs drop out of the sums, so the bar would jump ahead: hold it where it was.
  if QStop then Exit;
  BarPos := 0;
  // Int64 first: 900 * Got was worked out as a 32-bit number and overflowed, so the bar showed only the unpacking tenth.
  if All > 0 then BarPos := Got * 900 div All;
  BarPos := BarPos + 100 * Settled div QCount;
  WizardForm.ProgressGauge.Position := BarPos;
end;

procedure PollJobs();
var
  K, Code: Integer;
  Size: Int64;
begin
  QLastPoll := GetTickCount();
  for K := 0 to QCount - 1 do
    if (QState[K] = QDownloading) and (K <> QSetupFetch) then begin
      Code := DoneCode(QFile(K, '.got'));
      if Code >= 0 then CurlDone(K, Code)
      else if FileSize64(QFile(K, '.part'), Size) then QGot[K] := Size;
    end;
  if QUnzip >= 0 then begin
    Code := DoneCode(QFile(QUnzip, '.unpacked'));
    if Code >= 0 then UnpackDone(QUnzip, Code);
  end;
  if QRecovery then
    for K := 0 to QCount - 1 do
      case QState[K] of
        QWaiting, QRetry, QDownloaded: PackFailed(K, 'a previous folder replacement needs recovery: ' + QStage);
      end;
  if not QStop then
    for K := 0 to QCount - 1 do
      if (QUnzip < 0) and (QState[K] = QDownloaded) then begin
        if QChecked[K] then StartUnpack(K, '-') else StartUnpack(K, QDigest[K]);
      end;
  if not QStop and (QCurl <> '') then
    for K := 0 to QCount - 1 do
      if (QState[K] = QWaiting) and (SlotsInUse() < QSlots) and (WaitingZips() < 2) then StartCurl(K);
  MeasureSpeed();
  ShowQueue();
end;

function OnQueueProgress(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
begin
  if QSetupFetch >= 0 then QGot[QSetupFetch] := Progress;
  if GetTickCount() - QLastPoll >= 500 then PollJobs();
  Result := not QStop;
end;

// Setup's own downloader, one pack at a time: the second try for a pack curl didn't get, and the way without curl.
// It checks the SHA-256 itself. The other downloads and the unpacking carry on meanwhile (OnQueueProgress).
procedure FetchWithSetup(K: Integer);
begin
  QSetupFetch := K;
  QState[K] := QDownloading;
  QGot[K] := 0;
  DeleteFile(QFile(K, ''));
  Log('voice pack ' + QAsset[K] + ': downloading with Setup''s own downloader');
  try
    DownloadTemporaryFile(VoiceUrlBase() + QAsset[K], QAsset[K], QDigest[K], @OnQueueProgress);
    QGot[K] := QBytes[K];
    QChecked[K] := True;
    QState[K] := QDownloaded;
  except
    QSetupTries[K] := QSetupTries[K] + 1;
    if QStop then QState[K] := QStopped
    else if QSetupTries[K] < 2 then begin
      // One more try: a dropped connection (11/10 on GitHub: "the server returned an invalid or unrecognized
      // response") shouldn't cost a pack.
      Log('voice pack ' + QAsset[K] + ': ' + GetExceptionMessage() + '; trying once more');
      QState[K] := QRetry;
    end else PackFailed(K, GetExceptionMessage());
  end;
  QSetupFetch := -1;
end;

// Waits about half a second while the window keeps answering clicks. Not Exec(..., ewWaitUntilTerminated): Inno
// disables the whole wizard during those waits, so "Stop for now" and the X couldn't be clicked (watched runs on #3584,
// 11/10). Pascal Script has no ProcessMessages: Windows' own message calls do it, between short sleeps.
procedure WaitABit();
var
  Msg: TQueueMsg;
  Started: DWord;
begin
  Started := GetTickCount();
  repeat
    while PeekMessage(Msg, 0, 0, 0, 1) do begin   // 1: PM_REMOVE
      TranslateMessage(Msg);
      DispatchMessage(Msg);
    end;
    if GetTickCount() - Started < 500 then Sleep(25);
  until GetTickCount() - Started >= 500;
end;

procedure StopForNowClick(Sender: TObject);
var
  K: Integer;
begin
  if QStop then Exit;
  QStop := True;
  QStopTick := GetTickCount();
  Log('the player stopped the voice downloads');
  WizardForm.CancelButton.Enabled := False;
  for K := 0 to QCount - 1 do
    case QState[K] of
      QWaiting, QRetry, QDownloaded: QState[K] := QStopped;
    end;
  QStopLabel.Visible := False;
  ShowQueue();
  KillJobs(False);
end;

// The X while voices download (Design Lead, 11/10): the same as Stop for now, with no question.
procedure QueueCloseQuery(Sender: TObject; var CanClose: Boolean);
begin
  CanClose := False;
  StopForNowClick(WizardForm.CancelButton);
end;

procedure ShowQueuePage();
begin
  WizardForm.PageNameLabel.Caption := 'Adding voices';
  WizardForm.PageDescriptionLabel.Caption := 'Lore Forever is installed. You can stop at any time and keep what''s done.';
  WizardForm.StatusLabel.Font.Style := [fsBold];
  WizardForm.ProgressGauge.Style := npbstNormal;
  WizardForm.ProgressGauge.Min := 0;
  WizardForm.ProgressGauge.Max := 1000;
  WizardForm.ProgressGauge.Position := 0;
  QEtaLabel := TNewStaticText.Create(WizardForm);
  QEtaLabel.Parent := WizardForm.ProgressGauge.Parent;
  QEtaLabel.Left := WizardForm.ProgressGauge.Left;
  QEtaLabel.Top := WizardForm.ProgressGauge.Top + WizardForm.ProgressGauge.Height + ScaleY(8);
  QEtaLabel.Caption := '';
  QOldCancel := WizardForm.CancelButton.OnClick;
  QOldCancelCaption := WizardForm.CancelButton.Caption;
  QOldCancelEnabled := WizardForm.CancelButton.Enabled;
  QOldCancelLeft := WizardForm.CancelButton.Left;
  QOldCancelWidth := WizardForm.CancelButton.Width;
  if WizardForm.CancelButton.Width < ScaleX(100) then begin
    WizardForm.CancelButton.Width := ScaleX(100);
    WizardForm.CancelButton.Left := QOldCancelLeft + QOldCancelWidth - ScaleX(100);
  end;
  WizardForm.CancelButton.Caption := 'Stop for now';
  WizardForm.CancelButton.OnClick := @StopForNowClick;
  WizardForm.CancelButton.Enabled := True;
  QOldCloseQuery := WizardForm.OnCloseQuery;
  WizardForm.OnCloseQuery := @QueueCloseQuery;
  QStopLabel := TNewStaticText.Create(WizardForm);
  QStopLabel.Parent := WizardForm;
  QStopLabel.Caption := 'Stopping keeps the packs that are ready.';
  QStopLabel.Left := WizardForm.CancelButton.Left - QStopLabel.Width - ScaleX(12);
  QStopLabel.Top := WizardForm.CancelButton.Top + (WizardForm.CancelButton.Height - QStopLabel.Height) div 2;
end;

function ReadyPacks(): Integer;
var
  K: Integer;
begin
  Result := 0;
  for K := 0 to QCount - 1 do
    if QState[K] = QReady then Result := Result + 1;
end;

function StoppedPacks(): Integer;
var
  K: Integer;
begin
  Result := 0;
  for K := 0 to QCount - 1 do
    if QState[K] = QStopped then Result := Result + 1;
end;

procedure EndQueuePage();
begin
  WizardForm.StatusLabel.Font.Style := [];
  WizardForm.CancelButton.OnClick := QOldCancel;
  WizardForm.CancelButton.Caption := QOldCancelCaption;
  WizardForm.CancelButton.Width := QOldCancelWidth;
  WizardForm.CancelButton.Left := QOldCancelLeft;
  WizardForm.CancelButton.Enabled := QOldCancelEnabled;
  WizardForm.OnCloseQuery := QOldCloseQuery;
  QStopLabel.Visible := False;
  QEtaLabel.Visible := False;
end;

procedure RunDownloadQueue();
var
  K, Next: Integer;
begin
  if QCount = 0 then Exit;
  QTmp := ExpandConstant('{tmp}\');
  ClearDownloadStage();
  QStage := DownloadStage;
  // curl by its full System32 path only, and only over https (or plain http to this PC, the release's own install
  // checks and QA): any other address goes through Setup's own downloader as before. /DOWNLOADSLOTS=N caps the
  // downloads at once (0: no curl at all, Setup's own downloader one at a time; the packs still unpack meanwhile).
  QMaxSlots := StrToIntDef(ExpandConstant('{param:DOWNLOADSLOTS|' + IntToStr(MaxSlots) + '}'), MaxSlots);
  if QMaxSlots > MaxSlots then QMaxSlots := MaxSlots;
  if QMaxSlots < 0 then QMaxSlots := 0;
  QCurl := '';
  if (QMaxSlots > 0) and not ProxySet() then QCurl := SystemTool('curl.exe');
  if Copy(VoiceUrlBase(), 1, 8) = 'https://' then QCurlProto := '--proto =https --proto-redir =https'
  else if (Copy(VoiceUrlBase(), 1, 17) = 'http://127.0.0.1:') or (Copy(VoiceUrlBase(), 1, 17) = 'http://localhost:') then
    QCurlProto := '--proto =http --max-redirs 0'
  else QCurl := '';
  if QCurl = '' then Log('voice packs come one at a time with Setup''s own downloader (no curl.exe, a proxy, /DOWNLOADSLOTS=0 or not https)')
  else Log('downloading voice packs with ' + QCurl + ', up to ' + IntToStr(QMaxSlots) + ' at once');
  QSlots := 1;
  QUnzip := -1;
  QSetupFetch := -1;
  QLastTick := GetTickCount();
  WriteHelpers();
  QActive := True;
  ShowQueuePage();
  try
    while QueueBusy() do begin
      PollJobs();
      if QStop and (GetTickCount() - QStopTick > 20000) then begin
        Log('downloads still running 20 s after the stop are left behind');
        for K := 0 to QCount - 1 do
          case QState[K] of
            QDownloading, QUnpacking: QState[K] := QStopped;
          end;
      end;
      Next := -1;
      if not QStop then
        for K := QCount - 1 downto 0 do
          if (QState[K] = QRetry) or ((QState[K] = QWaiting) and (QCurl = '')) then Next := K;
      if Next >= 0 then FetchWithSetup(Next)
      else if QueueBusy() then WaitABit();
    end;
    ShowQueue();
  finally
    QActive := False;
    EndQueuePage();
    if not QRecovery then DelTree(QStage, True, True, True);
  end;
end;

#ifdef DownloadIss
  #include DownloadIss
#else
function DownloadSizeOf(Id: String; var Packs: Integer): Int64;
begin
  Result := 0;
  Packs := 0;
end;
#endif

// Setup's first screen, for a pick from the website (the Design Lead, 11/10): how much it all is, from the same zips
// and bytes as the downloads page, so the player knows what's coming before it starts.
function PickSizeText(): String;
var
  I, N, Packs: Integer;
  Bytes, SetupBytes, Spare: Int64;
  Bundle, GB: String;
begin
  Result := '';
  if PickBundle = 'everything' then Bundle := 'Everything'
  else if PickBundle = 'storyteller' then Bundle := 'Storyteller'
  else if PickBundle = 'addon' then Bundle := 'The add-on'
  else Exit;
  Bytes := 0;
  Packs := 0;
  for I := 0 to GetArrayLength(VoiceIds) - 1 do
    if PickedVoice(VoiceIds[I]) then begin
      Bytes := Bytes + DownloadSizeOf(VoiceIds[I], N);
      Packs := Packs + N;
    end;
  if (Packs = 0) or not FileSize64(ExpandConstant('{srcexe}'), SetupBytes) then Exit;
  // On disk at once: everything installed, plus the zips in Setup's temporary folder when it's on the same drive as WoW
  // (up to MaxSlots downloading, the next one starting and two waiting to unpack, each under 480 MB).
  Spare := 0;
  if CompareText(ExtractFileDrive(ExpandConstant('{tmp}')), ExtractFileDrive(WizardDirValue())) = 0 then begin
    N := Packs;
    if N > MaxSlots + 3 then N := MaxSlots + 3;
    Spare := Int64(N) * 480000000;
  end;
  // A no-break space before each GB, so "3.6 GB" never breaks across two lines.
  GB := #$00A0 + 'GB';
  Result := 'You picked ' + Bundle + ', about ' + GBText(SetupBytes + Bytes) + GB + ' in all. This file was the first ' +
    GBText(SetupBytes) + GB + '. Setup then downloads the other ' + GBText(Bytes) + GB + ': ' + IntToStr(Packs) +
    ' voice packs. It needs about ' + IntToStr((SetupBytes + Bytes + Spare + 999999999) div 1000000000) + GB +
    ' free where WoW is installed.' + #13#10 +
    'The add-on and the starting zones come first, and you can stop at any time and keep what''s done.';
end;

procedure InitializeWizard();
var
  I, Rows: Integer;
  Ticked, SizeText: String;
  PickSizeLabel: TNewStaticText;
begin
  InitVoices();
#ifdef DownloadIss
  ConfigureAvailableVoices();
#endif
  ReadPick();
  Ticked := '';
  if PickNarrator <> '' then Ticked := 'What you picked on the website is ticked. ';
  VoicePage := CreateInputOptionPage(wpSelectDir, 'Extra narration',
    'The male narrator''s stories and the Alliance and Horde lands are included. Add more narration here.',
    Ticked + 'Tick an option to download it while Lore Forever installs, or skip this: downloads are also at ' +
    'loreforeverwow.com/downloads. In game, pick one under Options > Narration voices.', False, False);
  // The pick's size on the first screen, in place of Inno's "At least ... MB of free disk space", which counts only
  // this file.
  SizeText := PickSizeText();
  if SizeText <> '' then begin
    PickSizeLabel := TNewStaticText.Create(WizardForm);
    PickSizeLabel.Parent := WizardForm.DiskSpaceLabel.Parent;
    PickSizeLabel.Left := WizardForm.DiskSpaceLabel.Left;
    PickSizeLabel.Width := WizardForm.SelectDirPage.Width - WizardForm.DiskSpaceLabel.Left;
    PickSizeLabel.WordWrap := True;
    PickSizeLabel.Caption := SizeText;
    PickSizeLabel.Top := WizardForm.DiskSpaceLabel.Top + WizardForm.DiskSpaceLabel.Height - PickSizeLabel.Height;
    WizardForm.DiskSpaceLabel.Visible := False;
    Log('first screen: ' + SizeText);
  end;
  SetArrayLength(VoicePageRow, GetArrayLength(VoiceIds));
  Rows := 0;
  for I := 0 to GetArrayLength(VoiceIds) - 1 do
    if VoiceIds[I] = 'original' then
      VoicePageRow[I] := -1
    else begin
      VoicePage.Add(VoiceNames[I]);
      VoicePageRow[I] := Rows;
      Rows := Rows + 1;
    end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = VoicePage.ID) and (VoicePage.CheckListBox.Items.Count = 0);
end;

procedure CurPageChanged(CurPageID: Integer);
var
  I: Integer;
  W: Boolean;
begin
  // Tick what's already installed in the chosen folder and the website's pick (or what /VOICES asks for), again if
  // the folder changes.
  if (CurPageID = VoicePage.ID) and (VoicePageDir <> WizardDirValue()) then begin
    VoicePageDir := WizardDirValue();
    for I := 0 to GetArrayLength(VoiceIds) - 1 do
      if VoicePageRow[I] >= 0 then begin
        if not VoiceFromSwitch(I, W) then W := VoiceInstalled(I) or PickedVoice(VoiceIds[I]);
        VoicePage.Values[VoicePageRow[I]] := W;
      end;
  end;
  // After "Stop for now" (the Design Lead, 11/10): what's in, and how to get the rest.
  if (CurPageID = wpFinished) and (StoppedPacks() > 0) then
    WizardForm.FinishedLabel.Caption := IntToStr(ReadyPacks()) + ' of ' + IntToStr(QCount) + ' voice packs are ' +
      'installed. Where a voice is missing, the story shows as text.' + #13#10#13#10 +
      'To get the rest, run this Setup file again.';
  if (CurPageID = wpFinished) and (VoiceProblems <> '') then
    WizardForm.FinishedLabel.Caption := WizardForm.FinishedLabel.Caption + #13#10#13#10 +
      'Some voices couldn''t be installed:' + VoiceProblems + #13#10 +
      'Get them at loreforeverwow.com/downloads. Lore Forever itself is installed and works without them.';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  I: Integer;
begin
  if CurStep = ssInstall then begin
    DecideVoices();
    if IsQA() then DeleteFile(WizardDirValue() + '\lore-download-status.tsv');
  end;
  if CurStep = ssPostInstall then begin
#ifdef DownloadIss
    InstallVerifiedDownloads();
#else
    for I := 0 to GetArrayLength(VoiceIds) - 1 do
      if VoiceWanted[I] then InstallVoice(I);
#endif
  end;
end;

// Setup is closing with downloads still running (it stopped on an error): end them, so nothing keeps writing into the
// temporary folder Setup removes.
procedure DeinitializeSetup();
begin
  if (QTmp <> '') and QueueBusy() then KillJobs(True);
end;

function GetCustomSetupExitCode(): Integer;
begin
  Result := 0;
  if IsQA() and (VoiceProblems <> '') then Result := 1;
end;

// ---- The WoW folder ------------------------------------------------------------------------------------------
function FindWoW(): String;
var
  Path: String;
  Drives: String;
  I: Integer;
begin
  Result := '';
  if RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\World of Warcraft', 'InstallLocation', Path) and (FlavorIn(Path) <> '') then begin
    Result := Path; Exit;
  end;
  if RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\World of Warcraft', 'InstallLocation', Path) and (FlavorIn(Path) <> '') then begin
    Result := Path; Exit;
  end;
  Drives := 'CDEFGH';
  for I := 1 to Length(Drives) do begin
    Path := Drives[I] + ':\Program Files (x86)\World of Warcraft';
    if FlavorIn(Path) <> '' then begin Result := Path; Exit; end;
    Path := Drives[I] + ':\World of Warcraft';
    if FlavorIn(Path) <> '' then begin Result := Path; Exit; end;
    Path := Drives[I] + ':\Games\World of Warcraft';
    if FlavorIn(Path) <> '' then begin Result := Path; Exit; end;
    Path := Drives[I] + ':\Battle.net\World of Warcraft';
    if FlavorIn(Path) <> '' then begin Result := Path; Exit; end;
    Path := Drives[I] + ':\BattleNet\World of Warcraft';
    if FlavorIn(Path) <> '' then begin Result := Path; Exit; end;
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
      // Accept the game's folder itself (_forever_), or its AddOns folder, by walking up to the WoW root.
      if CompareText(ExtractFileName(Dir), 'AddOns') = 0 then Dir := ExtractFileDir(ExtractFileDir(ExtractFileDir(Dir)));
      if (CompareText(ExtractFileName(Dir), '_forever_') = 0) or (CompareText(ExtractFileName(Dir), '_classic_beta_') = 0) then
        Dir := ExtractFileDir(Dir);
    end;
    if FlavorIn(Dir) = '' then begin
      // SuppressibleMsgBox: a silent install (/SUPPRESSMSGBOXES) with a wrong /DIR fails instead of hanging on the box.
      SuppressibleMsgBox('There''s no _forever_ folder in' + #13#10 + Dir + #13#10#13#10 +
             'Pick your World of Warcraft folder: the one that holds _forever_ (WoW Forever).', mbError, MB_OK, IDOK);
      Result := False;
    end else
      WizardForm.DirEdit.Text := Dir;
  end;
end;

