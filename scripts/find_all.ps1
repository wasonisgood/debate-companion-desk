$ErrorActionPreference = 'SilentlyContinue'

Write-Host "=== 1. SEARCHING ALL UNINSTALL REGISTRY KEYS ==="
$regPaths = @(
    "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

foreach ($rp in $regPaths) {
    Get-ItemProperty -Path $rp | Where-Object {
        $name = "$($_.DisplayName) $($_.Publisher) $($_.PSChildName)"
        $name -match '模擬' -or $name -match '辯論' -or $name -match 'Debate' -or $name -match 'wason'
    } | ForEach-Object {
        [PSCustomObject]@{
            DisplayName     = $_.DisplayName
            DisplayVersion  = $_.DisplayVersion
            Publisher       = $_.Publisher
            InstallLocation = $_.InstallLocation
            UninstallString = $_.UninstallString
            RegistryKey     = $_.PSPath
        }
    } | Format-List
}

Write-Host "`n=== 2. SEARCHING APPX PACKAGES ==="
Get-AppxPackage -AllUsers | Where-Object { $_.Name -match 'Debate' -or $_.Name -match '辯論' } | Select-Object Name, PackageFullName

Write-Host "`n=== 3. SEARCHING SHORTCUTS (START MENU & DESKTOP) ==="
$shortcutDirs = @(
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
    "$env:USERPROFILE\Desktop",
    "$env:PUBLIC\Desktop"
)
foreach ($dir in $shortcutDirs) {
    if (Test-Path $dir) {
        Get-ChildItem -Path $dir -Recurse | Where-Object {
            $_.Name -match '模擬' -or $_.Name -match '辯論' -or $_.Name -match 'Debate'
        } | Select-Object FullName
    }
}

Write-Host "`n=== 4. SEARCHING SYSTEM FOLDERS ==="
$sysDirs = @(
    "$env:LOCALAPPDATA\Programs",
    "$env:LOCALAPPDATA",
    "$env:APPDATA",
    "C:\Program Files",
    "C:\Program Files (x86)"
)
foreach ($dir in $sysDirs) {
    if (Test-Path $dir) {
        Get-ChildItem -Path $dir -Directory | Where-Object {
            $_.Name -match 'Debate' -or $_.Name -match '模擬' -or $_.Name -match '辯論'
        } | Select-Object FullName
    }
}

Write-Host "`n=== 5. SEARCHING RUNNING PROCESSES ==="
Get-Process | Where-Object { $_.ProcessName -match 'Debate' -or $_.MainWindowTitle -match '辯論|模擬庭' } | Select-Object Id, ProcessName, MainWindowTitle, Path
