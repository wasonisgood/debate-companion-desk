using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shell;
using Microsoft.Win32;
using DebateCompanion;

namespace DebateCompanionInstaller {
    public class InstallerWindow : Window {
        private string currentLang = "zh";

        // 色彩配置（典雅宣紙與朱砂紅，與 wason.dev 和風古籍風格完全一致）
        private static readonly SolidColorBrush BrushPaper = new SolidColorBrush(Color.FromRgb(0xF1, 0xEC, 0xE2));
        private static readonly SolidColorBrush BrushPaperCard = new SolidColorBrush(Color.FromRgb(0xF7, 0xF3, 0xEA));
        private static readonly SolidColorBrush BrushDarkBar = new SolidColorBrush(Color.FromRgb(0x1A, 0x17, 0x14));
        private static readonly SolidColorBrush BrushInk = new SolidColorBrush(Color.FromRgb(0x23, 0x20, 0x1B));
        private static readonly SolidColorBrush BrushInkSoft = new SolidColorBrush(Color.FromRgb(0x5D, 0x55, 0x4A));
        private static readonly SolidColorBrush BrushInkFaint = new SolidColorBrush(Color.FromRgb(0x8D, 0x84, 0x75));
        private static readonly SolidColorBrush BrushHair = new SolidColorBrush(Color.FromRgb(0xCB, 0xBF, 0xA8));
        private static readonly SolidColorBrush BrushRule = new SolidColorBrush(Color.FromRgb(0x2A, 0x26, 0x20));
        private static readonly SolidColorBrush BrushShu = new SolidColorBrush(Color.FromRgb(0xB9, 0x47, 0x2B));
        private static readonly SolidColorBrush BrushShuHover = new SolidColorBrush(Color.FromRgb(0x9B, 0x33, 0x1A));

        // 字體
        private static readonly FontFamily FontMincho = new FontFamily("Shippori Mincho, Noto Serif TC, Yu Mincho, Hiragino Mincho ProN, MS Mincho, Georgia, serif");
        private static readonly FontFamily FontGothic = new FontFamily("Zen Kaku Gothic New, Microsoft JhengHei, Yu Gothic, Meiryo, sans-serif");
        private static readonly FontFamily FontRoman = new FontFamily("Cormorant Garamond, Times New Roman, serif");

        // UI 元件
        private TextBlock txtTitleBar;
        private Button btnToggleLang;
        private TextBlock txtKicker;
        private TextBlock txtPageTitle;
        private TextBlock txtPageLead;
        private TextBlock txtLblPath;
        private TextBox txtInstallPath;
        private Button btnBrowse;
        private CheckBox chkDesktop;
        private TextBlock txtLblDesktop;
        private CheckBox chkStartMenu;
        private TextBlock txtLblStartMenu;
        private TextBlock txtSizeBadge;
        private Button btnCancel;
        private Button btnAction;
        private TextBlock txtFootNote;

        // 進度步驟元件
        private Border cardConfig;
        private Border cardProgress;
        private Border cardComplete;
        private TextBlock txtProgressTitle;
        private ProgressBar prgBar;
        private TextBlock txtProgressStatus;
        private TextBlock txtProgressPct;
        private TextBlock txtCompleteTitle;
        private TextBlock txtCompleteDesc;

        private Button btnMaximize;
        private bool isMaximized = false;
        private Rect normalBounds;

        // 已安裝偵測 / 修復模式
        private bool isRepairMode = false;
        private bool installFinished = false;
        private string existingInstallDir = null;
        private string installedVersion = null;
        private bool isUpgrade = false;

        // 安裝程式自我更新
        private bool selfUpdating = false;
        private volatile bool selfUpdateCancel = false;
        private UpdateManifest selfUpdateManifest = null;

        public InstallerWindow() {
            if (InstallerOptions.Lang == "en" || InstallerOptions.Lang == "zh") currentLang = InstallerOptions.Lang;
            Title = "模擬庭提問陪伴台帳 ・ 安裝指南";
            Width = 820;
            Height = 570;
            MinWidth = 700;
            MinHeight = 490;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.CanResizeWithGrip;
            Background = BrushPaper;
            Foreground = BrushInk;
            FontFamily = FontMincho;

            try {
                Stream iconStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico");
                if (iconStream != null) {
                    Icon = System.Windows.Media.Imaging.BitmapFrame.Create(iconStream);
                }
            } catch { }

            WindowChrome.SetWindowChrome(this, new WindowChrome {
                CaptionHeight = 0,
                ResizeBorderThickness = new Thickness(6),
                GlassFrameThickness = new Thickness(0),
                CornerRadius = new CornerRadius(0),
                UseAeroCaptionButtons = false
            });

            BuildUI();
            DetectExistingInstall();
            UpdateLanguage();
            Loaded += OnStartup;
        }

