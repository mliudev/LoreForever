param(
  [Parameter(Mandatory=$true)][string]$BuildDirectory,
  [string]$VoiceBase=''
)
$ErrorActionPreference='Stop'
$qaRoot='C:\Users\Mike\LoreForeverQA'
$qaBuild=[IO.Path]::GetFullPath($BuildDirectory)
if(-not $qaBuild.StartsWith($qaRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Build must live inside QA scratch'}
$qaProof=Get-Content -LiteralPath (Join-Path $qaBuild 'qa-build.json') -Raw | ConvertFrom-Json
$qaSetup=$qaProof.setup
if((Get-FileHash -LiteralPath $qaSetup -Algorithm SHA256).Hash.ToLower() -ne $qaProof.setup_sha256){throw 'Setup differs from its build proof'}
$qaTests=Join-Path $qaRoot ('t-'+[guid]::NewGuid().ToString('N').Substring(0,10))
New-Item -ItemType Directory -Path $qaTests | Out-Null
function NormalSnapshot {
  $qaSnapshot=[ordered]@{}
  $qaSnapshot.game_hint=(Get-ItemProperty -LiteralPath 'HKCU:\Software\LoreForever' -ErrorAction SilentlyContinue).GameDir
  $qaSnapshot.autostart=(Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).LoreForeverCompanion
  $qaSnapshot.uninstall_registry=Test-Path -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{6B7E3F52-4C1D-4E8A-9A57-1F0D2C8B5E31}_is1'
  $qaSnapshot.shortcut=Test-Path -LiteralPath (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Lore Forever Companion.lnk')
  $qaSnapshot.processes=@(Get-Process -Name WowB,LoreForeverCompanion -ErrorAction SilentlyContinue | Sort-Object Id | ForEach-Object { "$($_.Name):$($_.Id):$($_.StartTime.Ticks)" })
  $qaSnapshot.normal_files=@(
    foreach($qaLocation in @((Join-Path $env:LOCALAPPDATA 'LoreForever'),(Join-Path $env:LOCALAPPDATA 'Programs\Lore Forever Companion'),(Join-Path $env:APPDATA 'LoreForever'))){
      if(Test-Path -LiteralPath $qaLocation){Get-ChildItem -LiteralPath $qaLocation -Recurse -File | Sort-Object FullName | ForEach-Object { "$($_.FullName):$($_.Length):$($_.LastWriteTimeUtc.Ticks)" }}
    }
  )
  $qaSnapshot.game_history=@()
  if($qaSnapshot.game_hint){
    $qaHistory=Join-Path $qaSnapshot.game_hint '_classic_beta_\WTF'
    if(Test-Path -LiteralPath $qaHistory){$qaSnapshot.game_history=@(Get-ChildItem -LiteralPath $qaHistory -Recurse -File | Sort-Object FullName | ForEach-Object { "$($_.FullName):$($_.Length):$($_.LastWriteTimeUtc.Ticks)" })}
  }
  $qaSnapshot | ConvertTo-Json -Depth 6 -Compress
}
function RunSetup([string]$Name,[string[]]$Arguments){
  $qaLog=Join-Path $qaTests ($Name+'.log')
  $qaArgs=@('/QA','/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/LOG="'+$qaLog+'"'))+$Arguments
  $qaProcess=Start-Process -FilePath $qaSetup -WindowStyle Hidden -ArgumentList $qaArgs -PassThru
  if(-not $qaProcess.WaitForExit(600000)){ $qaProcess.Kill(); throw "QA installer timed out: $Name" }
  $qaProcess.Refresh()
  [ordered]@{name=$Name;exit_code=$qaProcess.ExitCode;log=$qaLog}
}
function Check([bool]$Okay,[string]$Why){if(-not $Okay){throw $Why}}
$qaBefore=NormalSnapshot
$qaBefore | Set-Content -LiteralPath (Join-Path $qaTests 'normal-before.json') -Encoding utf8
$qaReport=[ordered]@{evidence_kind=$qaProof.evidence_kind;build_directory=$qaBuild;report_directory=$qaTests;source_commit=$qaProof.source_commit;setup_sha256=$qaProof.setup_sha256;status='untested';cases=@();limitations=@('Silent isolated fixture checks do not prove the visible installer flow.','Actual game first login and audio remain separate checks.','No normal install or uninstall was run.')}
$qaRejected=RunSetup 'reject-missing-directory' @('/VOICES=none')
$qaRejectedEmpty=RunSetup 'reject-empty-directory' @('/DIR=','/VOICES=none')
$qaReport.qa_directory_guard=($qaRejected.exit_code -ne 0 -and $qaRejectedEmpty.exit_code -ne 0)
$qaManifest=Join-Path $qaProof.download_directory 'transport-downloads.json'
foreach($qaCase in @(@{id='INSTALL1';selection='base';voices='none'},@{id='INSTALL2';selection='female';voices='female'},@{id='INSTALL3';selection='quests';voices='quests'})){
  $qaResult=[ordered]@{id=$qaCase.id;selection=$qaCase.selection;status='untested';steps=@()}
  $qaReport.cases+=@($qaResult)
  try {
    if(-not $VoiceBase){$qaResult.reason='Exact candidate downloads were not supplied';continue}
    Check ($VoiceBase -match '^http://(127\.0\.0\.1|localhost):') 'Require a local exact-candidate download server'
    Check ((Get-FileHash -LiteralPath $qaManifest -Algorithm SHA256).Hash.ToLower() -eq $qaProof.download_manifest_sha256) 'Download manifest changed after Setup compilation'
    $qaSelectedManifest=Get-Content -LiteralPath $qaManifest -Raw | ConvertFrom-Json
    if($qaCase.selection -ne 'base' -and @($qaSelectedManifest.selections.($qaCase.selection)).Count -eq 0){$qaResult.reason='Selected future packs are not yet available';continue}
    $qaWow=Join-Path $qaTests $qaCase.id
    New-Item -ItemType Directory -Path (Join-Path $qaWow '_classic_beta_') | Out-Null
    $qaResult.directory=$qaWow
    $qaInstall=RunSetup ($qaCase.id+'-fresh') @(('/DIR="'+$qaWow+'"'),'/COMPONENTS=addon',('/VOICES='+$qaCase.voices),('/VOICEURL='+$VoiceBase))
    $qaResult.steps+=@($qaInstall)
    Check ($qaInstall.exit_code -eq 0) ('Fresh installer failed: '+$qaCase.id)
    $qaVerify=& python.exe (Join-Path $PSScriptRoot 'verify-install.py') $qaProof.candidate_zip $qaWow $qaManifest $qaCase.selection
    Check ($LASTEXITCODE -eq 0) ('Selected installed bytes/downloads/dependencies differ: '+$qaCase.id)
    $qaVerify | Set-Content -LiteralPath (Join-Path $qaTests ($qaCase.id+'-bytes.json')) -Encoding utf8
    Check (-not (Test-Path -LiteralPath (Join-Path $qaWow 'Companion'))) 'Add-on-only choice installed companion'
    Check (-not (Get-ChildItem -LiteralPath $qaWow -Recurse -Filter 'unins*')) 'QA created an uninstaller'
    $qaResult.status='passed'
  } catch {$qaResult.status='failed';$qaResult.error=$_.Exception.Message}
}
$qaAfter=NormalSnapshot
$qaAfter | Set-Content -LiteralPath (Join-Path $qaTests 'normal-after.json') -Encoding utf8
$qaReport.normal_installation_unchanged=($qaBefore -eq $qaAfter)
$qaStatuses=@($qaReport.cases | ForEach-Object {$_.status})
if(-not $qaReport.normal_installation_unchanged -or -not $qaReport.qa_directory_guard -or $qaStatuses -contains 'failed'){$qaReport.status='failed'}
elseif($qaStatuses -notcontains 'untested'){$qaReport.status='passed'}
$qaReport.finished_at=(Get-Date).ToString('o')
$qaReport | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $qaTests 'qa-report.json') -Encoding utf8
$qaReport | ConvertTo-Json -Depth 10
if($qaReport.status -ne 'passed'){exit 1}
