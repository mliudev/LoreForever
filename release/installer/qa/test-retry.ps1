param([string]$BuildDirectory,[string]$WowDirectory,[string]$TruncatedBase,[string]$VoiceBase)
$ErrorActionPreference='Stop'
$qaRoot='C:\Users\Mike\LoreForeverQA\'
foreach($qaPath in @($BuildDirectory,$WowDirectory)){
  if(-not ([IO.Path]::GetFullPath($qaPath)).StartsWith($qaRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Require isolated QA scratch paths'}
}
foreach($qaURL in @($VoiceBase,$TruncatedBase)){if($qaURL -notmatch '^http://(127\.0\.0\.1|localhost):'){throw 'Require local fixture downloads'}}
$qaProof=Get-Content -LiteralPath (Join-Path $BuildDirectory 'qa-build.json') -Raw | ConvertFrom-Json
if((Get-FileHash -LiteralPath $qaProof.setup -Algorithm SHA256).Hash.ToLower() -ne $qaProof.setup_sha256){throw 'Setup differs from its proof'}
$qaManifest=Join-Path $qaProof.download_directory 'transport-downloads.json'
if((Get-FileHash -LiteralPath $qaManifest -Algorithm SHA256).Hash.ToLower() -ne $qaProof.download_manifest_sha256){throw 'Download manifest differs from its build proof'}
$qaAddons=Join-Path $WowDirectory '_classic_beta_\Interface\AddOns'
function SnapshotFemale {
  @(foreach($qaFolder in @('LoreForever_Voice_Female','LoreForever_Voice_Female_Alliance','LoreForever_Voice_Female_Horde')){
    Get-ChildItem -LiteralPath (Join-Path $qaAddons $qaFolder) -Recurse -File | Sort-Object FullName | ForEach-Object {$_.FullName+':'+(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
  })
}
$qaBefore=SnapshotFemale
$qaArgs=@('/QA','/VERYSILENT','/SUPPRESSMSGBOXES','/COMPONENTS=addon','/VOICES=female',('/DIR="'+$WowDirectory+'"'),('/VOICEURL='+$TruncatedBase))
$qaInstall=Start-Process -FilePath $qaProof.setup -WindowStyle Hidden -PassThru -Wait -ArgumentList $qaArgs
if($qaInstall.ExitCode -eq 0){throw 'Incomplete download falsely reported complete'}
$qaAfter=SnapshotFemale
if(Compare-Object $qaBefore $qaAfter){throw 'Incomplete download changed working voice bytes'}
$qaReceipt=Get-Content -LiteralPath (Join-Path $WowDirectory 'lore-download-status.tsv') -Raw
if($qaReceipt -notmatch 'LoreForever_Voice_Female-complete.zip\t[^\t]+\tfailed'){throw 'Incomplete download has no failed receipt'}
$qaArgs=@('/QA','/VERYSILENT','/SUPPRESSMSGBOXES','/COMPONENTS=addon','/VOICES=female',('/DIR="'+$WowDirectory+'"'),('/VOICEURL='+$VoiceBase))
$qaRetry=Start-Process -FilePath $qaProof.setup -WindowStyle Hidden -PassThru -Wait -ArgumentList $qaArgs
if($qaRetry.ExitCode -ne 0){throw 'Safe retry failed'}
& python.exe (Join-Path $PSScriptRoot 'verify-install.py') $qaProof.candidate_zip $WowDirectory (Join-Path $qaProof.download_directory 'transport-downloads.json') female
if($LASTEXITCODE){throw 'Safe retry installed bytes differ'}
[ordered]@{status='passed';evidence_kind=$qaProof.evidence_kind;incomplete_download_exit=$qaInstall.ExitCode;retry_exit=$qaRetry.ExitCode;working_voice_preserved=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $WowDirectory 'retry-report.json')
Get-Content -LiteralPath (Join-Path $WowDirectory 'retry-report.json')
