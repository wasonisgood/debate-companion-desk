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
                MessageBox.Show("目前已是最新版本 (" + UpdateCommon.CurrentBuildVersion + ")。\n爭點對照引擎與雲端題目庫處於最新狀態。", "陪伴台帳更新檢查", MessageBoxButton.OK, MessageBoxImage.Information);
                Shutdown();
                return;
            }

            StackPanel body;
            StackPanel btnPanel;
            var win = UpdateCommon.CreateWindowShell("發現新版本 · 模擬庭提問陪伴台帳", 480, 310, out body, out btnPanel);

            var title = new TextBlock {
                Text = "發現新版本 v" + manifest.Version + " (目前: v" + UpdateCommon.CurrentBuildVersion + ")",
                FontSize = 15,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(UpdateCommon.ColorInk),
                Margin = new Thickness(0, 0, 0, 8)
            };
            body.Children.Add(title);

            var notes = new TextBlock {
                Text = "【更新摘要與熱修復】\n" + (manifest.NotesZh ?? "效能改善與爭點對照引擎優化。"),
                FontSize = 12,
                LineHeight = 18,
                Foreground = new SolidColorBrush(UpdateCommon.ColorInk2),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 10)
            };
            body.Children.Add(notes);

            var status = new TextBlock {
                Text = "點擊「立即線上下載更新」將自動下載安裝檔並更新台帳。",
                FontSize = 11,
                Foreground = new SolidColorBrush(UpdateCommon.ColorInk3)
            };
            body.Children.Add(status);

            var btnLater = UpdateCommon.CreateStyledButton("稍後更新", false, 90, 32);
            btnLater.Click += (s, ev) => win.Close();

            var btnUpdate = UpdateCommon.CreateStyledButton("立即線上下載更新", true, 140, 32);

            btnUpdate.Click += (s, ev) => {
                btnUpdate.IsEnabled = false;
                btnLater.IsEnabled = false;
                status.Text = "正在下載更新檔，請稍候...";
                try {
                    string dlPath = Path.Combine(Path.GetTempPath(), "DebateCompanionUpdateSetup.exe");
                    using (var wc = new WebClient()) {
                        wc.DownloadFile(manifest.InstallerUrl, dlPath);
                    }
                    if (string.IsNullOrEmpty(manifest.Sha256) || UpdateCommon.VerifySha256(dlPath, manifest.Sha256)) {
                        status.Text = "下載完成，啟動安裝...";
                        System.Diagnostics.Process.Start(dlPath);
                        win.Close();
                    } else {
                        MessageBox.Show("下載之更新檔雜湊值校驗未通過，請稍後重試。", "更新失敗", MessageBoxButton.OK, MessageBoxImage.Warning);
                        btnUpdate.IsEnabled = true;
                        btnLater.IsEnabled = true;
                    }
                } catch (Exception ex) {
                    MessageBox.Show("下載更新時失敗: " + ex.Message, "更新失敗", MessageBoxButton.OK, MessageBoxImage.Error);
                    btnUpdate.IsEnabled = true;
                    btnLater.IsEnabled = true;
                }
            };

            btnPanel.Children.Add(btnLater);
            btnPanel.Children.Add(btnUpdate);

            win.ShowDialog();
        }
    }
}
