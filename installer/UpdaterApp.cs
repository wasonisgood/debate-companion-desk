using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shell;
using Microsoft.Win32;
using DebateCompanion;

// 模擬庭提問陪伴台帳 ・ 更新程式（DebateCompanionUpdater.exe）
//   由主程式於啟動時呼叫：DebateCompanionUpdater.exe --app-version 1.0.2
//   手動檢查：DebateCompanionUpdater.exe --manual
// 結束代碼：0 = 無動作／稍後提醒，10 = 已啟動新版安裝程式，20 = 強制更新被拒
namespace DebateCompanionUpdater {
    public enum UpState { Checking, UpToDate, CheckError, Available, Downloading, DownloadError, Launching }

    public class UpdaterWindow : Window {
        private string lang = "zh";
        private readonly bool manual;
        private readonly string currentVersion;
        private UpdateManifest manifest;
        private bool forced;
        private UpState state;
        private string errorDetail;
        private volatile bool cancelRequested;
        private int exitCode = UpdateCommon.ExitNoAction;

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
        private static readonly SolidColorBrush BrushShuWash = new SolidColorBrush(Color.FromRgb(0xF4, 0xE4, 0xDC));

        private static readonly FontFamily FontMincho = new FontFamily("Shippori Mincho, Noto Serif TC, Yu Mincho, Hiragino Mincho ProN, MS Mincho, Georgia, serif");
        private static readonly FontFamily FontGothic = new FontFamily("Zen Kaku Gothic New, Microsoft JhengHei, Yu Gothic, Meiryo, sans-serif");
        private static readonly FontFamily FontRoman = new FontFamily("Cormorant Garamond, Times New Roman, serif");

        private TextBlock txtTitleBar, txtKicker, txtPageTitle, txtPageLead, txtFootNote;
        private Button btnToggleLang, btnClose, btnSecondary, btnPrimary;
        private Border cardInfo, cardProgress, cardMessage, forcedBanner;
        private TextBlock lblCurrent, valCurrent, lblLatest, valLatest, txtMeta, lblNotes, txtNotes, txtForced;
        private CheckBox chkSnooze;
        private TextBlock txtSnooze;
        private TextBlock txtProgressTitle, txtProgressStatus, txtProgressPct;
        private ProgressBar prgBar;
        private TextBlock txtSealMsg, txtMsgTitle, txtMsgDesc;
        private Border sealMsg;

        public UpdaterWindow(bool manual, string currentVersion, UpdateManifest preloaded, string lang) {
            this.manual = manual;
            this.currentVersion = currentVersion;
            this.lang = lang == "en" ? "en" : "zh";

            Title = "模擬庭提問陪伴台帳 ・ 更新案內";
            Width = 720;
            Height = 540;
            MinWidth = 620;
            MinHeight = 480;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.CanResizeWithGrip;
            Background = BrushPaper;
            Foreground = BrushInk;
            FontFamily = FontMincho;
            Topmost = true;

            try {
                Stream iconStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico");
                if (iconStream != null) Icon = System.Windows.Media.Imaging.BitmapFrame.Create(iconStream);
            } catch { }

            WindowChrome.SetWindowChrome(this, new WindowChrome {
                CaptionHeight = 0,
                ResizeBorderThickness = new Thickness(6),
                GlassFrameThickness = new Thickness(0),
                CornerRadius = new CornerRadius(0),
                UseAeroCaptionButtons = false
            });

            BuildUI();

            if (preloaded != null) {
                SetManifest(preloaded);
            } else {
                state = UpState.Checking;
                Loaded += async (s, e) => await CheckAsync();
            }
            Render();
            ContentRendered += (s, e) => { Topmost = false; Activate(); };
            Closing += (s, e) => OnClosingWindow(e);
        }

        public int ExitCode { get { return exitCode; } }

        private string T(string zh, string en) { return lang == "en" ? en : zh; }

        private void SetManifest(UpdateManifest m) {
            manifest = m;
            if (UpdateCommon.IsNewer(m.Version, currentVersion)) {
                forced = m.IsForcedFor(currentVersion);
                state = UpState.Available;
            } else {
                state = UpState.UpToDate;
            }
        }