        private void OnStartup(object sender, RoutedEventArgs e) {
            if (InstallerOptions.UpdateMode && existingInstallDir != null) {
                string desk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "模擬庭提問陪伴台帳.lnk");
                string start = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "模擬庭提問陪伴台帳.lnk");
                chkDesktop.IsChecked = File.Exists(desk);
                chkStartMenu.IsChecked = File.Exists(start);
                StartInstallWorkflow();
                return;
            }
            if (!InstallerOptions.NoSelfUpdate) CheckForNewerInstaller();
        }

        private async void CheckForNewerInstaller() {
            bool en = currentLang == "en";
            btnAction.IsEnabled = false;
            txtFootNote.Text = en ? "Checking for newer installer releases online…" : "正在檢查線上是否有更新版本的安裝程式…";
            UpdateManifest m = null;
            try {
                m = await Task.Run(() => UpdateCommon.FetchManifest(6000));
            } catch (Exception ex) {
                UpdateCommon.Log("Self-update check failed: " + ex.Message);
            }
            if (installFinished || cardConfig.Visibility != Visibility.Visible) return;
            en = currentLang == "en";

            if (m == null || !UpdateCommon.IsNewer(m.Version, BuildInfo.Version)) {
                btnAction.IsEnabled = true;
                txtFootNote.Text = m == null
                    ? (en ? "Cannot reach update server. Proceeding with v" + BuildInfo.Version : "無法連線更新伺服器，將以目前版本 v" + BuildInfo.Version + " 安裝。")
                    : (en ? "Latest installer version (v" + BuildInfo.Version + ")" : "已是最新版安裝程式（v" + BuildInfo.Version + "）");
                return;
            }

            UpdateCommon.Log("Newer installer found: " + m.Version + " (self " + BuildInfo.Version + ")");
            selfUpdateManifest = m;
            await DownloadAndRelaunchNewerInstaller();
        }

        private void ApplySelfUpdateTexts() {
            if (!selfUpdating || selfUpdateManifest == null) return;
            bool en = currentLang == "en";
            string v = "v" + UpdateCommon.ParseVersion(selfUpdateManifest.Version).ToString(3);
            txtKicker.Text = "MOOT COURT COMPANION DESK / SELF UPDATE";
            txtPageTitle.Text = en ? "Newer Installer Available" : "發現新版安裝引導程式";
            txtPageLead.Text = en
                ? "A newer installer version (" + v + ") is available. Downloading and replacing automatically."
                : "線上已有更高版本（" + v + "）的安裝程式，正在自動下載並切換至新版引導程序。";
            txtProgressTitle.Text = en ? "Fetching installer " + v + "…" : "正在取得新版安裝引導程式 " + v + "…";
            btnCancel.Content = en ? "［ Skip, Use Current ］" : "［ 略過，使用目前版本 ］";
        }

        private async Task DownloadAndRelaunchNewerInstaller() {
            UpdateManifest m = selfUpdateManifest;
            selfUpdating = true;
            selfUpdateCancel = false;
            cardConfig.Visibility = Visibility.Collapsed;
            cardProgress.Visibility = Visibility.Visible;
            btnAction.Visibility = Visibility.Collapsed;
            btnCancel.Visibility = m.IsForcedFor(BuildInfo.Version) ? Visibility.Collapsed : Visibility.Visible;
            prgBar.Value = 0;
            txtProgressPct.Text = "0%";
            txtProgressStatus.Text = (currentLang == "en") ? "Connecting…" : "連線中…";
            ApplySelfUpdateTexts();

            string dest = UpdateCommon.InstallerDownloadPath(m);
            string error = null;
            try {
                await Task.Run(() => {
                    UpdateCommon.CleanupOldDownloads();
                    UpdateCommon.DownloadFile(m.InstallerUrl, dest, m.Size, (done, total) => {
                        Dispatcher.BeginInvoke(new Action(() => {
                            int pct = total > 0 ? (int)(done * 100 / total) : 0;
                            prgBar.Value = pct;
                            txtProgressPct.Text = total > 0 ? pct + "%" : "";
                            txtProgressStatus.Text = UpdateCommon.FormatSize(done) + (total > 0 ? " / " + UpdateCommon.FormatSize(total) : "");
                        }));
                    }, () => selfUpdateCancel);
                    UpdateCommon.VerifyInstaller(dest, m);
                });
            } catch (OperationCanceledException) {
                try { File.Delete(dest + ".part"); } catch { }
                EndSelfUpdate(null);
                return;
            } catch (Exception ex) {
                try { File.Delete(dest); } catch { }
                error = ex.Message;
            }

            if (error == null) {
                try {
                    string self = Assembly.GetExecutingAssembly().Location;
                    string args = "--no-self-update --lang " + currentLang +
                                  " --old-pid " + Process.GetCurrentProcess().Id +
                                  " --replace " + UpdateCommon.Quote(self);
                    Process.Start(new ProcessStartInfo { FileName = dest, Arguments = args, UseShellExecute = true });
                    installFinished = true;
                    Application.Current.Shutdown();
                    return;
                } catch (Exception ex) {
                    error = ex.Message;
                }
            }
            EndSelfUpdate(error);
        }

        private void EndSelfUpdate(string error) {
            selfUpdating = false;
            bool forcedSelf = selfUpdateManifest != null && selfUpdateManifest.IsForcedFor(BuildInfo.Version);
            cardProgress.Visibility = Visibility.Collapsed;
            cardConfig.Visibility = Visibility.Visible;
            btnAction.Visibility = Visibility.Visible;
            btnCancel.Visibility = Visibility.Visible;
            UpdateLanguage();
            txtKicker.Text = isRepairMode ? "MOOT COURT COMPANION DESK / REPAIR SUITE" : "MOOT COURT COMPANION DESK / INSTALLATION SUITE";
            bool en = currentLang == "en";
            if (error != null) {
                MessageBox.Show((en ? "Failed to download newer installer: " : "新版安裝引導程式下載失敗：") + error +
                    "\n\n" + (forcedSelf
                        ? (en ? "This update is required. Please check your network and retry." : "此版本為強制更新，請確認網路後重新執行。")
                        : (en ? "You may proceed with current v" + BuildInfo.Version : "您仍可使用目前版本 v" + BuildInfo.Version + " 繼續安裝。")),
                    "Installer Update", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
            if (forcedSelf && error != null) {
                btnAction.IsEnabled = false;
                txtFootNote.Text = en ? "Required installer update failed." : "無法取得強制更新版安裝程式，請稍後再試。";
            }
        }

        private void DetectExistingInstall() {
            try {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DebateCompanion")) {
                    if (key != null) {
                        string loc = key.GetValue("InstallLocation") as string;
                        if (!string.IsNullOrEmpty(loc) && Directory.Exists(loc)) {
                            existingInstallDir = loc;
                            txtInstallPath.Text = loc;
                            installedVersion = key.GetValue("DisplayVersion") as string;
                            if (!string.IsNullOrEmpty(installedVersion)) {
                                if (UpdateCommon.IsNewer(BuildInfo.Version, installedVersion)) {
                                    isUpgrade = true;
                                } else {
                                    isRepairMode = true;
                                }
                            } else {
                                isRepairMode = true;
                            }
                        }
                    }
                }
            } catch { }

            if (existingInstallDir == null) {
                string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string defaultPath = Path.Combine(localApp, "DebateCompanion");
                if (Directory.Exists(defaultPath)) {
                    existingInstallDir = defaultPath;
                    txtInstallPath.Text = defaultPath;
                    isRepairMode = true;
                }
            }
        }

        private static string PrecheckTarget(string dir, bool en) {
            try {
                Directory.CreateDirectory(dir);
                string probe = Path.Combine(dir, ".write-test-" + Guid.NewGuid().ToString("N"));
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
            } catch (Exception ex) {
                UpdateCommon.Log("Write probe failed: " + ex);
                return en
                    ? "Cannot write to directory:\n" + dir + "\n\nPlease use default path or run as administrator."
                    : "無法寫入此目錄：\n" + dir + "\n\n請改用預設安裝目錄（%LocalAppData%\\DebateCompanion），或以系統管理員身分執行。";
            }

            try {
                DriveInfo drive = new DriveInfo(Path.GetPathRoot(dir));
                long need = 300L * 1024 * 1024;
                if (drive.IsReady && drive.AvailableFreeSpace < need) {
                    long freeMb = drive.AvailableFreeSpace / 1024 / 1024;
                    return en
                        ? string.Format("Insufficient disk space ({0} MB free / approx 300 MB required).", freeMb)
                        : string.Format("磁碟空間不足（剩餘 {0} MB，需要約 300 MB）。請清出空間或改選其他磁碟。", freeMb);
                }
            } catch { }
            return null;
        }

        private void StopRunningApp() {
            try {
                foreach (Process p in Process.GetProcessesByName("DebateCompanionUpdater")) {
                    try { if (!p.WaitForExit(3000)) { p.Kill(); p.WaitForExit(2000); } } catch { }
                }
            } catch { }
            try {
                foreach (Process p in Process.GetProcessesByName("DebateCompanion")) {
                    try { p.Kill(); p.WaitForExit(3000); } catch { }
                }
            } catch { }
            try {
                foreach (Process p in Process.GetProcessesByName("辯論陪伴台帳")) {
                    try { p.Kill(); p.WaitForExit(3000); } catch { }
                }
            } catch { }
        }

        private void BuildUI() {
            Grid rootGrid = new Grid();
            rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(44, GridUnitType.Pixel) });
            rootGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            // 1. 自繪頂部標題列
            Border titleBar = new Border {
                Background = BrushDarkBar,
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x36, 0x30, 0x27)),
                BorderThickness = new Thickness(0, 0, 0, 1)
            };
            titleBar.MouseDown += (s, e) => {
                if (e.LeftButton == MouseButtonState.Pressed) {
                    if (e.ClickCount == 2) ToggleMaximize(); else DragMove();
                }
            };

            Grid titleGrid = new Grid();
            titleGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            titleGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            StackPanel titleLeft = new StackPanel {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(16, 0, 0, 0)
            };

            Border sealBox = new Border {
                Width = 24,
                Height = 24,
                Background = BrushShu,
                CornerRadius = new CornerRadius(2),
                Margin = new Thickness(0, 0, 10, 0)
            };
            TextBlock txtSeal = new TextBlock {
                Text = "辯",
                Foreground = Brushes.White,
                FontWeight = FontWeights.Bold,
                FontSize = 13,
                FontFamily = FontMincho,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            sealBox.Child = txtSeal;

            txtTitleBar = new TextBlock {
                Foreground = new SolidColorBrush(Color.FromRgb(0xED, 0xE5, 0xD5)),
                FontSize = 13,
                FontWeight = FontWeights.Medium,
                VerticalAlignment = VerticalAlignment.Center
            };

            titleLeft.Children.Add(sealBox);
            titleLeft.Children.Add(txtTitleBar);
            Grid.SetColumn(titleLeft, 0);
            titleGrid.Children.Add(titleLeft);

            StackPanel titleRight = new StackPanel {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 8, 0)
            };

            btnToggleLang = CreateTitleBarButton("English", 11);
            btnToggleLang.Click += (s, e) => {
                currentLang = (currentLang == "en") ? "zh" : "en";
                UpdateLanguage();
            };

            Button btnMinimize = CreateTitleBarGlyphButton("―", 11);
            btnMinimize.Click += (s, e) => WindowState = WindowState.Minimized;

            btnMaximize = CreateTitleBarGlyphButton("□", 12);
            btnMaximize.Click += (s, e) => ToggleMaximize();

            Button btnClose = CreateTitleBarGlyphButton("✕", 13);
            btnClose.Click += (s, e) => Close();

            titleRight.Children.Add(btnToggleLang);
            titleRight.Children.Add(btnMinimize);
            titleRight.Children.Add(btnMaximize);
            titleRight.Children.Add(btnClose);
            Grid.SetColumn(titleRight, 1);
            titleGrid.Children.Add(titleRight);

            titleBar.Child = titleGrid;
            Grid.SetRow(titleBar, 0);
            rootGrid.Children.Add(titleBar);

            // 2. 內容自適應區域
            Border contentBorder = new Border {
                Padding = new Thickness(44, 30, 44, 26),
                Background = BrushPaper
            };

            Grid mainGrid = new Grid();
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            // Header 區域
            StackPanel headerStack = new StackPanel { Margin = new Thickness(0, 0, 0, 20) };
            txtKicker = new TextBlock {
                FontFamily = FontRoman,
                FontSize = 11,
                Foreground = BrushInkFaint,
                Margin = new Thickness(0, 0, 0, 4),
                Text = "MOOT COURT COMPANION DESK / INSTALLATION SUITE"
            };
            txtPageTitle = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 26,
                FontWeight = FontWeights.Bold,
                Foreground = BrushInk,
                Margin = new Thickness(0, 0, 0, 8)
            };
            txtPageLead = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 13,
                Foreground = BrushInkSoft,
                LineHeight = 22
            };
            Border headerLine = new Border {
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(0, 0, 0, 1),
                Margin = new Thickness(0, 14, 0, 0)
            };

            headerStack.Children.Add(txtKicker);
            headerStack.Children.Add(txtPageTitle);
            headerStack.Children.Add(txtPageLead);
            headerStack.Children.Add(headerLine);
            Grid.SetRow(headerStack, 0);
            mainGrid.Children.Add(headerStack);

            // 核心內容區
            Grid cardContainer = new Grid {
                VerticalAlignment = VerticalAlignment.Stretch,
                HorizontalAlignment = HorizontalAlignment.Stretch
            };

            // 卡片 1：設定
            cardConfig = CreateStepCard();
            StackPanel cfgStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };

            txtLblPath = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = BrushInkSoft,
                Margin = new Thickness(0, 0, 0, 8)
            };

            Grid pathRow = new Grid { Margin = new Thickness(0, 0, 0, 16) };
            pathRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            pathRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string defaultPath = Path.Combine(localApp, "DebateCompanion");

            txtInstallPath = new TextBox {
                Text = defaultPath,
                FontFamily = new FontFamily("Consolas, Courier New, monospace"),
                FontSize = 13,
                Foreground = BrushInk,
                Background = Brushes.White,
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(1, 1, 1, 2),
                Padding = new Thickness(10, 8, 10, 8),
                VerticalContentAlignment = VerticalAlignment.Center
            };
            Grid.SetColumn(txtInstallPath, 0);
            pathRow.Children.Add(txtInstallPath);

            btnBrowse = CreateOutlinedButton("［ 瀏覽 ］", 12);
            btnBrowse.Margin = new Thickness(10, 0, 0, 0);
            btnBrowse.Padding = new Thickness(16, 7, 16, 7);
            btnBrowse.Click += (s, e) => BrowseInstallPath();
            Grid.SetColumn(btnBrowse, 1);
            pathRow.Children.Add(btnBrowse);

            chkDesktop = new CheckBox {
                IsChecked = true,
                Margin = new Thickness(0, 4, 0, 8),
                VerticalContentAlignment = VerticalAlignment.Center
            };
            txtLblDesktop = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                Foreground = BrushInk,
                Margin = new Thickness(6, 0, 0, 0)
            };
            chkDesktop.Content = txtLblDesktop;

            chkStartMenu = new CheckBox {
                IsChecked = true,
                Margin = new Thickness(0, 0, 0, 16),
                VerticalContentAlignment = VerticalAlignment.Center
            };
            txtLblStartMenu = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                Foreground = BrushInk,
                Margin = new Thickness(6, 0, 0, 0)
            };
            chkStartMenu.Content = txtLblStartMenu;

            Border dashLine = new Border {
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(0, 1, 0, 0),
                Margin = new Thickness(0, 4, 0, 10)
            };

            txtSizeBadge = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 11,
                Foreground = BrushInkFaint,
                LineHeight = 18
            };

            cfgStack.Children.Add(txtLblPath);
            cfgStack.Children.Add(pathRow);
            cfgStack.Children.Add(chkDesktop);
            cfgStack.Children.Add(chkStartMenu);
            cfgStack.Children.Add(dashLine);
            cfgStack.Children.Add(txtSizeBadge);
            cardConfig.Child = cfgStack;

            // 卡片 2：進度
            cardProgress = CreateStepCard();
            cardProgress.Visibility = Visibility.Collapsed;
            StackPanel prgStack = new StackPanel {
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                Margin = new Thickness(24, 0, 24, 0)
            };

            txtProgressTitle = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 16,
                FontWeight = FontWeights.Bold,
                Foreground = BrushInk,
                Margin = new Thickness(0, 0, 0, 16)
            };

            prgBar = new ProgressBar {
                Height = 8,
                Minimum = 0,
                Maximum = 100,
                Value = 0,
                Foreground = BrushShu,
                Background = new SolidColorBrush(Color.FromRgb(0xDC, 0xD3, 0xC1)),
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(1)
            };

            Grid prgStatusRow = new Grid { Margin = new Thickness(0, 12, 0, 0) };
            txtProgressStatus = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                Foreground = BrushInkSoft,
                HorizontalAlignment = HorizontalAlignment.Left
            };
            txtProgressPct = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                FontWeight = FontWeights.Bold,
                Foreground = BrushInk,
                HorizontalAlignment = HorizontalAlignment.Right
            };
            prgStatusRow.Children.Add(txtProgressStatus);
            prgStatusRow.Children.Add(txtProgressPct);

            prgStack.Children.Add(txtProgressTitle);
            prgStack.Children.Add(prgBar);
            prgStack.Children.Add(prgStatusRow);
            cardProgress.Child = prgStack;

            // 卡片 3：完成
            cardComplete = CreateStepCard();
            cardComplete.Visibility = Visibility.Collapsed;
            StackPanel cmpStack = new StackPanel {
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center
            };

            Border sealLarge = new Border {
                Width = 64,
                Height = 64,
                BorderBrush = BrushShu,
                BorderThickness = new Thickness(2),
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 16)
            };
            TextBlock txtSealLarge = new TextBlock {
                Text = "完",
                FontFamily = FontMincho,
                FontSize = 30,
                FontWeight = FontWeights.Bold,
                Foreground = BrushShu,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            sealLarge.Child = txtSealLarge;

            txtCompleteTitle = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 20,
                FontWeight = FontWeights.Bold,
                Foreground = BrushInk,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 10)
            };

            txtCompleteDesc = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 13,
                Foreground = BrushInkSoft,
                LineHeight = 22,
                TextAlignment = TextAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center
            };

            cmpStack.Children.Add(sealLarge);
            cmpStack.Children.Add(txtCompleteTitle);
            cmpStack.Children.Add(txtCompleteDesc);
            cardComplete.Child = cmpStack;

            cardContainer.Children.Add(cardConfig);
            cardContainer.Children.Add(cardProgress);
            cardContainer.Children.Add(cardComplete);

            Grid.SetRow(cardContainer, 1);
            mainGrid.Children.Add(cardContainer);

            // Footer 區域
            Grid footGrid = new Grid { Margin = new Thickness(0, 20, 0, 0) };
            footGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            footGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            txtFootNote = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 11,
                Foreground = BrushInkFaint,
                VerticalAlignment = VerticalAlignment.Center,
                Text = "© DEBATE COMPANION DESK / wason.dev"
            };
            Grid.SetColumn(txtFootNote, 0);
            footGrid.Children.Add(txtFootNote);

            StackPanel btnPanel = new StackPanel {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            btnCancel = CreateOutlinedButton("［ 取消 ］", 12);
            btnCancel.Padding = new Thickness(20, 8, 20, 8);
            btnCancel.Margin = new Thickness(0, 0, 12, 0);
            btnCancel.Click += (s, e) => {
                if (selfUpdating) { selfUpdateCancel = true; return; }
                Close();
            };

            btnAction = CreateVermilionButton("［ 開始安裝 ］", 13);
            btnAction.Padding = new Thickness(26, 8, 26, 8);
            btnAction.Click += (s, e) => {
                if (installFinished) return;
                StartInstallWorkflow();
            };

            btnPanel.Children.Add(btnCancel);
            btnPanel.Children.Add(btnAction);
            Grid.SetColumn(btnPanel, 1);
            footGrid.Children.Add(btnPanel);

            Grid.SetRow(footGrid, 2);
            mainGrid.Children.Add(footGrid);

            contentBorder.Child = mainGrid;
            Grid.SetRow(contentBorder, 1);
            rootGrid.Children.Add(contentBorder);

            Content = rootGrid;
        }

        private void ToggleMaximize() {
            if (isMaximized) {
                Left = normalBounds.Left;
                Top = normalBounds.Top;
                Width = normalBounds.Width;
                Height = normalBounds.Height;
                isMaximized = false;
                btnMaximize.Content = "□";
            } else {
                normalBounds = new Rect(Left, Top, Width, Height);
                var workArea = SystemParameters.WorkArea;
                Left = workArea.Left;
                Top = workArea.Top;
                Width = workArea.Width;
                Height = workArea.Height;
                isMaximized = true;
                btnMaximize.Content = "❐";
            }
        }

        private Border CreateStepCard() {
            return new Border {
                Background = BrushPaperCard,
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(1),
                Padding = new Thickness(32, 28, 32, 28),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch
            };
        }

        private Button CreateTitleBarButton(string text, double fontSize) {
            Button btn = new Button {
                Content = text,
                FontSize = fontSize,
                FontFamily = FontGothic,
                Foreground = new SolidColorBrush(Color.FromRgb(0xCB, 0xBF, 0xA8)),
                Background = Brushes.Transparent,
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x55, 0x4A, 0x3E)),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8, 2, 8, 2),
                Margin = new Thickness(0, 0, 10, 0),
                Cursor = Cursors.Hand
            };
            btn.MouseEnter += (s, e) => btn.Background = new SolidColorBrush(Color.FromRgb(0x2C, 0x25, 0x1F));
            btn.MouseLeave += (s, e) => btn.Background = Brushes.Transparent;
            return btn;
        }

        private Button CreateTitleBarGlyphButton(string glyph, double fontSize) {
            Button btn = new Button {
                Content = glyph,
                FontSize = fontSize,
                FontFamily = FontMincho,
                Foreground = new SolidColorBrush(Color.FromRgb(0x8C, 0x82, 0x70)),
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                Width = 32,
                Height = 32,
                Cursor = Cursors.Hand,
                VerticalContentAlignment = VerticalAlignment.Center,
                HorizontalContentAlignment = HorizontalAlignment.Center
            };
            btn.MouseEnter += (s, e) => {
                btn.Background = (glyph == "✕") ? BrushShu : new SolidColorBrush(Color.FromRgb(0x2C, 0x25, 0x1F));
                btn.Foreground = Brushes.White;
            };
            btn.MouseLeave += (s, e) => {
                btn.Background = Brushes.Transparent;
                btn.Foreground = new SolidColorBrush(Color.FromRgb(0x8C, 0x82, 0x70));
            };
            return btn;
        }

        private Button CreateOutlinedButton(string text, double fontSize) {
            Button btn = new Button {
                Content = text,
                FontSize = fontSize,
                FontFamily = FontGothic,
                FontWeight = FontWeights.SemiBold,
                Foreground = BrushInk,
                Background = Brushes.Transparent,
                BorderBrush = BrushRule,
                BorderThickness = new Thickness(1),
                Cursor = Cursors.Hand
            };
            btn.MouseEnter += (s, e) => {
                btn.Background = BrushInk;
                btn.Foreground = BrushPaper;
            };
            btn.MouseLeave += (s, e) => {
                btn.Background = Brushes.Transparent;
                btn.Foreground = BrushInk;
            };
            return btn;
        }

        private Button CreateVermilionButton(string text, double fontSize) {
            Button btn = new Button {
                Content = text,
                FontSize = fontSize,
                FontFamily = FontGothic,
                FontWeight = FontWeights.Bold,
                Foreground = Brushes.White,
                Background = BrushShu,
                BorderBrush = BrushShu,
                BorderThickness = new Thickness(1),
                Cursor = Cursors.Hand
            };
            btn.MouseEnter += (s, e) => {
                btn.Background = BrushShuHover;
                btn.BorderBrush = BrushShuHover;
            };
            btn.MouseLeave += (s, e) => {
                btn.Background = BrushShu;
                btn.BorderBrush = BrushShu;
            };
            return btn;
        }

        private void BrowseInstallPath() {
            using (var dialog = new System.Windows.Forms.FolderBrowserDialog()) {
                dialog.Description = (currentLang == "en")
                    ? "Select destination folder for Debate Companion Desk:"
                    : "請選擇模擬庭提問陪伴台帳的安裝目標資料夾：";
                dialog.SelectedPath = txtInstallPath.Text;
                dialog.ShowNewFolderButton = true;
                if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK) {
                    txtInstallPath.Text = dialog.SelectedPath;
                }
            }
        }

        private void UpdateLanguage() {
            bool en = currentLang == "en";
            Title = en ? "Debate Companion Desk — Installation Setup" : "模擬庭提問陪伴台帳 — 安裝指南";
            btnToggleLang.Content = en ? "切換繁體中文" : "English";
            txtTitleBar.Text = en ? "Debate Companion Desk ・ Setup Guide" : "模擬庭提問陪伴台帳 ・ 安裝指南";

            if (isUpgrade) {
                txtKicker.Text = "MOOT COURT COMPANION DESK / UPGRADE SUITE";
                txtPageTitle.Text = en ? "Upgrade Debate Companion" : "升級 模擬庭提問陪伴台帳";
                txtPageLead.Text = en
                    ? "Upgrading from v" + installedVersion + " to v" + BuildInfo.Version + ". All notes, recordings and credentials will be preserved."
                    : "即將從現有版本 v" + installedVersion + " 升級至 v" + BuildInfo.Version + "。您的練習紀錄、雲端金鑰與爭點手稿將完整保留。";
                btnAction.Content = en ? "［ Begin Upgrade ］" : "［ 開始升級 ］";
            } else if (isRepairMode) {
                txtKicker.Text = "MOOT COURT COMPANION DESK / REPAIR SUITE";
                txtPageTitle.Text = en ? "Reinstall / Repair Companion" : "重新安裝 / 修復 陪伴台帳";
                txtPageLead.Text = en
                    ? "Existing installation detected (v" + (installedVersion ?? BuildInfo.Version) + "). Overwriting system runtime and verifying registries."
                    : "系統中已偵測到已安裝之陪伴台帳（v" + (installedVersion ?? BuildInfo.Version) + "）。將覆寫更新系統核心檔案並重新校正系統註冊。";
                btnAction.Content = en ? "［ Repair / Reinstall ］" : "［ 重新安裝 / 修復 ］";
            } else {
                txtKicker.Text = "MOOT COURT COMPANION DESK / INSTALLATION SUITE";
                txtPageTitle.Text = en ? "Install Debate Companion" : "部署 模擬庭提問陪伴台帳";
                txtPageLead.Text = en
                    ? "Moot court debater practice companion & researcher AI intelligent question assistant desktop suite."
                    : "辯士練習陪伴與研究員智能提問助手案頭端。將完整解壓部署離線核心、通訊協定與系統註冊。";
                btnAction.Content = en ? "［ Begin Installation ］" : "［ 開始安裝 ］";
            }

            txtLblPath.Text = en ? "Destination Directory" : "安裝目的地資料夾";
            btnBrowse.Content = en ? "［ Browse ］" : "［ 瀏覽 ］";
            txtLblDesktop.Text = en ? "Create Desktop Shortcut (模擬庭提問陪伴台帳)" : "建立桌面捷徑（模擬庭提問陪伴台帳）";
            txtLblStartMenu.Text = en ? "Register in Start Menu Programs" : "於開始功能表「所有程式」建立捷徑";
            txtSizeBadge.Text = en
                ? "Required disk space: ~180 MB  ·  Includes offline speech engine & cloud sync bridge"
                : "需要磁碟空間：約 180 MB  ·  內含離線計時核心、法規檢索快取與 wason.dev 雲端橋接器";

            btnCancel.Content = en ? "［ Cancel ］" : "［ 取消 ］";
            txtFootNote.Text = en
                ? "© DEBATE COMPANION DESK / wason.dev  v" + BuildInfo.Version
                : "© 模擬庭提問陪伴台帳 / wason.dev  v" + BuildInfo.Version;
        }

        private async void StartInstallWorkflow() {
            string targetDir = txtInstallPath.Text.Trim();
            if (string.IsNullOrEmpty(targetDir)) return;

            string err = PrecheckTarget(targetDir, currentLang == "en");
            if (err != null) {
                MessageBox.Show(err, "Target Check", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            cardConfig.Visibility = Visibility.Collapsed;
            cardProgress.Visibility = Visibility.Visible;
            btnCancel.Visibility = Visibility.Collapsed;
            btnAction.IsEnabled = false;

            txtProgressTitle.Text = (currentLang == "en") ? "Deploying Debate Companion…" : "正在部署 模擬庭提問陪伴台帳…";
            txtProgressStatus.Text = (currentLang == "en") ? "Preparing target environment…" : "正在準備安裝環境…";

            bool ok = false;
            string exMsg = null;
            await Task.Run(() => {
                try {
                    StopRunningApp();
                    InstallCore(targetDir, (pct, status) => {
                        Dispatcher.Invoke(() => {
                            prgBar.Value = pct;
                            txtProgressPct.Text = pct + "%";
                            txtProgressStatus.Text = status;
                        });
                    });
                    ok = true;
                } catch (Exception ex) {
                    exMsg = ex.Message;
                }
            });

            if (!ok) {
                MessageBox.Show((currentLang == "en" ? "Installation failed: " : "安裝過程發生錯誤: ") + exMsg,
                    "Error", MessageBoxButton.OK, MessageBoxImage.Error);
                cardProgress.Visibility = Visibility.Collapsed;
                cardConfig.Visibility = Visibility.Visible;
                btnCancel.Visibility = Visibility.Visible;
                btnAction.IsEnabled = true;
                return;
            }

            // 完成畫面
            installFinished = true;
            cardProgress.Visibility = Visibility.Collapsed;
            cardComplete.Visibility = Visibility.Visible;

            bool en = currentLang == "en";
            txtPageTitle.Text = en ? "Installation Complete" : "安裝順利完成";
            txtPageLead.Text = en
                ? "Debate Companion Desk is ready on your computer."
                : "模擬庭提問陪伴台帳 已成功部署就緒，隨時支援您的辯論演練。";

            txtCompleteTitle.Text = en ? "Ready to Practice" : "演練台帳就緒";
            txtCompleteDesc.Text = en
                ? "Desktop shortcuts and debate-companion:// protocols are registered.\nYou can now launch the app or open the installation folder."
                : "桌面捷徑與 debate-companion:// 通訊協定已配置完畢。\n您現在可點擊下方按鈕直接啟動陪伴台帳，展開賽事辯論演練。";

            btnAction.Content = en ? "［ Launch Companion ］" : "［ 啟動陪伴台帳 ］";
            btnAction.IsEnabled = true;
            btnAction.Click -= null;
            btnAction.Click += (s, e) => {
                LaunchInstalledApp(targetDir);
                Close();
            };

            btnCancel.Content = en ? "［ Open Folder ］" : "［ 開啟安裝目錄 ］";
            btnCancel.Visibility = Visibility.Visible;
            btnCancel.Click -= null;
            btnCancel.Click += (s, e) => {
                try { Process.Start("explorer.exe", targetDir); } catch { }
                Close();
            };
        }

        private void InstallCore(string targetDir, Action<int, string> report) {
            bool en = currentLang == "en";
            report(10, en ? "Extracting application payload…" : "正在解壓縮應用程式核心組件…");
            Directory.CreateDirectory(targetDir);

            var asm = Assembly.GetExecutingAssembly();

            // 1. 解壓縮 app-payload.zip
            using (Stream zipStream = asm.GetManifestResourceStream("app-payload.zip")) {
                if (zipStream != null) {
                    string zipTmp = Path.Combine(Path.GetTempPath(), "debate-payload-" + Guid.NewGuid().ToString("N") + ".zip");
                    using (FileStream fs = File.Create(zipTmp)) {
                        zipStream.CopyTo(fs);
                    }
                    report(35, en ? "Deploying files to disk…" : "正在將檔案寫入磁碟…");

                    using (ZipArchive archive = ZipFile.OpenRead(zipTmp)) {
                        int count = archive.Entries.Count;
                        int i = 0;
                        foreach (ZipArchiveEntry entry in archive.Entries) {
                            string fullDest = Path.Combine(targetDir, entry.FullName);
                            if (string.IsNullOrEmpty(entry.Name)) {
                                Directory.CreateDirectory(fullDest);
                            } else {
                                Directory.CreateDirectory(Path.GetDirectoryName(fullDest));
                                entry.ExtractToFile(fullDest, true);
                            }
                            i++;
                            if (i % 20 == 0) {
                                int pct = 35 + (int)(45.0 * i / count);
                                report(pct, string.Format(en ? "Extracting files ({0}/{1})…" : "正在解壓核心檔案 ({0}/{1})…", i, count));
                            }
                        }
                    }
                    try { File.Delete(zipTmp); } catch { }
                }
            }

            report(82, en ? "Installing uninstaller and updater…" : "正在安裝專屬解除安裝與更新精靈…");

            // 2. 解放 uninstall.exe
            using (Stream uStream = asm.GetManifestResourceStream("uninstall.exe")) {
                if (uStream != null) {
                    string uPath = Path.Combine(targetDir, "uninstall.exe");
                    using (FileStream fs = File.Create(uPath)) {
                        uStream.CopyTo(fs);
                    }
                }
            }

            // 3. 解放 DebateCompanionUpdater.exe
            using (Stream upStream = asm.GetManifestResourceStream("DebateCompanionUpdater.exe")) {
                if (upStream != null) {
                    string upPath = Path.Combine(targetDir, "DebateCompanionUpdater.exe");
                    using (FileStream fs = File.Create(upPath)) {
                        upStream.CopyTo(fs);
                    }
                }
            }

            report(90, en ? "Configuring system shortcuts and protocols…" : "正在註冊系統捷徑與深度連結協定…");

            string exePath = GetMainExePath(targetDir);

            // 4. 捷徑建立
            if (chkDesktop.IsChecked == true) {
                try {
                    string desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                    CreateShortcut(Path.Combine(desktopDir, "模擬庭提問陪伴台帳.lnk"), exePath, targetDir, "模擬庭提問陪伴台帳");
                } catch { }
            }

            if (chkStartMenu.IsChecked == true) {
                try {
                    string startDir = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                    CreateShortcut(Path.Combine(startDir, "模擬庭提問陪伴台帳.lnk"), exePath, targetDir, "模擬庭提問陪伴台帳");
                } catch { }
            }

            // 5. 註冊通訊協定 debate-companion://
            try {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\debate-companion")) {
                    key.SetValue("", "URL:Debate Companion Protocol");
                    key.SetValue("URL Protocol", "");
                    using (RegistryKey cmd = key.CreateSubKey(@"shell\open\command")) {
                        cmd.SetValue("", "\"" + exePath + "\" \"%1\"");
                    }
                }
            } catch { }

            // 6. 註冊 Windows 設定「已安裝應用程式」完整中繼資料
            report(96, en ? "Registering in Windows Settings…" : "正在寫入 Windows 設定之卸載資訊…");
            try {
                long totalBytes = 0;
                try {
                    DirectoryInfo di = new DirectoryInfo(targetDir);
                    foreach (FileInfo f in di.EnumerateFiles("*", SearchOption.AllDirectories)) {
                        totalBytes += f.Length;
                    }
                } catch { }
                int sizeKb = (int)(totalBytes / 1024);
                if (sizeKb <= 0) sizeKb = 150000;

                string uninstPath = Path.Combine(targetDir, "uninstall.exe");
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DebateCompanion")) {
                    key.SetValue("DisplayName", "模擬庭提問陪伴台帳");
                    key.SetValue("DisplayVersion", BuildInfo.Version);
                    key.SetValue("Publisher", "wasonisgood");
                    key.SetValue("InstallLocation", targetDir);
                    key.SetValue("UninstallString", "\"" + uninstPath + "\"");
                    key.SetValue("QuietUninstallString", "\"" + uninstPath + "\" --silent");
                    key.SetValue("DisplayIcon", exePath + ",0");
                    key.SetValue("EstimatedSize", sizeKb, RegistryValueKind.DWord);
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    key.SetValue("WindowsInstaller", 0, RegistryValueKind.DWord);
                    key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                    key.SetValue("HelpLink", "https://wason.dev/debate");
                    key.SetValue("URLInfoAbout", "https://wason.dev/debate");
                    key.SetValue("URLUpdateInfo", "https://github.com/wasonisgood/debate-companion-desk/releases");
                }
                UpdateCommon.NotifyShell();
            } catch { }

            report(100, en ? "Setup completed!" : "部署完成！");
        }

        private static string GetMainExePath(string dir) {
            string p1 = Path.Combine(dir, "辯論陪伴台帳.exe");
            if (File.Exists(p1)) return p1;
            string p2 = Path.Combine(dir, "DebateCompanion.exe");
            if (File.Exists(p2)) return p2;
            try {
                foreach (string f in Directory.GetFiles(dir, "*.exe")) {
                    string n = Path.GetFileName(f).ToLowerInvariant();
                    if (!n.Contains("setup") && !n.Contains("uninstall") && !n.Contains("updater")) {
                        return f;
                    }
                }
            } catch { }
            return p1;
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string description) {
            try {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetPath;
                shortcut.WorkingDirectory = workingDir;
                shortcut.IconLocation = targetPath + ",0";
                shortcut.Description = description;
                shortcut.Save();
            } catch { }
        }

        private static void LaunchInstalledApp(string installDir) {
            string exe = GetMainExePath(installDir);
            if (File.Exists(exe)) {
                try { Process.Start(exe); } catch { }
            }
        }
    }

    public static class InstallerOptions {
        public static string Lang = "zh";
        public static bool UpdateMode = false;
        public static bool NoSelfUpdate = false;
    }

    public class App : Application {
        [STAThread]
        public static void Main(string[] args) {
            if (args != null) {
                for (int i = 0; i < args.Length; i++) {
                    string a = args[i];
                    if (string.Equals(a, "--lang", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) {
                        InstallerOptions.Lang = args[++i];
                    } else if (string.Equals(a, "--update-mode", StringComparison.OrdinalIgnoreCase)) {
                        InstallerOptions.UpdateMode = true;
                    } else if (string.Equals(a, "--no-self-update", StringComparison.OrdinalIgnoreCase)) {
                        InstallerOptions.NoSelfUpdate = true;
                    }
                }
            }
            new App().Run(new InstallerWindow());
        }
    }
}
