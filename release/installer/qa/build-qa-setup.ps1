param(
  [Parameter(Mandatory=$true)][string]$CandidateDirectory,
  [Parameter(Mandatory=$true)][string]$SourceCommit,
  [Parameter(Mandatory=$true)][string]$DownloadDirectory,
  [string]$SourceRepository='/home/manwe/git/lore-forever'
)
$ErrorActionPreference='Stop'
$qaRoot='C:\Users\Mike\LoreForeverQA'
$qaCompiler=Join-Path $qaRoot 'tools\inno6\ISCC.exe'
$qaCompanion=Join-Path $qaRoot 'companion-027d7ac47d25'
$qaReceipt=Get-Content -LiteralPath (Join-Path $CandidateDirectory 'receipt.json') -Raw | ConvertFrom-Json
if($qaReceipt.status -ne 'passed' -or $qaReceipt.commit -ne $SourceCommit -or $qaReceipt.version -ne '0.11.0'){
  throw 'Require the passing 0.11.0 candidate receipt for the exact source commit'
}
$qaManifestPath=Join-Path $DownloadDirectory 'transport-downloads.json'
$qaDownloadManifest=Get-Content -LiteralPath $qaManifestPath -Raw | ConvertFrom-Json
if($qaDownloadManifest.sourceCommit -ne $SourceCommit -or $qaDownloadManifest.releaseVersion -ne $qaReceipt.version -or $qaDownloadManifest.candidateZipSha256 -ne $qaReceipt.zip_sha256){
  throw 'Installer downloads are not bound to this exact final candidate'
}
$qaDownloadIss=Join-Path $DownloadDirectory 'installer-downloads.iss'
if(-not (Test-Path -LiteralPath $qaDownloadIss)){throw 'Missing verified installer download table'}
$qaZip=Join-Path $CandidateDirectory $qaReceipt.zip
if((Get-FileHash -LiteralPath $qaZip -Algorithm SHA256).Hash.ToLower() -ne $qaReceipt.zip_sha256){
  throw 'Candidate ZIP differs from its passing receipt'
}
$qaRun=Join-Path $qaRoot ('0.11-'+$SourceCommit.Substring(0,12))
if(Test-Path -LiteralPath $qaRun){throw "Preserve existing QA output: $qaRun"}
$qaRun=[IO.Path]::GetFullPath($qaRun)
if(-not $qaRun.StartsWith($qaRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'QA path escaped its scratch root'}
New-Item -ItemType Directory -Force -Path $qaRun,(Join-Path $qaRun 'source'),(Join-Path $qaRun 'stage') | Out-Null
$qaArchive=Join-Path $qaRun 'installer-source.tar'
$qaArchiveLinux='/mnt/c/'+$qaArchive.Substring(3).Replace('\','/')
& wsl.exe -d Ubuntu-24.04 -u manwe --cd $SourceRepository -- git archive --format=tar "--output=$qaArchiveLinux" $SourceCommit release/installer release/logo.ico
if($LASTEXITCODE){throw 'Exact installer source archive failed'}
& 'C:\Windows\System32\tar.exe' -xf $qaArchive -C (Join-Path $qaRun 'source')
if($LASTEXITCODE){throw 'Installer source extraction failed'}
& 'C:\Windows\System32\tar.exe' -xf $qaZip -C (Join-Path $qaRun 'stage')
if($LASTEXITCODE){throw 'Candidate ZIP extraction failed'}
$qaCompanionBuild=Get-Content -LiteralPath (Join-Path $qaCompanion 'build-source.json') -Raw | ConvertFrom-Json
& wsl.exe -d Ubuntu-24.04 -u manwe --cd $SourceRepository -- git diff --quiet $qaCompanionBuild.source_commit $SourceCommit -- companion data/pronunciation.json
if($LASTEXITCODE){throw 'Companion source changed since the scratch build; rebuild it from the final source first'}
$qaUninstallIss=Join-Path $DownloadDirectory 'installer-downloads-uninstall.iss'
$qaArgs=@(('/DDownloadUninstallIss='+$qaUninstallIss),('/DDownloadIss='+$qaDownloadIss),'/Q','/DAppVersion=0.11.0',"/DSourceDir=$(Join-Path $qaRun 'stage')", "/DOutputDir=$qaRun",
  "/DCompanionDir=$(Join-Path $qaCompanion 'dist\LoreForeverCompanion')",
  "/DCompanionIss=$(Join-Path $qaCompanion 'source\companion\packaging\companion.iss')",
  (Join-Path $qaRun 'source\release\installer\LoreForever.iss'))
& $qaCompiler @qaArgs 2>&1 | Tee-Object -FilePath (Join-Path $qaRun 'compile.log')
if($LASTEXITCODE){throw 'Setup compilation failed'}
$qaSetup=Join-Path $qaRun 'LoreForever-Setup.exe'
$qaProof=[ordered]@{evidence_kind='exact candidate isolated QA build';download_directory=$DownloadDirectory;download_manifest_sha256=(Get-FileHash -LiteralPath $qaManifestPath -Algorithm SHA256).Hash.ToLower();download_iss_sha256=(Get-FileHash -LiteralPath $qaDownloadIss -Algorithm SHA256).Hash.ToLower();version='0.11.0';source_commit=$SourceCommit;candidate_zip=$qaZip;
  candidate_zip_sha256=$qaReceipt.zip_sha256;setup=$qaSetup;
  setup_sha256=(Get-FileHash -LiteralPath $qaSetup -Algorithm SHA256).Hash.ToLower();
  setup_signed=$false;compiler_version='6.7.3';companion_source=$qaCompanionBuild.source_commit;
  companion_exe_sha256=$qaCompanionBuild.exe_sha256;status='built';built_at=(Get-Date).ToString('o')}
$qaProof | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $qaRun 'qa-build.json') -Encoding utf8
$qaProof | ConvertTo-Json
