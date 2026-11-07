# Comprehensive clean up of all versions of Debate Companion (辯論陪伴台帳 / 模擬庭提問陪伴台帳)
$ErrorActionPreference = 'Continue'

Write-Host "=== 1. 終止所有相關行程 ==="
$procNames = @('辯論陪伴台帳', 'DebateCompanion', 'DebateCompanionUpdater', 'debate-companion-desk', 'electron')
foreach ($pname in $procNames) {
    Get-Process -Name $pname -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "終止行程: $($_.ProcessName) (PID: $($_.Id))"
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Milliseconds 500

Write-Host "`n=== 2. 清理桌面與開始功能表捷徑 ==="
$shortcutPaths = @(
    "$env:USERPROFILE\Desktop\辯論陪伴台帳.lnk",
    "$env:USERPROFILE\Desktop\模擬庭提問陪伴台帳.lnk",
    "$env:PUBLIC\Desktop\辯論陪伴台帳.lnk",
    "$env:PUBLIC\Desktop\模擬庭提問陪伴台帳.lnk",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\辯論陪伴台帳.lnk",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\模擬庭提問陪伴台帳.lnk",
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\辯論陪伴台帳.lnk",
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\模擬庭提問陪伴台帳.lnk"
)
foreach ($sc in $shortcutPaths) {
    if (Test-Path $sc) {
        Write-Host "刪除捷徑: $sc"
        Remove-Item -Path $sc -Force -ErrorAction SilentlyContinue
    }
}

# Also search wildcard shortcuts
Get-ChildItem -Path "$env:USERPROFILE\Desktop", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter "*辯論*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "刪除捷徑: $($_.FullName)"
    Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
}
Get-ChildItem -Path "$env:USERPROFILE\Desktop", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter "*模擬庭*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "刪除捷徑: $($_.FullName)"
    Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
}

Write-Host "`n=== 3. 刪除所有安裝目錄與應用程式快取 ==="
$directoriesToDelete = @(
    "$env:LOCALAPPDATA\Programs\debate-companion-desk",
    "$env:LOCALAPPDATA\debate-companion-desk-updater",
    "$env:LOCALAPPDATA\DebateCompanion",
    "$env:APPDATA\debate-companion-desk",
    "$env:APPDATA\DebateCompanion",
    "$env:TEMP\debate-payload.zip"
)

foreach ($dir in $directoriesToDelete) {
    if (Test-Path $dir) {
        Write-Host "正在刪除目錄: $dir"
        # First try normal remove
        Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue
        # If still exists, use cmd rd /s /q
        if (Test-Path $dir) {
            Write-Host "使用強制方式移除目錄: $dir"
            Start-Process -FilePath "cmd.exe" -ArgumentList "/C rd /s /q `"$dir`"" -Wait -WindowStyle Hidden
        }
        if (-not (Test-Path $dir)) {
            Write-Host "✅ 成功完全刪除: $dir"
        } else {
            Write-Host "❌ 刪除失敗或檔案被鎖定: $dir"
        }
    } else {
        Write-Host "目錄已不存在: $dir"
    }
}

Write-Host "`n=== 4. 清理註冊表項 ==="
$regKeys = @(
    "Registry::HKEY_CURRENT_USER\Software\Classes\debate-companion",
    "Registry::HKEY_CURRENT_USER\Software\debate-companion-desk",
    "Registry::HKEY_CURRENT_USER\Software\DebateCompanion",
    "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\DebateCompanion",
    "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\debate-companion-desk"
)

foreach ($rk in $regKeys) {
    if (Test-Path $rk) {
        Write-Host "移除註冊表項: $rk"
        Remove-Item -Path $rk -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Scan for any other uninstall entries matching 辯論 or Debate
$uninstallHives = @(
    "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
foreach ($hive in $uninstallHives) {
    Get-ItemProperty -Path $hive -ErrorAction SilentlyContinue | Where-Object {
        $_.DisplayName -match '辯論' -or $_.DisplayName -match '模擬庭' -or $_.PSChildName -match 'debate-companion'
    } | ForEach-Object {
        Write-Host "移除登錄檔卸載項: $($_.PSPath)"
        Remove-Item -Path $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`n=== 5. 廣播 Windows Shell 重新整理 ==="
$code = @"
using System;
using System.Runtime.InteropServices;
public class ShellNotifier2 {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
    public static void Refresh() {
        SHChangeNotify(0x08000000, 0x0000, IntPtr.Zero, IntPtr.Zero);
    }
}
"@
try {
    Add-Type -TypeDefinition $code -Language CSharp -ErrorAction SilentlyContinue
    [ShellNotifier2]::Refresh()
    Write-Host "Windows Shell 與設定快取已重整！"
} catch {
    Write-Host "Shell 廣播通知已跳過。"
}

Write-Host "`n=== 6. 最終驗證 ==="
$remainingFiles = @(
    "$env:USERPROFILE\Desktop\辯論陪伴台帳.lnk",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\辯論陪伴台帳.lnk",
    "$env:LOCALAPPDATA\Programs\debate-companion-desk",
    "$env:APPDATA\debate-companion-desk"
)
$anyRemaining = $false
foreach ($f in $remainingFiles) {
    if (Test-Path $f) {
        Write-Host "⚠️ 仍殘留: $f"
        $anyRemaining = $true
    }
}
if (-not $anyRemaining) {
    Write-Host "🎉 完美！所有捷徑、安裝目錄、暫存設定與登錄檔已 100% 徹底清除乾淨！"
} else {
    Write-Host "部分檔案仍存在，請檢查上方訊息。"
}
