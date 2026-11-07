using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Win32;

namespace DebateCompanion {
    public class InstallerApp : Application {
        [STAThread]
        public static void Main(string[] args) {
            new InstallerApp().Run();
        }

        protected override void OnStartup(StartupEventArgs e) {
            base.OnStartup(e);

            StackPanel body;
            StackPanel btnPanel;
            var win = UpdateCommon.CreateWindowShell("模擬庭提問陪伴台帳 · 安裝精靈", 520, 340, out body, out btnPanel);

            var title = new TextBlock {
                Text = "安裝 模擬庭提問陪伴台帳",
                FontSize = 16,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(UpdateCommon.ColorInk),
                Margin = new Thickness(0, 0, 0, 8)
            };
            body.Children.Add(title);

            var desc = new TextBlock {
                Text = "即將安裝陪伴辯士練習之研究員提問助手與智慧計時系統至您的電腦。\n將自動建立桌面捷徑與 Windows 快速通訊協定 (debate-companion://)，並支援與 wason.dev 網站即時雲端雙向同步。",
                FontSize = 12.5,
                LineHeight = 20,
                Foreground = new SolidColorBrush(UpdateCommon.ColorInk2),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 14)
            };
            body.Children.Add(desc);

            var progress = new ProgressBar {
                Height = 8,
                IsIndeterminate = false,
                Value = 0,
                Maximum = 100,
                Visibility = Visibility.Collapsed,
                Margin = new Thickness(0, 0, 0, 10),
                Foreground = new SolidColorBrush(UpdateCommon.ColorShu),
                Background = new SolidColorBrush(UpdateCommon.ColorPaper3),
                BorderBrush = new SolidColorBrush(UpdateCommon.ColorRule),
                BorderThickness = new Thickness(1)
            };
            body.Children.Add(progress);

            var status = new TextBlock {
                Text = "準備就緒，請點擊下方「開始安裝」按鈕。",
                FontSize = 11.5,
                Foreground = new SolidColorBrush(UpdateCommon.ColorInk3)
            };
            body.Children.Add(status);

            // Buttons
            var btnCancel = UpdateCommon.CreateStyledButton("取消", false, 80, 32);
            btnCancel.Click += (s, ev) => win.Close();

            var btnInstall = UpdateCommon.CreateStyledButton("開始安裝", true, 110, 32);

            btnInstall.Click += (s, ev) => {
                btnInstall.IsEnabled = false;
                btnCancel.IsEnabled = false;
                progress.Visibility = Visibility.Visible;
                progress.IsIndeterminate = true;
                status.Text = "正在解壓縮應用程式與註冊系統元件...";

                try {
                    InstallPayload();
                    status.Text = "安裝成功完成！捷徑與協定已就緒。";
                    progress.IsIndeterminate = false;
                    progress.Value = 100;
                    btnInstall.Content = "啟動陪伴台帳";
                    btnInstall.IsEnabled = true;
                    btnInstall.Click -= null;
                    btnInstall.Click += (s2, ev2) => {
                        LaunchInstalledApp();
                        win.Close();
                    };
                } catch (Exception ex) {
                    status.Text = "安裝過程發生錯誤: " + ex.Message;
                    btnCancel.IsEnabled = true;
                }
            };

            btnPanel.Children.Add(btnCancel);
            btnPanel.Children.Add(btnInstall);

            win.ShowDialog();
        }

        private static string GetInstallDir() {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string dir = Path.Combine(local, "DebateCompanion");
            Directory.CreateDirectory(dir);
            return dir;
        }

