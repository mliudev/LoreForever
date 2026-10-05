# Lore Forever installer for Windows.
# Run in PowerShell:   irm https://loreforeverwow.com/install.ps1 | iex
# Finds your World of Warcraft folder, downloads the latest Lore Forever release from GitHub and puts it in
# _classic_beta_\Interface\AddOns (the WoW Forever beta). Run it again any time to update.
# Source: https://github.com/mliudev/LoreForever

# Everything runs in its own scope so nothing leaks into the PowerShell window it was pasted into.
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads far slower in Windows PowerShell
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $ZipUrl = 'https://github.com/mliudev/LoreForever/releases/latest/download/LoreForever.zip'
    $SumsUrl = $ZipUrl -replace '[^/]+$', 'SHA256SUMS.txt'   # the release's checksums, published next to the zip
    $Flavor = '_classic_beta_'

    # The zip's SHA-256 from the release's SHA256SUMS.txt (sha256sum's format), or $null when the release has none.
    function Get-ZipSha256 {
        try { $sums = (Invoke-WebRequest -Uri $SumsUrl -UseBasicParsing).Content } catch { return $null }
        if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }   # served as a binary download
        foreach ($line in ($sums -split "`n")) {
            if ($line -match '^([0-9a-fA-F]{64}) [ *]LoreForever\.zip\s*$') { return $Matches[1] }
        }
        return $null
    }

    function Find-WoW {
        if ($env:LOREFOREVER_WOW) { return $env:LOREFOREVER_WOW }
        # Battle.net registers the game's root folder as an uninstall entry.
        $keys = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
                'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
                'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
        foreach ($k in $keys) {
            foreach ($e in (Get-ItemProperty $k -ErrorAction SilentlyContinue)) {
                if ($e.DisplayName -eq 'World of Warcraft' -and $e.InstallLocation -and
                    (Test-Path (Join-Path $e.InstallLocation $Flavor))) { return $e.InstallLocation }
            }
        }
        # Otherwise try the usual places on every drive.
        $rel = 'Program Files (x86)\World of Warcraft', 'Program Files\World of Warcraft', 'World of Warcraft',
               'Games\World of Warcraft', 'Battle.net\World of Warcraft', 'BattleNet\World of Warcraft',
               'Blizzard\World of Warcraft', 'Games\Battle.net\World of Warcraft'
        foreach ($d in (Get-PSDrive -PSProvider FileSystem)) {
            foreach ($r in $rel) {
                $p = Join-Path $d.Root $r
                if (Test-Path (Join-Path $p $Flavor)) { return $p }
            }
        }
        return $null
    }

    Write-Host ''
    Write-Host 'Lore Forever installer' -ForegroundColor Yellow
    $wow = Find-WoW
    while (-not $wow -or -not (Test-Path (Join-Path $wow $Flavor))) {
        if ($wow) { Write-Host "No $Flavor folder in $wow (is WoW Forever installed there?)" -ForegroundColor Red }
        else { Write-Host "Couldn't find World of Warcraft with the Forever beta ($Flavor) installed." -ForegroundColor Red }
        $wow = (Read-Host 'Paste your World of Warcraft folder (for example C:\Program Files (x86)\World of Warcraft), or press Enter to quit').Trim('" ')
        if (-not $wow) { return }
    }

    $addons = Join-Path $wow "$Flavor\Interface\AddOns"
    $dest = Join-Path $addons 'LoreForever'
    Write-Host "Installing into $addons"

    $tmp = Join-Path $env:TEMP ('LoreForever-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        $zip = Join-Path $tmp 'LoreForever.zip'
        Write-Host 'Downloading the latest version (about 50 MB)...'
        $want = Get-ZipSha256
        Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing
        $got = (Get-FileHash -Path $zip -Algorithm SHA256).Hash
        # A release published between the two downloads comes with new checksums: read them once more.
        if ($want -and $got -ne $want) { $again = Get-ZipSha256; if ($again) { $want = $again } }
        if (-not $want) {
            Write-Host "Couldn't check the download: this release has no checksum file. Installing anyway." -ForegroundColor Yellow
        } elseif ($got -ne $want) {
            throw "The download is damaged: its checksum doesn't match the release's. Nothing was changed; run this again."
        }
        $unpacked = Join-Path $tmp 'zip'
        Expand-Archive -Path $zip -DestinationPath $unpacked -Force
        if (-not (Test-Path (Join-Path $unpacked 'LoreForever\LoreForever.toc'))) { throw 'The download looks broken (no LoreForever.toc).' }
        # The zip holds one folder per add-on: LoreForever, plus the voice and language packs that ship with it
        # (LoreForever_Voice_Default, and LoreForever_Lang_<locale> once any ship). Older zips hold LoreForever alone.
        $folders = @(Get-ChildItem $unpacked -Directory | Where-Object {
            $_.Name -match '^LoreForever(_(Voice|Lang)_\w+)?$' -and (Test-Path (Join-Path $_.FullName "$($_.Name).toc"))
        })

        $locked = 0
        foreach ($folder in $folders) {
            $src = $folder.FullName
            $target = Join-Path $addons $folder.Name
            New-Item -ItemType Directory -Path $target -Force | Out-Null
            # Copy file by file: while WoW is running it can hold a narration file open, and one locked file
            # shouldn't stop the rest of the update.
            Get-ChildItem $src -Recurse -File | ForEach-Object {
                $to = Join-Path $target $_.FullName.Substring($src.Length + 1)
                New-Item -ItemType Directory -Path (Split-Path $to) -Force | Out-Null
                try { Copy-Item $_.FullName $to -Force } catch { $locked++ }
            }
            # Remove files an older version had that this one doesn't.
            Get-ChildItem $target -Recurse -File | ForEach-Object {
                if (-not (Test-Path (Join-Path $src $_.FullName.Substring($target.Length + 1)))) {
                    Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
                }
            }
        }
        # Narration used to live in LoreForever\Audio; newer versions keep it in the voice pack.
        $oldAudio = Join-Path $dest 'Audio'
        if ((Test-Path $oldAudio) -and -not (Test-Path (Join-Path $unpacked 'LoreForever\Audio'))) {
            Remove-Item $oldAudio -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path $oldAudio) { $locked++ }
        }
        $version = (Select-String -Path (Join-Path $dest 'LoreForever.toc') -Pattern '^## Version:\s*(.+)$').Matches[0].Groups[1].Value
        Write-Host ''
        Write-Host "Lore Forever $version is installed." -ForegroundColor Green
        if ($locked) { Write-Host "$locked file(s) were in use by the game. Close WoW and run this again to finish." -ForegroundColor Yellow }
        Write-Host 'Start WoW (or type /reload if it is running), then pick a key when it asks, or type /lore.'
        Write-Host "If it doesn't show up: on the character screen click AddOns and tick 'Load out of date AddOns'."
    } catch {
        Write-Host "Install failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host 'You can install by hand instead: https://github.com/mliudev/LoreForever#install'
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