        private async Task CheckAsync() {
            state = UpState.Checking; Render();
            try {
                UpdateManifest m = await Task.Run(() => UpdateCommon.FetchManifest(10000));
                SetManifest(m);
            } catch (Exception ex) {
                UpdateCommon.Log("Manual check failed: " + ex);
                errorDetail = ex.Message;
                state = UpState.CheckError;
            }
            Render();
        }

        private void BuildUI() {
            Grid root = new Grid();
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(44) });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

            Border titleBar = new Border {
                Background = BrushDarkBar,
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x36, 0x30, 0x27)),
                BorderThickness = new Thickness(0, 0, 0, 1)
            };
            titleBar.MouseDown += (s, e) => { if (e.LeftButton == MouseButtonState.Pressed) DragMove(); };

            Grid tg = new Grid();
            tg.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            tg.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            StackPanel tl = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(16, 0, 0, 0) };
            Border seal = new Border { Width = 24, Height = 24, Background = BrushShu, CornerRadius = new CornerRadius(2), Margin = new Thickness(0, 0, 10, 0) };
            seal.Child = new TextBlock { Text = "辯", Foreground = Brushes.White, FontWeight = FontWeights.Bold, FontSize = 13, FontFamily = FontMincho, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            txtTitleBar = new TextBlock { Foreground = new SolidColorBrush(Color.FromRgb(0xED, 0xE5, 0xD5)), FontSize = 13, FontWeight = FontWeights.Medium, VerticalAlignment = VerticalAlignment.Center };
            tl.Children.Add(seal); tl.Children.Add(txtTitleBar);
            tg.Children.Add(tl);

            StackPanel tr = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) };
            btnToggleLang = CreateTitleBarButton("English", 11);
            btnToggleLang.Click += (s, e) => { lang = lang == "en" ? "zh" : "en"; SaveLang(); Render(); };
            Button btnMin = CreateGlyphButton("―", 11);
            btnMin.Click += (s, e) => WindowState = WindowState.Minimized;
            btnClose = CreateGlyphButton("✕", 13);
            btnClose.Click += (s, e) => Close();
            tr.Children.Add(btnToggleLang); tr.Children.Add(btnMin); tr.Children.Add(btnClose);
            Grid.SetColumn(tr, 1);
            tg.Children.Add(tr);
            titleBar.Child = tg;
            root.Children.Add(titleBar);

            Border content = new Border { Padding = new Thickness(40, 26, 40, 22), Background = BrushPaper };
            Grid main = new Grid();
            main.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            main.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            main.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            StackPanel header = new StackPanel { Margin = new Thickness(0, 0, 0, 16) };
            txtKicker = new TextBlock { FontFamily = FontRoman, FontSize = 11, Foreground = BrushInkFaint, Margin = new Thickness(0, 0, 0, 4) };
            txtPageTitle = new TextBlock { FontFamily = FontMincho, FontSize = 24, FontWeight = FontWeights.Bold, Foreground = BrushInk, Margin = new Thickness(0, 0, 0, 6) };
            txtPageLead = new TextBlock { FontFamily = FontMincho, FontSize = 13, Foreground = BrushInkSoft, LineHeight = 21, TextWrapping = TextWrapping.Wrap };
            header.Children.Add(txtKicker); header.Children.Add(txtPageTitle); header.Children.Add(txtPageLead);
            header.Children.Add(new Border { BorderBrush = BrushHair, BorderThickness = new Thickness(0, 0, 0, 1), Margin = new Thickness(0, 12, 0, 0) });
            main.Children.Add(header);

            Grid cards = new Grid();
            cards.Children.Add(cardInfo = BuildInfoCard());
            cards.Children.Add(cardProgress = BuildProgressCard());
            cards.Children.Add(cardMessage = BuildMessageCard());
            Grid.SetRow(cards, 1);
            main.Children.Add(cards);

            Grid foot = new Grid { Margin = new Thickness(0, 16, 0, 0) };
            foot.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            foot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            txtFootNote = new TextBlock { FontFamily = FontMincho, FontSize = 11, Foreground = BrushInkFaint, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 12, 0) };
            foot.Children.Add(txtFootNote);
            StackPanel bp = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            btnSecondary = CreateOutlinedButton("", 12);
            btnSecondary.Padding = new Thickness(20, 8, 20, 8);
            btnSecondary.Margin = new Thickness(0, 0, 12, 0);
            btnSecondary.Click += (s, e) => OnSecondary();
            btnPrimary = CreateVermilionButton("", 13);
            btnPrimary.Padding = new Thickness(26, 8, 26, 8);
            btnPrimary.Click += (s, e) => OnPrimary();
            bp.Children.Add(btnSecondary); bp.Children.Add(btnPrimary);
            Grid.SetColumn(bp, 1);
            foot.Children.Add(bp);
            Grid.SetRow(foot, 2);
            main.Children.Add(foot);

            content.Child = main;
            Grid.SetRow(content, 1);
            root.Children.Add(content);
            Content = root;
        }

        private Border BuildInfoCard() {
            Border card = CreateCard();
            Grid g = new Grid();
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            Grid ver = new Grid();
            ver.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            ver.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            ver.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            ver.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            StackPanel cur = new StackPanel();
            lblCurrent = new TextBlock { FontFamily = FontGothic, FontSize = 11, Foreground = BrushInkFaint };
            valCurrent = new TextBlock { FontFamily = FontRoman, FontSize = 26, Foreground = BrushInkSoft };
            cur.Children.Add(lblCurrent); cur.Children.Add(valCurrent);

            TextBlock arrow = new TextBlock { Text = "→", FontSize = 22, Foreground = BrushInkFaint, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(22, 0, 22, 4) };

            StackPanel lat = new StackPanel();
            lblLatest = new TextBlock { FontFamily = FontGothic, FontSize = 11, Foreground = BrushShu };
            valLatest = new TextBlock { FontFamily = FontRoman, FontSize = 26, FontWeight = FontWeights.Bold, Foreground = BrushShu };
            lat.Children.Add(lblLatest); lat.Children.Add(valLatest);

            Grid.SetColumn(arrow, 1); Grid.SetColumn(lat, 2);
            ver.Children.Add(cur); ver.Children.Add(arrow); ver.Children.Add(lat);
            g.Children.Add(ver);

            txtMeta = new TextBlock { FontFamily = FontGothic, FontSize = 11, Foreground = BrushInkFaint, Margin = new Thickness(0, 6, 0, 0) };
            Grid.SetRow(txtMeta, 1);
            g.Children.Add(txtMeta);

            lblNotes = new TextBlock { FontFamily = FontGothic, FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = BrushInkSoft, Margin = new Thickness(0, 14, 0, 6) };
            Grid.SetRow(lblNotes, 2);
            g.Children.Add(lblNotes);

            txtNotes = new TextBlock { FontFamily = FontMincho, FontSize = 13, Foreground = BrushInk, LineHeight = 22, TextWrapping = TextWrapping.Wrap };
            ScrollViewer sv = new ScrollViewer {
                Content = txtNotes,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Padding = new Thickness(12, 8, 12, 8),
                Background = Brushes.White,
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(1),
                MinHeight = 60
            };
            Border svWrap = new Border { BorderBrush = BrushHair, BorderThickness = new Thickness(1), Child = sv };
            Grid.SetRow(svWrap, 3);
            g.Children.Add(svWrap);

            StackPanel bottom = new StackPanel { Margin = new Thickness(0, 12, 0, 0) };
            forcedBanner = new Border { Background = BrushShuWash, BorderBrush = BrushShu, BorderThickness = new Thickness(3, 0, 0, 0), Padding = new Thickness(12, 8, 12, 8) };
            txtForced = new TextBlock { FontFamily = FontGothic, FontSize = 12, Foreground = BrushShuHover, TextWrapping = TextWrapping.Wrap, LineHeight = 19 };
            forcedBanner.Child = txtForced;
            chkSnooze = new CheckBox { VerticalContentAlignment = VerticalAlignment.Center, Cursor = Cursors.Hand };
            txtSnooze = new TextBlock { FontFamily = FontGothic, FontSize = 12, Foreground = BrushInk, Margin = new Thickness(6, 0, 0, 0) };
            chkSnooze.Content = txtSnooze;
            bottom.Children.Add(forcedBanner); bottom.Children.Add(chkSnooze);
            Grid.SetRow(bottom, 4);
            g.Children.Add(bottom);

            card.Child = g;
            return card;
        }

        private Border BuildProgressCard() {
            Border card = CreateCard();
            StackPanel sp = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(20, 0, 20, 0) };
            txtProgressTitle = new TextBlock { FontFamily = FontMincho, FontSize = 16, FontWeight = FontWeights.Bold, Foreground = BrushInk, Margin = new Thickness(0, 0, 0, 16) };
            prgBar = new ProgressBar { Height = 8, Minimum = 0, Maximum = 100, Foreground = BrushShu, Background = new SolidColorBrush(Color.FromRgb(0xDC, 0xD3, 0xC1)), BorderBrush = BrushHair, BorderThickness = new Thickness(1) };
            Grid row = new Grid { Margin = new Thickness(0, 12, 0, 0) };
            txtProgressStatus = new TextBlock { FontFamily = FontGothic, FontSize = 12, Foreground = BrushInkSoft };
            txtProgressPct = new TextBlock { FontFamily = FontGothic, FontSize = 12, FontWeight = FontWeights.Bold, Foreground = BrushInk, HorizontalAlignment = HorizontalAlignment.Right };
            row.Children.Add(txtProgressStatus); row.Children.Add(txtProgressPct);
            sp.Children.Add(txtProgressTitle); sp.Children.Add(prgBar); sp.Children.Add(row);
            card.Child = sp;
            return card;
        }

        private Border BuildMessageCard() {
            Border card = CreateCard();
            StackPanel sp = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
            sealMsg = new Border { Width = 64, Height = 64, BorderBrush = BrushShu, BorderThickness = new Thickness(2), HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 16) };
            txtSealMsg = new TextBlock { FontFamily = FontMincho, FontSize = 30, FontWeight = FontWeights.Bold, Foreground = BrushShu, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            sealMsg.Child = txtSealMsg;
            txtMsgTitle = new TextBlock { FontFamily = FontMincho, FontSize = 19, FontWeight = FontWeights.Bold, Foreground = BrushInk, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 10) };
            txtMsgDesc = new TextBlock { FontFamily = FontMincho, FontSize = 13, Foreground = BrushInkSoft, LineHeight = 22, TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap, MaxWidth = 520 };
            sp.Children.Add(sealMsg); sp.Children.Add(txtMsgTitle); sp.Children.Add(txtMsgDesc);
            card.Child = sp;
            return card;
        }

        private void Render() {
            Title = T("模擬庭提問陪伴台帳 — 更新案內", "Debate Companion Desk — Update Guide");
            txtTitleBar.Text = Title.Replace(" — ", " ・ ");
            btnToggleLang.Content = lang == "en" ? "切換繁體中文" : "English";
            txtKicker.Text = "MOOT COURT COMPANION DESK / UPDATE SUITE";

            cardInfo.Visibility = state == UpState.Available ? Visibility.Visible : Visibility.Collapsed;
            cardProgress.Visibility = state == UpState.Downloading || state == UpState.Checking ? Visibility.Visible : Visibility.Collapsed;
            cardMessage.Visibility = (state == UpState.UpToDate || state == UpState.CheckError || state == UpState.DownloadError || state == UpState.Launching) ? Visibility.Visible : Visibility.Collapsed;
            btnSecondary.Visibility = Visibility.Visible;
            btnPrimary.Visibility = Visibility.Visible;
            btnPrimary.IsEnabled = true;
            btnClose.IsEnabled = true;
            txtFootNote.Text = "© DEBATE COMPANION DESK / wason.dev";

            string latest = manifest != null ? "v" + UpdateCommon.ParseVersion(manifest.Version).ToString(3) : "";
            string current = "v" + UpdateCommon.ParseVersion(currentVersion).ToString(3);

            switch (state) {
                case UpState.Checking:
                    txtPageTitle.Text = T("正在檢查更新", "Checking for Updates");
                    txtPageLead.Text = T("正在向 wason.dev 伺服器查詢是否有新版本的模擬庭提問陪伴台帳…", "Querying update server for latest debate companion releases…");
                    txtProgressTitle.Text = T("連線至更新伺服器…", "Connecting to update server…");
                    prgBar.IsIndeterminate = true;
                    txtProgressStatus.Text = T("目前版本 ", "Current Version ") + current;
                    txtProgressPct.Text = "";
                    btnSecondary.Visibility = Visibility.Collapsed;
                    btnPrimary.Content = T("［ 關閉 ］", "［ Close ］");
                    btnPrimary.IsEnabled = false;
                    break;

                case UpState.UpToDate:
                    txtPageTitle.Text = T("已是最新版本", "Latest Version Installed");
                    txtPageLead.Text = T("您目前使用的模擬庭提問陪伴台帳已是最新版本，無須更新。", "Your debate companion desk application is up to date.");
                    txtSealMsg.Text = "新";
                    txtMsgTitle.Text = T("目前版本 ", "Current Version ") + current;
                    txtMsgDesc.Text = T("陪伴台帳會在每次啟動時自動為您守護最新發行版本。", "Companion desk automatically checks for newer releases upon launch.");
                    btnSecondary.Visibility = Visibility.Collapsed;
                    btnPrimary.Content = T("［ 關閉 ］", "［ Close ］");
                    break;

                case UpState.CheckError:
                    txtPageTitle.Text = T("無法檢查更新", "Unable to Check Updates");
                    txtPageLead.Text = T("暫時無法連線至更新伺服器，請確認網路連線後再試一次。", "Cannot reach update server. Please check your network and retry.");
                    txtSealMsg.Text = "斷";
                    txtMsgTitle.Text = T("連線失敗", "Connection Error");
                    txtMsgDesc.Text = (errorDetail ?? "") + "\n" + T("詳細記錄：", "Log: ") + UpdateCommon.LogPath;
                    btnSecondary.Content = T("［ 關閉 ］", "［ Close ］");
                    btnPrimary.Content = T("［ 重試 ］", "［ Retry ］");
                    break;

                case UpState.Available:
                    txtKicker.Text = forced ? "MOOT COURT COMPANION DESK / MANDATORY UPDATE" : "MOOT COURT COMPANION DESK / UPDATE SUITE";
                    txtPageTitle.Text = forced ? T("必須更新至新版本", "Mandatory Update Required") : T("發現新版本", "New Update Available");
                    txtPageLead.Text = forced
                        ? T("此版本的陪伴台帳已停止支援，請更新後再繼續演練。", "This version is deprecated. Please install update to continue moot court drills.")
                        : T("陪伴台帳有新版本可供更新，是否現在下載並安裝？演練紀錄、筆記與金鑰皆會保留。", "A newer release is available. Would you like to install now? All debate records and notes will be preserved.");
                    lblCurrent.Text = T("目前版本", "Current");
                    valCurrent.Text = current;
                    lblLatest.Text = T("最新版本", "Latest");
                    valLatest.Text = latest;
                    string meta = "";
                    if (!string.IsNullOrEmpty(manifest.ReleaseDate)) meta += T("發布日 ", "Release Date ") + manifest.ReleaseDate;
                    if (manifest.Size > 0) meta += (meta.Length > 0 ? "　｜　" : "") + T("下載大小 約 ", "Download Size ~") + UpdateCommon.FormatSize(manifest.Size);
                    txtMeta.Text = meta;
                    txtMeta.Visibility = meta.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
                    lblNotes.Text = T("更新內容", "Release Notes");
                    string notes = manifest.Notes(lang);
                    txtNotes.Text = string.IsNullOrEmpty(notes) ? T("（本次更新未附說明）", "(No release notes provided)") : notes;
                    forcedBanner.Visibility = forced ? Visibility.Visible : Visibility.Collapsed;
                    txtForced.Text = T("【強制更新】此為重要修正更新，請更新後再繼續使用陪伴台帳。", "【Mandatory Update】This release contains critical fixes and is required to continue.");
                    chkSnooze.Visibility = forced ? Visibility.Collapsed : Visibility.Visible;
                    txtSnooze.Text = T("暫不提醒此版本（7 天內不再提示）", "Snooze reminder for 7 days");
                    btnSecondary.Content = forced ? T("［ 結束台帳 ］", "［ Exit App ］") : T("［ 稍後再說 ］", "［ Later ］");
                    btnPrimary.Content = T("［ 立即下載並更新 ］", "［ Update Now ］");
                    txtFootNote.Text = forced ? "" : T("不勾選時，下次開啟台帳仍會提醒。", "If unchecked, you will be notified on next launch.");
                    break;

                case UpState.Downloading:
                    txtPageTitle.Text = T("正在下載新版本", "Downloading Update");
                    txtPageLead.Text = T("下載完成後將自動啟動安裝引導程式，並於更新後重新啟動陪伴台帳。", "After download, the installer will launch automatically and restart companion desk.");
                    txtProgressTitle.Text = T("正在下載 ", "Downloading ") + latest + T(" 安裝程式…", " Installer…");
                    prgBar.IsIndeterminate = false;
                    btnSecondary.Visibility = Visibility.Collapsed;
                    btnPrimary.Content = T("［ 取消下載 ］", "［ Cancel Download ］");
                    btnClose.IsEnabled = false;
                    break;

                case UpState.DownloadError:
                    txtPageTitle.Text = T("更新未完成", "Update Incomplete");
                    txtPageLead.Text = T("下載或驗證新版本時發生問題，目前的陪伴台帳不受影響。", "Download failed. Your current companion desk is unaffected.");
                    txtSealMsg.Text = "誤";
                    txtMsgTitle.Text = T("下載失敗", "Download Failed");
                    txtMsgDesc.Text = (errorDetail ?? "") + "\n" + T("詳細記錄：", "Log: ") + UpdateCommon.LogPath;
                    btnSecondary.Content = forced ? T("［ 結束台帳 ］", "［ Exit ］") : T("［ 稍後再說 ］", "［ Later ］");
                    btnPrimary.Content = T("［ 重試 ］", "［ Retry ］");
                    break;

                case UpState.Launching:
                    txtPageTitle.Text = T("準備安裝", "Launching Installer");
                    txtPageLead.Text = T("新版安裝引導程式已啟動，台帳將於更新完成後自動重新開啟。", "New installer launched. Companion desk will restart upon completion.");
                    txtSealMsg.Text = "完";
                    txtMsgTitle.Text = T("下載完成 ", "Downloaded ") + latest;
                    txtMsgDesc.Text = T("正在交由安裝引導程式完成無縫升級…", "Handing over to installer for seamless upgrade…");
                    btnSecondary.Visibility = Visibility.Collapsed;
                    btnPrimary.Visibility = Visibility.Collapsed;
                    break;
            }
        }

        private async void OnPrimary() {
            switch (state) {
                case UpState.UpToDate: Close(); break;
                case UpState.CheckError: await CheckAsync(); break;
                case UpState.Available:
                case UpState.DownloadError: await DownloadAndLaunchAsync(); break;
                case UpState.Downloading: cancelRequested = true; break;
            }
        }

        private void OnSecondary() { Close(); }

        private void OnClosingWindow(System.ComponentModel.CancelEventArgs e) {
            if (state == UpState.Downloading) { e.Cancel = true; return; }
            if (state == UpState.Launching) return;
            if (manifest != null && (state == UpState.Available || state == UpState.DownloadError)) {
                if (forced) {
                    exitCode = UpdateCommon.ExitForcedDeclined;
                } else {
                    var st = UpdateState.Load();
                    st.SnoozeUntilTicks = chkSnooze.IsChecked == true ? DateTime.UtcNow.AddDays(7).Ticks : 0;
                    st.Save();
                }
            }
        }

        private async Task DownloadAndLaunchAsync() {
            cancelRequested = false;
            state = UpState.Downloading; Render();
            prgBar.Value = 0;
            txtProgressStatus.Text = T("連線中…", "Connecting…");
            txtProgressPct.Text = "0%";
            string dest = UpdateCommon.InstallerDownloadPath(manifest);

            try {
                await Task.Run(() => {
                    UpdateCommon.CleanupOldDownloads();
                    bool reuse = false;
                    if (File.Exists(dest)) {
                        try { UpdateCommon.VerifyInstaller(dest, manifest); reuse = !string.IsNullOrEmpty(manifest.Sha256); } catch { }
                    }
                    if (!reuse) {
                        UpdateCommon.DownloadFile(manifest.InstallerUrl, dest, manifest.Size, (done, total) => {
                            Dispatcher.BeginInvoke(new Action(() => {
                                int pct = total > 0 ? (int)(done * 100 / total) : 0;
                                prgBar.Value = pct;
                                txtProgressPct.Text = total > 0 ? pct + "%" : "";
                                txtProgressStatus.Text = UpdateCommon.FormatSize(done) + (total > 0 ? " / " + UpdateCommon.FormatSize(total) : "");
                            }));
                        }, () => cancelRequested);
                    }
                    Dispatcher.Invoke(() => { txtProgressStatus.Text = T("正在驗證檔案完整性…", "Verifying file integrity…"); });
                    UpdateCommon.VerifyInstaller(dest, manifest);
                });
            } catch (OperationCanceledException) {
                try { File.Delete(dest + ".part"); } catch { }
                state = UpState.Available; Render();
                return;
            } catch (Exception ex) {
                UpdateCommon.Log("Download failed: " + ex);
                try { File.Delete(dest); } catch { }
                errorDetail = ex is InvalidDataException
                    ? T("下載的檔案未通過完整性驗證（可能下載不完整或遭竄改）。", "Downloaded file failed verification.")
                    : ex.Message;
                state = UpState.DownloadError; Render();
                return;
            }

            try {
                Process.Start(new ProcessStartInfo {
                    FileName = dest,
                    Arguments = "--update-mode --no-self-update --lang " + lang,
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(dest)
                });
                var st = UpdateState.Load(); st.SnoozeUntilTicks = 0; st.Save();
                UpdateCommon.Log("Launched installer " + dest);
            } catch (Exception ex) {
                UpdateCommon.Log("Launch installer failed: " + ex);
                errorDetail = ex.Message;
                state = UpState.DownloadError; Render();
                return;
            }
            exitCode = UpdateCommon.ExitInstallerLaunched;
            state = UpState.Launching; Render();
            await Task.Delay(1200);
            Close();
        }

        private void SaveLang() {
            var st = UpdateState.Load(); st.Lang = lang; st.Save();
        }

        private Border CreateCard() {
            return new Border { Background = BrushPaperCard, BorderBrush = BrushHair, BorderThickness = new Thickness(1), Padding = new Thickness(28, 22, 28, 20), Visibility = Visibility.Collapsed };
        }

        private Button CreateTitleBarButton(string text, double fontSize) {
            Button b = new Button {
                Content = text, FontSize = fontSize, FontFamily = FontGothic,
                Foreground = new SolidColorBrush(Color.FromRgb(0xCB, 0xBF, 0xA8)), Background = Brushes.Transparent,
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x55, 0x4A, 0x3E)), BorderThickness = new Thickness(1),
                Padding = new Thickness(8, 2, 8, 2), Margin = new Thickness(0, 0, 10, 0), Cursor = Cursors.Hand
            };
            b.MouseEnter += (s, e) => b.Background = new SolidColorBrush(Color.FromRgb(0x2C, 0x25, 0x1F));
            b.MouseLeave += (s, e) => b.Background = Brushes.Transparent;
            return b;
        }

        private Button CreateGlyphButton(string glyph, double fontSize) {
            var idle = new SolidColorBrush(Color.FromRgb(0x8C, 0x82, 0x70));
            Button b = new Button {
                Content = glyph, FontSize = fontSize, FontFamily = FontMincho, Foreground = idle,
                Background = Brushes.Transparent, BorderThickness = new Thickness(0), Width = 32, Height = 32, Cursor = Cursors.Hand
            };
            b.MouseEnter += (s, e) => { b.Background = glyph == "✕" ? BrushShu : new SolidColorBrush(Color.FromRgb(0x2C, 0x25, 0x1F)); b.Foreground = Brushes.White; };
            b.MouseLeave += (s, e) => { b.Background = Brushes.Transparent; b.Foreground = idle; };
            return b;
        }

        private Button CreateOutlinedButton(string text, double fontSize) {
            Button b = new Button {
                Content = text, FontSize = fontSize, FontFamily = FontGothic, FontWeight = FontWeights.SemiBold,
                Foreground = BrushInk, Background = Brushes.Transparent, BorderBrush = BrushRule, BorderThickness = new Thickness(1), Cursor = Cursors.Hand
            };
            b.MouseEnter += (s, e) => { b.Background = BrushInk; b.Foreground = BrushPaper; };
            b.MouseLeave += (s, e) => { b.Background = Brushes.Transparent; b.Foreground = BrushInk; };
            return b;
        }

        private Button CreateVermilionButton(string text, double fontSize) {
            Button b = new Button {
                Content = text, FontSize = fontSize, FontFamily = FontGothic, FontWeight = FontWeights.Bold,
                Foreground = Brushes.White, Background = BrushShu, BorderBrush = BrushShu, BorderThickness = new Thickness(1), Cursor = Cursors.Hand
            };
            b.MouseEnter += (s, e) => { b.Background = BrushShuHover; b.BorderBrush = BrushShuHover; };
            b.MouseLeave += (s, e) => { b.Background = BrushShu; b.BorderBrush = BrushShu; };
            return b;
        }
    }

    public static class Program {
        [STAThread]
        public static int Main(string[] args) {
            bool manual = false;
            string appVersion = null, lang = null;
            for (int i = 0; i < args.Length; i++) {
                string a = args[i].ToLowerInvariant();
                if (a == "--manual") manual = true;
                else if (a == "--app-version" && i + 1 < args.Length) appVersion = args[++i];
                else if (a == "--lang" && i + 1 < args.Length) lang = args[++i];
            }
            if (string.IsNullOrEmpty(appVersion)) appVersion = ReadInstalledVersion() ?? UpdateCommon.CurrentBuildVersion;
            UpdateState state = UpdateState.Load();
            if (string.IsNullOrEmpty(lang)) lang = state.Lang ?? "zh";

            bool createdNew;
            using (Mutex mutex = new Mutex(true, @"Local\DebateCompanionDeskUpdater", out createdNew)) {
                if (!createdNew) return UpdateCommon.ExitNoAction;

                UpdateManifest m = null;
                if (!manual) {
                    try { m = UpdateCommon.FetchManifest(8000); }
                    catch (Exception ex) { UpdateCommon.Log("Auto check failed: " + ex.Message); return UpdateCommon.ExitNoAction; }
                    if (!UpdateCommon.IsNewer(m.Version, appVersion)) {
                        return UpdateCommon.ExitNoAction;
                    }
                    bool forced = m.IsForcedFor(appVersion);
                    if (!forced && state.IsSnoozed) {
                        return UpdateCommon.ExitNoAction;
                    }
                }

                var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
                app.DispatcherUnhandledException += (s, e) => { UpdateCommon.Log("Unhandled: " + e.Exception); e.Handled = true; };
                var win = new UpdaterWindow(manual, appVersion, m, lang);
                win.Closed += (s, e) => Environment.Exit(win.ExitCode);
                app.Run(win);
                Environment.Exit(win.ExitCode);
                return win.ExitCode;
            }
        }

        private static string ReadInstalledVersion() {
            try {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DebateCompanion")) {
                    return k != null ? k.GetValue("DisplayVersion") as string : null;
                }
            } catch { return null; }
        }
    }
}
