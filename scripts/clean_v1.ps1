# Clean up DebateCompanion v1.0.0 completely from user's machine
$ErrorActionPreference = 'Continue'

Write-Host "=== 正在檢查並終止殘留行程 ==="
$procs = Get-Process -Name "DebateCompanion*", "DebateCompanionUpdater*" -ErrorAction SilentlyContinue
if ($procs) {
    foreach ($p in $procs) {
        Write-Host "正在終止行程: $($p.ProcessName) (PID: $($p.Id))"
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
} else {
    Write-Host "沒有發現執行中的行程。"
}

Write-Host "`n=== 正在清理捷徑 ==="
$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')

Get-ChildItem -Path $desktop -Filter "*模擬庭*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "刪除桌面捷徑: $($_.FullName)"
    Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
}
Get-ChildItem -Path $programs -Filter "*模擬庭*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "刪除開始功能表捷徑: $($_.FullName)"
    Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
}

Write-Host "`n=== 正在清理登錄檔 (Registry) ==="
$regUninstall = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DebateCompanion"
if (Test-Path $regUninstall) {
    Write-Host "移除登錄檔卸載項: $regUninstall"
    Remove-Item -Path $regUninstall -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "登錄檔卸載項不存在或已被移除。"
}

$regProtocol = "HKCU:\Software\Classes\debate-companion"
if (Test-Path $regProtocol) {
    Write-Host "移除通訊協定註冊: $regProtocol"
    Remove-Item -Path $regProtocol -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "通訊協定註冊不存在或已被移除。"
}

Write-Host "`n=== 正在清理本機安裝資料夾與快取 ==="
$localDir = "$env:LOCALAPPDATA\DebateCompanion"
if (Test-Path $localDir) {
    Write-Host "正在刪除安裝主目錄: $localDir"
    Remove-Item -Path $localDir -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $localDir) {
        # Retry with cmd rd in case of lock
        Start-Process -FilePath "cmd.exe" -ArgumentList "/C timeout 1 > nul & rd /s /q `"$localDir`"" -Wait -WindowStyle Hidden
    }
    if (-not (Test-Path $localDir)) {
        Write-Host "已成功移除: $localDir"
    } else {
        Write-Host "警告: $localDir 仍有部分被鎖定的檔案"
    }
} else {
    Write-Host "本機安裝目錄不存在: $localDir"
}

$roamingDir = "$env:APPDATA\DebateCompanion"
if (Test-Path $roamingDir) {
    Write-Host "正在刪除 Roaming 資料: $roamingDir"
    Remove-Item -Path $roamingDir -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path $roamingDir)) {
        Write-Host "已成功移除: $roamingDir"
    }
} else {
    Write-Host "Roaming 資料夾不存在: $roamingDir"
}

# Clean Temp
$tempZip = "$env:TEMP\debate-payload.zip"
if (Test-Path $tempZip) {
    Write-Host "刪除暫存檔: $tempZip"
    Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
}

Write-Host "`n=== 正在廣播 Windows Shell 重新整理 ==="
$code = @"
using System;
using System.Runtime.InteropServices;
public class ShellNotifier {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
    public static void Refresh() {
        SHChangeNotify(0x08000000, 0x0000, IntPtr.Zero, IntPtr.Zero);
    }
}
"@
try {
    Add-Type -TypeDefinition $code -Language CSharp
    [ShellNotifier]::Refresh()
    Write-Host "Windows Shell 與設定快取已成功發送重整信號！"
} catch {
    Write-Host "Shell 廣播通知跳過或已執行: $_"
}

Write-Host "`n=== 第一版殘留清理完成！ ==="
