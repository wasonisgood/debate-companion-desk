using System;
using System.IO;
using System.Net;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace DebateCompanion {
    public class UpdaterApp : Application {
        [STAThread]
        public static void Main(string[] args) {
            new UpdaterApp().Run();
        }

        protected override void OnStartup(StartupEventArgs e) {
            base.OnStartup(e);

            var manifest = UpdateCommon.FetchManifest(5000);
            if (manifest == null || !UpdateCommon.IsNewer(manifest.Version, UpdateCommon.CurrentBuildVersion)) {
                MessageBox.Show("目前已是最新版本 (" + UpdateCommon.CurrentBuildVersion + ")。", "陪伴台帳更新檢查", MessageBoxButton.OK, MessageBoxImage.Information);
                Shutdown();
                return;
            }

            var win = new Window {
                Title = "發現新版本 · 模擬庭提問陪伴台帳",
                Width = 460,
                Height = 300,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Background = new SolidColorBrush(Color.FromRgb(0xF1, 0xEC, 0xE2)),
                ResizeMode = ResizeMode.NoResize
            };

            var root = new Grid { Margin = new Thickness(20) };
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var title = new TextBlock {
                Text = "發現新版本 v" + manifest.Version + " (目前: v" + UpdateCommon.CurrentBuildVersion + ")",
                FontSize = 15,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(Color.FromRgb(0x1D, 0x1B, 0x17))
            };
            Grid.SetRow(title, 0);
            root.Children.Add(title);

            var notes = new TextBlock {
                Text = "【更新摘要】\n" + (manifest.NotesZh ?? "效能改善與爭點對照引擎優化。"),
                FontSize = 12,
                LineHeight = 18,
                Foreground = new SolidColorBrush(Color.FromRgb(0x4C, 0x48, 0x40)),
                TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center
            };
            Grid.SetRow(notes, 1);
            root.Children.Add(notes);

            var btnPanel = new StackPanel {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right
            };

            var btnLater = new Button {
                Content = "稍後更新",
                Width = 90,
                Height = 32,
                Margin = new Thickness(0, 0, 8, 0),
                Background = new SolidColorBrush(Color.FromRgb(0xE7, 0xE0, 0xD2))
            };
            btnLater.Click += (s, ev) => win.Close();

            var btnUpdate = new Button {
                Content = "立即線上下載更新",
                Width = 140,
                Height = 32,
                Background = new SolidColorBrush(Color.FromRgb(0xB9, 0x47, 0x2B)),
                Foreground = Brushes.White,
                FontWeight = FontWeights.Bold
            };

            btnUpdate.Click += (s, ev) => {
                try {
                    string dlPath = Path.Combine(Path.GetTempPath(), "DebateCompanionUpdateSetup.exe");
                    using (var wc = new WebClient()) {
                        wc.DownloadFile(manifest.InstallerUrl, dlPath);
                    }
                    if (UpdateCommon.VerifySha256(dlPath, manifest.Sha256)) {
                        System.Diagnostics.Process.Start(dlPath);
                        win.Close();
                    } else {
                        MessageBox.Show("下載之更新檔雜湊值校驗未通過，請稍後重試。", "更新失敗", MessageBoxButton.OK, MessageBoxImage.Warning);
                    }
                } catch (Exception ex) {
                    MessageBox.Show("下載更新時失敗: " + ex.Message, "更新失敗", MessageBoxButton.OK, MessageBoxImage.Error);
                }
            };

            btnPanel.Children.Add(btnLater);
            btnPanel.Children.Add(btnUpdate);
            Grid.SetRow(btnPanel, 2);
            root.Children.Add(btnPanel);

            win.Content = root;
            win.ShowDialog();
        }
    }
}
