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
    $Flavor = '_classic_beta_'

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
        Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        $src = Join-Path $tmp 'LoreForever'
        if (-not (Test-Path (Join-Path $src 'LoreForever.toc'))) { throw 'The download looks broken (no LoreForever.toc).' }

        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        # Copy file by file: while WoW is running it can hold a narration file open, and one locked file
        # shouldn't stop the rest of the update.
        $locked = 0
        Get-ChildItem $src -Recurse -File | ForEach-Object {
            $target = Join-Path $dest $_.FullName.Substring($src.Length + 1)
            New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
            try { Copy-Item $_.FullName $target -Force } catch { $locked++ }
        }
        # Remove files an older version had that this one doesn't.
        Get-ChildItem $dest -Recurse -File | ForEach-Object {
            if (-not (Test-Path (Join-Path $src $_.FullName.Substring($dest.Length + 1)))) {
                Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
            }
        }
        $version = (Select-String -Path (Join-Path $dest 'LoreForever.toc') -Pattern '^## Version:\s*(.+)$').Matches[0].Groups[1].Value
        Write-Host ''
        Write-Host "Lore Forever $version is installed." -ForegroundColor Green
        if ($locked) { Write-Host "$locked file(s) were in use by the game. Close WoW and run this again to finish." -ForegroundColor Yellow }
        Write-Host 'Restart WoW (or type /reload in game). Pick a key when it asks, or type /lore.'
        Write-Host "If it doesn't show up: on the character screen click AddOns and tick 'Load out of date AddOns'."
    } catch {
        Write-Host "Install failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host 'You can install by hand instead: https://github.com/mliudev/LoreForever#install'
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
