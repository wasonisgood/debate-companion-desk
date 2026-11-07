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

            var win = new Window {
                Title = "模擬庭提問陪伴台帳 · 安裝精靈",
                Width = 520,
                Height = 360,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Background = new SolidColorBrush(Color.FromRgb(0xF1, 0xEC, 0xE2)),
                ResizeMode = ResizeMode.NoResize
            };

            var root = new Grid { Margin = new Thickness(24) };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            // Title
            var title = new TextBlock {
                Text = "模擬庭提問陪伴台帳 安裝程式",
                FontSize = 18,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(Color.FromRgb(0x1D, 0x1B, 0x17)),
                Margin = new Thickness(0, 0, 0, 12)
            };
            Grid.SetRow(title, 0);
            root.Children.Add(title);

            // Body
            var body = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            var desc = new TextBlock {
                Text = "即將安裝陪伴辯士練習之研究員提問助手與智慧計時系統至您的電腦。\n將自動建立桌面捷徑與 Windows 快速通訊協定 (debate-companion://)。",
                FontSize = 13,
                LineHeight = 22,
                Foreground = new SolidColorBrush(Color.FromRgb(0x4C, 0x48, 0x40)),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 16)
            };
            body.Children.Add(desc);

            var progress = new ProgressBar {
                Height = 8,
                IsIndeterminate = false,
                Value = 0,
                Maximum = 100,
                Visibility = Visibility.Collapsed,
                Margin = new Thickness(0, 0, 0, 12)
            };
            body.Children.Add(progress);

            var status = new TextBlock {
                Text = "準備就緒，請點擊下方「開始安裝」按鈕。",
                FontSize = 12,
                Foreground = new SolidColorBrush(Color.FromRgb(0x85, 0x7F, 0x73))
            };
            body.Children.Add(status);

            Grid.SetRow(body, 1);
            root.Children.Add(body);

            // Buttons
            var btnPanel = new StackPanel {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right
            };
            var btnCancel = new Button {
                Content = "取消",
                Width = 90,
                Height = 34,
                Margin = new Thickness(0, 0, 8, 0),
                Background = new SolidColorBrush(Color.FromRgb(0xE7, 0xE0, 0xD2))
            };
            btnCancel.Click += (s, ev) => win.Close();

            var btnInstall = new Button {
                Content = "開始安裝",
                Width = 110,
                Height = 34,
                Background = new SolidColorBrush(Color.FromRgb(0xB9, 0x47, 0x2B)),
                Foreground = Brushes.White,
                FontWeight = FontWeights.Bold
            };

            btnInstall.Click += (s, ev) => {
                btnInstall.IsEnabled = false;
                btnCancel.IsEnabled = false;
                progress.Visibility = Visibility.Visible;
                progress.IsIndeterminate = true;
                status.Text = "正在解壓縮應用程式與註冊系統元件...";

                try {
                    InstallPayload();
                    status.Text = "安裝成功完成！";
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
            Grid.SetRow(btnPanel, 2);
            root.Children.Add(btnPanel);

            win.Content = root;
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

            // Register debate-companion:// Protocol
            RegisterProtocol(installDir);

            // Register Windows Add/Remove programs entry
            RegisterUninstall(installDir);
        }

        private static void RegisterProtocol(string installDir) {
            try {
                string exePath = Path.Combine(installDir, "DebateCompanion.exe");
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
                using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DebateCompanion")) {
                    key.SetValue("DisplayName", "模擬庭提問陪伴台帳");
                    key.SetValue("DisplayVersion", BuildInfo.Version);
                    key.SetValue("Publisher", "wasonisgood");
                    key.SetValue("InstallLocation", installDir);
                    key.SetValue("UninstallString", "\"" + Path.Combine(installDir, "uninstall.exe") + "\"");
                }
            } catch { }
        }

        private static void LaunchInstalledApp() {
            string exePath = Path.Combine(GetInstallDir(), "DebateCompanion.exe");
            if (File.Exists(exePath)) {
                System.Diagnostics.Process.Start(exePath);
            }
        }
    }
}
