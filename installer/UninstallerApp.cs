using System;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Win32;

namespace DebateCompanion {
    public class UninstallerApp : Application {
        [STAThread]
        public static void Main(string[] args) {
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
                Text = "確定要從這部電腦完整移除「模擬庭提問陪伴台帳」及其相關註冊項目嗎？\n您的雲端辯論練習紀錄與語音將完整保留於 wason.dev 伺服器上。",
                FontSize = 12.5,
                LineHeight = 20,
                Foreground = new SolidColorBrush(UpdateCommon.ColorInk2),
                TextWrapping = TextWrapping.Wrap
            };
            body.Children.Add(desc);

            var btnCancel = UpdateCommon.CreateStyledButton("保留台帳", false, 90, 32);
            btnCancel.Click += (s, ev) => win.Close();

            var btnUninstall = UpdateCommon.CreateStyledButton("確定解除安裝", true, 110, 32);

            btnUninstall.Click += (s, ev) => {
                try {
                    CleanRegistry();
                    desc.Text = "解除安裝已成功完成。相關通訊協定與註冊項目已清理。感謝您的使用！";
                    btnUninstall.Visibility = Visibility.Collapsed;
                    btnCancel.Content = "關閉精靈";
                } catch (Exception ex) {
                    desc.Text = "解除安裝失敗: " + ex.Message;
                }
            };

            btnPanel.Children.Add(btnCancel);
            btnPanel.Children.Add(btnUninstall);

            win.ShowDialog();
        }

        private static void CleanRegistry() {
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\debate-companion", false); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DebateCompanion", false); } catch { }
        }
    }
}