        private static void InstallPayload() {
            string installDir = GetInstallDir();
            var asm = Assembly.GetExecutingAssembly();

            // Extract embedded app-payload.zip if present
            using (var s = asm.GetManifestResourceStream("app-payload.zip")) {
                if (s != null) {
                    string zipTmp = Path.Combine(Path.GetTempPath(), "debate-payload.zip");
                    using (var fs = File.Create(zipTmp)) {
                        s.CopyTo(fs);
                    }
                    ZipFile.ExtractToDirectory(zipTmp, installDir);
                    try { File.Delete(zipTmp); } catch { }
                }
            }

            // Extract uninstaller
            using (var s = asm.GetManifestResourceStream("uninstall.exe")) {
                if (s != null) {
                    string uPath = Path.Combine(installDir, "uninstall.exe");
                    using (var fs = File.Create(uPath)) {
                        s.CopyTo(fs);
                    }
                }
            }

            // Extract updater
            using (var s = asm.GetManifestResourceStream("DebateCompanionUpdater.exe")) {
                if (s != null) {
                    string upPath = Path.Combine(installDir, "DebateCompanionUpdater.exe");
                    using (var fs = File.Create(upPath)) {
                        s.CopyTo(fs);
                    }
                }
            }

            // Create Desktop and Start Menu shortcuts
            string exePath = GetMainExePath(installDir);
            try {
                string desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                UpdateCommon.CreateShortcut(Path.Combine(desktopDir, "模擬庭提問陪伴台帳.lnk"), exePath, installDir, "模擬庭提問陪伴台帳");
                string startDir = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                UpdateCommon.CreateShortcut(Path.Combine(startDir, "模擬庭提問陪伴台帳.lnk"), exePath, installDir, "模擬庭提問陪伴台帳");
            } catch { }

            // Register debate-companion:// Protocol
            RegisterProtocol(installDir);

            // Register Windows Add/Remove programs entry
            RegisterUninstall(installDir);
        }

        private static string GetMainExePath(string installDir) {
            string p1 = Path.Combine(installDir, "辯論陪伴台帳.exe");
            if (File.Exists(p1)) return p1;
            string p2 = Path.Combine(installDir, "DebateCompanion.exe");
            if (File.Exists(p2)) return p2;
            try {
                foreach (var f in Directory.GetFiles(installDir, "*.exe")) {
                    string n = Path.GetFileName(f).ToLowerInvariant();
                    if (!n.Contains("setup") && !n.Contains("uninstall") && !n.Contains("updater")) {
                        return f;
                    }
                }
            } catch { }
            return p1;
        }

        private static void RegisterProtocol(string installDir) {
            try {
                string exePath = GetMainExePath(installDir);
                using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\debate-companion")) {
                    key.SetValue("", "URL:Debate Companion Protocol");
                    key.SetValue("URL Protocol", "");
                    using (var cmd = key.CreateSubKey(@"shell\open\command")) {
                        cmd.SetValue("", "\"" + exePath + "\" \"%1\"");
                    }
                }
            } catch { }
        }

        private static void RegisterUninstall(string installDir) {
            try {
                string exePath = GetMainExePath(installDir);
                string uninstPath = Path.Combine(installDir, "uninstall.exe");

                long totalBytes = 0;
                try {
                    var di = new DirectoryInfo(installDir);
                    foreach (var f in di.EnumerateFiles("*", SearchOption.AllDirectories)) {
                        totalBytes += f.Length;
                    }
                } catch { }
                int sizeKb = (int)(totalBytes / 1024);
                if (sizeKb <= 0) sizeKb = 150000;

                using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DebateCompanion")) {
                    key.SetValue("DisplayName", "模擬庭提問陪伴台帳");
                    key.SetValue("DisplayVersion", BuildInfo.Version);
                    key.SetValue("Publisher", "wasonisgood");
                    key.SetValue("InstallLocation", installDir);
                    key.SetValue("UninstallString", "\"" + uninstPath + "\"");
                    key.SetValue("QuietUninstallString", "\"" + uninstPath + "\" --silent");
                    key.SetValue("DisplayIcon", exePath + ",0");
                    key.SetValue("EstimatedSize", sizeKb, RegistryValueKind.DWord);
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    key.SetValue("WindowsInstaller", 0, RegistryValueKind.DWord);
                    key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                    key.SetValue("HelpLink", "https://wason.dev");
                    key.SetValue("URLInfoAbout", "https://wason.dev");
                    key.SetValue("URLUpdateInfo", "https://github.com/wasonisgood/debate-companion-desk/releases");
                }
                UpdateCommon.NotifyShell();
            } catch { }
        }

        private static void LaunchInstalledApp() {
            string exePath = GetMainExePath(GetInstallDir());
            if (File.Exists(exePath)) {
                System.Diagnostics.Process.Start(exePath);
            }
        }
    }
}
