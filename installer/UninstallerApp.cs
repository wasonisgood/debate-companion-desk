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

            var win = new Window {
                Title = "模擬庭提問陪伴台帳 · 解除安裝",
                Width = 480,
                Height = 260,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Background = new SolidColorBrush(Color.FromRgb(0xF1, 0xEC, 0xE2)),
                ResizeMode = ResizeMode.NoResize
            };

            var root = new Grid { Margin = new Thickness(24) };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var title = new TextBlock {
                Text = "解除安裝 模擬庭提問陪伴台帳",
                FontSize = 16,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(Color.FromRgb(0x1D, 0x1B, 0x17))
            };
            Grid.SetRow(title, 0);
            root.Children.Add(title);

            var desc = new TextBlock {
                Text = "確定要從這部電腦完整移除「模擬庭提問陪伴台帳」及其相關註冊項目嗎？\n您的雲端辯論練習紀錄與語音將完整保留於伺服器上。",
                FontSize = 12,
                LineHeight = 20,
                Foreground = new SolidColorBrush(Color.FromRgb(0x4C, 0x48, 0x40)),
                TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center
            };
            Grid.SetRow(desc, 1);
            root.Children.Add(desc);

            var btnPanel = new StackPanel {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right
            };

            var btnCancel = new Button {
                Content = "保留台帳",
                Width = 90,
                Height = 32,
                Margin = new Thickness(0, 0, 8, 0),
                Background = new SolidColorBrush(Color.FromRgb(0xE7, 0xE0, 0xD2))
            };
            btnCancel.Click += (s, ev) => win.Close();

            var btnUninstall = new Button {
                Content = "確定解除安裝",
                Width = 110,
                Height = 32,
                Background = new SolidColorBrush(Color.FromRgb(0xB9, 0x47, 0x2B)),
                Foreground = Brushes.White,
                FontWeight = FontWeights.Bold
            };

            btnUninstall.Click += (s, ev) => {
                try {
                    CleanRegistry();
                    desc.Text = "解除安裝已完成。感謝您的使用！";
                    btnUninstall.Visibility = Visibility.Collapsed;
                    btnCancel.Content = "關閉精靈";
                } catch (Exception ex) {
                    desc.Text = "解除安裝失敗: " + ex.Message;
                }
            };

            btnPanel.Children.Add(btnCancel);
            btnPanel.Children.Add(btnUninstall);
            Grid.SetRow(btnPanel, 2);
            root.Children.Add(btnPanel);

            win.Content = root;
            win.ShowDialog();
        }

        private static void CleanRegistry() {
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\debate-companion", false); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DebateCompanion", false); } catch { }
        }
    }
}
