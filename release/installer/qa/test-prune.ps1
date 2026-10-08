param([string]$BuildDirectory,[string]$WowDirectory,[string]$VoiceBase)
$ErrorActionPreference='Stop'
$qaRoot='C:\Users\Mike\LoreForeverQA\'
foreach($qaPath in @($BuildDirectory,$WowDirectory)){
  if(-not ([IO.Path]::GetFullPath($qaPath)).StartsWith($qaRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Require isolated QA scratch paths'}
}
foreach($qaURL in @($VoiceBase)){if($qaURL -notmatch '^http://(127\.0\.0\.1|localhost):'){throw 'Require local fixture downloads'}}
$qaProof=Get-Content -LiteralPath (Join-Path $BuildDirectory 'qa-build.json') -Raw | ConvertFrom-Json
if((Get-FileHash -LiteralPath $qaProof.setup -Algorithm SHA256).Hash.ToLower() -ne $qaProof.setup_sha256){throw 'Setup differs from its proof'}
$qaManifest=Join-Path $qaProof.download_directory 'transport-downloads.json'
if((Get-FileHash -LiteralPath $qaManifest -Algorithm SHA256).Hash.ToLower() -ne $qaProof.download_manifest_sha256){throw 'Download manifest differs from its build proof'}
$qaAddons=Join-Path $WowDirectory '_classic_beta_\Interface\AddOns'
$qaOld=Join-Path $qaAddons 'LoreForever_Voice_Female_Transport_999_0000000000'
$qaUnknown=Join-Path $qaAddons 'LoreForever_Voice_Female_Transport_999_1111111111'
$qaUnselected=Join-Path $qaAddons 'LoreForever_Voice_Default_deDE_Transport_999_0000000000'
if((Test-Path -LiteralPath $qaOld) -or (Test-Path -LiteralPath $qaUnselected) -or (Test-Path -LiteralPath $qaUnknown)){throw 'Preserve existing scratch markers'}
New-Item -ItemType Directory -Path $qaOld,$qaUnselected,$qaUnknown | Out-Null
'## Dependencies: LoreForever_Voice_Female'+[Environment]::NewLine+'## X-LoreForever-Transport-For: LoreForever_Voice_Female' | Set-Content -LiteralPath (Join-Path $qaOld 'LoreForever_Voice_Female_Transport_999_0000000000.toc')
'old selected shard' | Set-Content -LiteralPath (Join-Path $qaOld 'sentinel.txt')
'unselected shard' | Set-Content -LiteralPath (Join-Path $qaUnselected 'sentinel.txt')
$qaArgs=@('/QA','/VERYSILENT','/SUPPRESSMSGBOXES','/COMPONENTS=addon','/VOICES=female',('/DIR="'+$WowDirectory+'"'),('/VOICEURL='+$VoiceBase))
$qaRetry=Start-Process -FilePath $qaProof.setup -WindowStyle Hidden -PassThru -Wait -ArgumentList $qaArgs
if($qaRetry.ExitCode -ne 0){throw 'Generation refresh failed'}
if(Test-Path -LiteralPath $qaOld){throw 'Successful refresh left superseded selected shard'}
if(-not (Test-Path -LiteralPath $qaUnknown)){throw 'Cleanup removed an unrecognized folder'}
if(-not (Test-Path -LiteralPath $qaUnselected)){throw 'Selected-source cleanup removed another language'}
[ordered]@{status='passed';evidence_kind=$qaProof.evidence_kind;selected_old_shard_pruned=$true;unselected_language_shard_preserved=$true;unrecognized_folder_preserved=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $WowDirectory 'prune-report.json')
Get-Content -LiteralPath (Join-Path $WowDirectory 'prune-report.json')
