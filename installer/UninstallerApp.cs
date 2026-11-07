using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Win32;

namespace DebateCompanion {
    public class UninstallerApp : Application {
        [STAThread]
        public static void Main(string[] args) {
            bool silent = false;
            if (args != null) {
                foreach (var a in args) {
                    if (string.Equals(a, "--silent", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(a, "/silent", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(a, "/quiet", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(a, "-s", StringComparison.OrdinalIgnoreCase)) {
                        silent = true;
                        break;
                    }
                }
            }

            if (silent) {
                ExecuteUninstall();
                return;
            }

            new UninstallerApp().Run();
        }

        protected override void OnStartup(StartupEventArgs e) {
            base.OnStartup(e);

            StackPanel body;
            StackPanel btnPanel;
            var win = UpdateCommon.CreateWindowShell("模擬庭提問陪伴台帳 · 解除安裝", 480, 260, out body, out btnPanel);

            var title = new TextBlock {
                Text = "解除安裝 模擬庭提問陪伴台帳",
                FontSize = 15,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(UpdateCommon.ColorInk),
                Margin = new Thickness(0, 0, 0, 8)
            };
            body.Children.Add(title);

            var desc = new TextBlock {
                Text = "確定要從這部電腦完整移除「模擬庭提問陪伴台帳」及其相關檔案與捷徑嗎？\n您的雲端辯論練習紀錄將安全保留於 wason.dev 伺服器上。",
                FontSize = 12.5,
                LineHeight = 20,
                Foreground = new SolidColorBrush(UpdateCommon.ColorInk2),
                TextWrapping = TextWrapping.Wrap
            };
            body.Children.Add(desc);

            var btnCancel = UpdateCommon.CreateStyledButton("保留台帳", false, 90, 32);
            btnCancel.Click += (s, ev) => win.Close();

            var btnUninstall = UpdateCommon.CreateStyledButton("確定解除安裝", true, 110, 32);

            btnUninstall.Click += async (s, ev) => {
                btnUninstall.IsEnabled = false;
                btnCancel.IsEnabled = false;
                desc.Text = "正在關閉執行中程式、清除註冊表與捷徑，並清理系統檔案...";

                try {
                    await Task.Run(() => ExecuteUninstall());
                    desc.Text = "模擬庭提問陪伴台帳已完全解除安裝！\n捷徑與本機暫存已清理完畢。感謝您的使用！";
                    btnUninstall.Visibility = Visibility.Collapsed;
                    btnCancel.Content = "完成並退出";
                    btnCancel.IsEnabled = true;
                    btnCancel.Click -= null;
                    btnCancel.Click += (s2, ev2) => win.Close();
                } catch (Exception ex) {
                    desc.Text = "解除安裝過程發生問題: " + ex.Message;
                    btnCancel.IsEnabled = true;
                }
            };

            btnPanel.Children.Add(btnCancel);
            btnPanel.Children.Add(btnUninstall);

            win.ShowDialog();
        }

        private static void ExecuteUninstall() {
            // 1. Terminate running instances
            UpdateCommon.KillProcesses("DebateCompanion", "DebateCompanionUpdater");

            // 2. Remove desktop and start menu shortcuts
            try {
                string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "模擬庭提問陪伴台帳.lnk");
                if (File.Exists(desktopLnk)) File.Delete(desktopLnk);
            } catch { }

            try {
                string startLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "模擬庭提問陪伴台帳.lnk");
                if (File.Exists(startLnk)) File.Delete(startLnk);
            } catch { }

            // 3. Remove Registry entries
            CleanRegistry();

            // 4. Notify Windows Shell
            UpdateCommon.NotifyShell();

            // 5. Schedule directory deletion for the install folder
            try {
                string installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
                UpdateCommon.ScheduleDirectoryDeletion(installDir);
            } catch { }
        }

        private static void CleanRegistry() {
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\debate-companion", false); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DebateCompanion", false); } catch { }
        }
    }
}
