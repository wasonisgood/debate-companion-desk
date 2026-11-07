using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shell;
using Microsoft.Win32;
using DebateCompanion;

namespace DebateCompanionUninstaller {
    public class UninstallerWindow : Window {
        private string currentLang = "zh";

        // 色彩配置（典雅和風宣紙與朱砂紅）
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

        // 挽留與問卷卡片
        private Border cardSurvey;
        private Border cardProgress;
        private Border cardFarewell;

        // 挽留選項
        private TextBlock txtRetainTitle;
        private TextBlock txtRetainDesc;
        private Button btnRetainApp;
        private Button btnResetCacheOnly;

        // 問卷題目
        private TextBlock txtSurveyLabel;
        private CheckBox chkReason1;
        private TextBlock txtReason1;
        private CheckBox chkReason2;
        private TextBlock txtReason2;
        private CheckBox chkReason3;
        private TextBlock txtReason3;
        private CheckBox chkReason4;
        private TextBlock txtReason4;
        private TextBox txtFeedback;

        // 底部按鈕
        private TextBlock txtFootNote;
        private Button btnCancel;
        private Button btnConfirmUninstall;

        // 進度步驟元件
        private TextBlock txtProgressTitle;
        private ProgressBar prgBar;
        private TextBlock txtProgressStatus;
        private TextBlock txtProgressPct;

        // 道別完成元件
        private TextBlock txtFarewellTitle;
        private TextBlock txtFarewellDesc;
        private Button btnFarewellClose;

        private Button btnMaximize;
        private bool isMaximized = false;
        private Rect normalBounds;

        public UninstallerWindow() {
            Title = "模擬庭提問陪伴台帳 ・ 解除安裝指南";
            Width = 820;
            Height = 590;
            MinWidth = 700;
            MinHeight = 500;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.CanResizeWithGrip;
            Background = BrushPaper;
            Foreground = BrushInk;
            FontFamily = FontMincho;

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
            UpdateLanguage();
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

            // 2. 自適應內容區
            Border contentBorder = new Border {
                Padding = new Thickness(40, 26, 40, 24),
                Background = BrushPaper
            };

            Grid mainGrid = new Grid();
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            // Header 區域
            StackPanel headerStack = new StackPanel { Margin = new Thickness(0, 0, 0, 16) };
            txtKicker = new TextBlock {
                FontFamily = FontRoman,
                FontSize = 11,
                Foreground = BrushInkFaint,
                Margin = new Thickness(0, 0, 0, 4),
                Text = "MOOT COURT COMPANION DESK / UNINSTALLATION & FAREWELL"
            };
            txtPageTitle = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 24,
                FontWeight = FontWeights.Bold,
                Foreground = BrushInk,
                Margin = new Thickness(0, 0, 0, 6)
            };
            txtPageLead = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 12.5,
                Foreground = BrushInkSoft,
                LineHeight = 20
            };
            Border headerLine = new Border {
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(0, 0, 0, 1),
                Margin = new Thickness(0, 12, 0, 0)
            };

            headerStack.Children.Add(txtKicker);
            headerStack.Children.Add(txtPageTitle);
            headerStack.Children.Add(txtPageLead);
            headerStack.Children.Add(headerLine);
            Grid.SetRow(headerStack, 0);
            mainGrid.Children.Add(headerStack);

            // 中央卡片容器
            Grid cardContainer = new Grid {
                VerticalAlignment = VerticalAlignment.Stretch,
                HorizontalAlignment = HorizontalAlignment.Stretch
            };

            // 卡片 1：挽留與離別問卷卡片
            cardSurvey = CreateStepCard();
            ScrollViewer surveyScroll = new ScrollViewer {
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
            };

            StackPanel surveyStack = new StackPanel();

            // 挽回區塊
            Border retainBox = new Border {
                Background = new SolidColorBrush(Color.FromRgb(0xFC, 0xFA, 0xF5)),
                BorderBrush = BrushShu,
                BorderThickness = new Thickness(1),
                Padding = new Thickness(18, 14, 18, 14),
                Margin = new Thickness(0, 0, 0, 18)
            };
            Grid retainGrid = new Grid();
            retainGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            retainGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            StackPanel retainTextStack = new StackPanel();
            txtRetainTitle = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 14,
                FontWeight = FontWeights.Bold,
                Foreground = BrushShu,
                Margin = new Thickness(0, 0, 0, 4)
            };
            txtRetainDesc = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 12,
                Foreground = BrushInkSoft,
                LineHeight = 18
            };
            retainTextStack.Children.Add(txtRetainTitle);
            retainTextStack.Children.Add(txtRetainDesc);
            Grid.SetColumn(retainTextStack, 0);
            retainGrid.Children.Add(retainTextStack);

            StackPanel retainBtnStack = new StackPanel {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };
            btnRetainApp = CreateVermilionButton("［ 留步保留台帳 ］", 12);
            btnRetainApp.Padding = new Thickness(16, 7, 16, 7);
            btnRetainApp.Click += (s, e) => Close();

            btnResetCacheOnly = CreateOutlinedButton("［ 僅重設演練快取 ］", 11);
            btnResetCacheOnly.Padding = new Thickness(12, 6, 12, 6);
            btnResetCacheOnly.Margin = new Thickness(8, 0, 0, 0);
            btnResetCacheOnly.Click += (s, e) => DoResetCache();

            retainBtnStack.Children.Add(btnRetainApp);
            retainBtnStack.Children.Add(btnResetCacheOnly);
            Grid.SetColumn(retainBtnStack, 1);
            retainGrid.Children.Add(retainBtnStack);

            retainBox.Child = retainGrid;
            surveyStack.Children.Add(retainBox);

            // 問卷題目區塊
            txtSurveyLabel = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = BrushInk,
                Margin = new Thickness(0, 0, 0, 10)
            };
            surveyStack.Children.Add(txtSurveyLabel);

            chkReason1 = CreateReasonCheck(out txtReason1);
            chkReason2 = CreateReasonCheck(out txtReason2);
            chkReason3 = CreateReasonCheck(out txtReason3);
            chkReason4 = CreateReasonCheck(out txtReason4);

            surveyStack.Children.Add(chkReason1);
            surveyStack.Children.Add(chkReason2);
            surveyStack.Children.Add(chkReason3);
            surveyStack.Children.Add(chkReason4);

            txtFeedback = new TextBox {
                Height = 44,
                FontFamily = FontGothic,
                FontSize = 12,
                Foreground = BrushInk,
                Background = Brushes.White,
                BorderBrush = BrushHair,
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 10, 0, 0),
                TextWrapping = TextWrapping.Wrap,
                AcceptsReturn = true,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto
            };
            surveyStack.Children.Add(txtFeedback);

            surveyScroll.Content = surveyStack;
            cardSurvey.Child = surveyScroll;

            // 卡片 2：卸載進度展示
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

            // 卡片 3：道別完成畫面
            cardFarewell = CreateStepCard();
            cardFarewell.Visibility = Visibility.Collapsed;
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
                Text = "緣",
                FontFamily = FontMincho,
                FontSize = 30,
                FontWeight = FontWeights.Bold,
                Foreground = BrushShu,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            sealLarge.Child = txtSealLarge;

            txtFarewellTitle = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 20,
                FontWeight = FontWeights.Bold,
                Foreground = BrushInk,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 10)
            };

            txtFarewellDesc = new TextBlock {
                FontFamily = FontMincho,
                FontSize = 13,
                Foreground = BrushInkSoft,
                LineHeight = 22,
                TextAlignment = TextAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 20)
            };

            btnFarewellClose = CreateVermilionButton("［ 關閉並告別 ］", 13);
            btnFarewellClose.Padding = new Thickness(30, 8, 30, 8);
            btnFarewellClose.HorizontalAlignment = HorizontalAlignment.Center;
            btnFarewellClose.Click += (s, e) => FinalizeSelfDeleteAndClose();

            cmpStack.Children.Add(sealLarge);
            cmpStack.Children.Add(txtFarewellTitle);
            cmpStack.Children.Add(txtFarewellDesc);
            cmpStack.Children.Add(btnFarewellClose);
            cardFarewell.Child = cmpStack;

            cardContainer.Children.Add(cardSurvey);
            cardContainer.Children.Add(cardProgress);
            cardContainer.Children.Add(cardFarewell);
            Grid.SetRow(cardContainer, 1);
            mainGrid.Children.Add(cardContainer);

            // 底部按鈕區
            Grid footGrid = new Grid { Margin = new Thickness(0, 16, 0, 0) };
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

            btnCancel = CreateVermilionButton("［ 留步保留 ］", 12);
            btnCancel.Padding = new Thickness(22, 8, 22, 8);
            btnCancel.Margin = new Thickness(0, 0, 12, 0);
            btnCancel.Click += (s, e) => Close();

            btnConfirmUninstall = CreateOutlinedButton("［ 忍痛徹底解除安裝 ］", 12);
            btnConfirmUninstall.Padding = new Thickness(18, 8, 18, 8);
            btnConfirmUninstall.Click += (s, e) => StartUninstallWorkflow();

            btnPanel.Children.Add(btnCancel);
            btnPanel.Children.Add(btnConfirmUninstall);
            Grid.SetColumn(btnPanel, 1);
            footGrid.Children.Add(btnPanel);

            Grid.SetRow(footGrid, 2);
            mainGrid.Children.Add(footGrid);

            contentBorder.Child = mainGrid;
            Grid.SetRow(contentBorder, 1);
            rootGrid.Children.Add(contentBorder);

            Content = rootGrid;
        }

        private CheckBox CreateReasonCheck(out TextBlock txtLabel) {
            CheckBox chk = new CheckBox {
                Margin = new Thickness(0, 3, 0, 5),
                VerticalContentAlignment = VerticalAlignment.Center
            };
            txtLabel = new TextBlock {
                FontFamily = FontGothic,
                FontSize = 12,
                Foreground = BrushInk,
                Margin = new Thickness(6, 0, 0, 0)
            };
            chk.Content = txtLabel;
            return chk;
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
                Padding = new Thickness(28, 22, 28, 22),
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

        private void DoResetCache() {
            string[] userDataDirs = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "DebateCompanion"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "debate-companion-desk")
            };
            string[] cacheDirs = { "Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "GrShaderCache", "GPUPersistentCache", "ShaderCache", "Service Worker\\CacheStorage" };

            foreach (Process p in Process.GetProcessesByName("DebateCompanion")) {
                try { p.Kill(); p.WaitForExit(2000); } catch { }
            }
            foreach (Process p in Process.GetProcessesByName("辯論陪伴台帳")) {
                try { p.Kill(); p.WaitForExit(2000); } catch { }
            }

            foreach (string uData in userDataDirs) {
                if (!Directory.Exists(uData)) continue;
                foreach (string d in cacheDirs) {
                    try {
                        string full = Path.Combine(uData, d);
                        if (Directory.Exists(full)) Directory.Delete(full, true);
                    } catch { }
                }
            }

            string msg = (currentLang == "en")
                ? "Local temporary cache and search indexes have been cleared.\nYour debate database, memorials and settings are fully preserved!"
                : "已為您重設陪伴台帳的本機演練暫存與快取。\n您的爭點題庫、手稿筆記與雲端連線均已完整保留，您可隨時繼續秒開使用！";
            MessageBox.Show(msg, "Cache Cleared", MessageBoxButton.OK, MessageBoxImage.Information);
            Close();
        }

        private void UpdateLanguage() {
            bool en = currentLang == "en";
            Title = en ? "Debate Companion Desk — Uninstallation Setup" : "模擬庭提問陪伴台帳 — 解除安裝指南";
            btnToggleLang.Content = en ? "切換繁體中文" : "English";
            txtTitleBar.Text = en ? "Debate Companion Desk ・ Farewell & Uninstall" : "模擬庭提問陪伴台帳 ・ 告別與解除安裝";
            txtPageTitle.Text = en ? "Moot Court Bond ・ Stay With Us" : "法庭因緣 ・ 願君留步";
            txtPageLead.Text = en
                ? "Every oral argument and question intervention is a journey of growth. If the companion lacks anything, please share your thoughts; we always welcome your return."
                : "模擬法庭的詰問與攻防是一場精彩的思辨歷程。若台帳尚有不如意或不足之處，請惠賜您的寶貴意見；陪伴台帳隨時歡迎您的歸來。";
            txtRetainTitle.Text = en ? "【Retention Suggestion】Keep Companion for Future Drills?" : "【台帳挽留建議】是否願意繼續保留台帳？";
            txtRetainDesc.Text = en
                ? "Debate Companion takes only ~180 MB. Keeping it on your computer lets you practice 40-minute moot court simulations and verify case law anytime."
                : "本台帳僅佔約 180 MB 空間。日常保留於電腦中，日後若有爭點覆盤、口說演練或賽季備戰需求，隨時點擊即可秒開練習。";
            btnRetainApp.Content = en ? "［ Keep Companion ］" : "［ 留步保留台帳 ］";
            btnResetCacheOnly.Content = en ? "［ Reset Cache Only ］" : "［ 僅重設演練快取 ］";
            txtSurveyLabel.Text = en
                ? "Please tell us why you are uninstalling (Multiple selection allowed):"
                : "請告訴我們您選擇離別的主要原因（可多選，助我們精進改進）：";
            txtReason1.Text = en ? "The current debate season or moot court training has concluded" : "本次辯論賽事或模擬法庭培訓已圓滿結束";
            txtReason2.Text = en ? "Switched to using the wason.dev web version for practice" : "改用 wason.dev 網頁版進行線上演練";
            txtReason3.Text = en ? "Encountered speech recognition, TTS or connection difficulties" : "遇到提問中斷、語音朗讀或技術連線問題";
            txtReason4.Text = en ? "Clearing disk space or migrating computer environments" : "整理電腦硬碟儲存空間或更換電腦設備";
            txtFeedback.ToolTip = en ? "Optional feedback or suggestions…" : "若有其他寶貴建議，歡迎於此留言惠賜...";
            btnCancel.Content = en ? "［ I'll think about it, Keep ］" : "［ 我再想想，保留台帳 ］";
            btnConfirmUninstall.Content = en ? "［ Confirm Uninstall ］" : "［ 忍痛徹底解除安裝 ］";
            txtProgressTitle.Text = en ? "Erasing Companion Files and Registrations…" : "正在抹除台帳登記與印記檔案...";
            txtFarewellTitle.Text = en ? "Uninstallation Succeeded" : "台帳配置已順利解除";
            txtFarewellDesc.Text = en
                ? "Debate Companion Desk has been completely removed from your computer.\nThank you for practicing with us. Wishing you persuasive oral arguments and victory in court!"
                : "「模擬庭提問陪伴台帳」已完全自您的電腦中解除安裝。\n感謝這段時光您與台帳的相遇。願賽事順遂、論理精闢，期待未來在辯論賽場與法庭上再度重逢。";
            btnFarewellClose.Content = en ? "［ Close and Farewell ］" : "［ 關閉並告別 ］";
        }

        private async void StartUninstallWorkflow() {
            cardSurvey.Visibility = Visibility.Collapsed;
            cardProgress.Visibility = Visibility.Visible;
            btnCancel.Visibility = Visibility.Collapsed;
            btnConfirmUninstall.IsEnabled = false;

            await Task.Run(() => PerformUninstallation());

            cardProgress.Visibility = Visibility.Collapsed;
            cardFarewell.Visibility = Visibility.Visible;

            txtPageTitle.Text = (currentLang == "en") ? "Uninstallation Complete" : "解除安裝完畢";
            txtPageLead.Text = (currentLang == "en")
                ? "All registrations and core resources have been completely erased."
                : "所有登錄檔資訊與台帳核心檔案已完全抹除完畢。";
        }

        private void UpdateProgress(int pct, string status) {
            Dispatcher.Invoke(() => {
                prgBar.Value = pct;
                txtProgressPct.Text = pct + "%";
                txtProgressStatus.Text = status;
            });
        }

        private void PerformUninstallation() {
            bool en = currentLang == "en";
            UpdateProgress(15, en ? "Stopping running Companion processes…" : "正在終止背景執行之台帳行程...");
            Thread.Sleep(300);

            // 1. 關閉執行中行程
            string[] procNames = { "DebateCompanion", "DebateCompanionUpdater", "辯論陪伴台帳" };
            foreach (string pName in procNames) {
                foreach (Process p in Process.GetProcessesByName(pName)) {
                    try {
                        p.Kill();
                        p.WaitForExit(1500);
                    } catch { }
                }
            }

            // 2. 登錄檔抹除
            UpdateProgress(40, en ? "Removing Windows uninstall registration…" : "正在從 Windows 應用程式清單撤銷登記...");
            Thread.Sleep(300);
            try {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DebateCompanion", false);
            } catch { }
            try {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\debate-companion", false);
            } catch { }

            // 3. 捷徑抹除
            UpdateProgress(65, en ? "Deleting desktop and menu shortcuts…" : "正在移除桌面與開始功能表書誌印記...");
            Thread.Sleep(300);
            try {
                string deskPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "模擬庭提問陪伴台帳.lnk");
                if (File.Exists(deskPath)) File.Delete(deskPath);
                string deskOld = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "辯論陪伴台帳.lnk");
                if (File.Exists(deskOld)) File.Delete(deskOld);
            } catch { }

            try {
                string progDir = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                string lnk = Path.Combine(progDir, "模擬庭提問陪伴台帳.lnk");
                if (File.Exists(lnk)) File.Delete(lnk);
                string lnkOld = Path.Combine(progDir, "辯論陪伴台帳.lnk");
                if (File.Exists(lnkOld)) File.Delete(lnkOld);
            } catch { }

            // 4. 通知 Windows Shell 即刻刷新
            UpdateCommon.NotifyShell();

            // 5. 檔案系統刪除與殘留自毀批次
            UpdateProgress(90, en ? "Preparing target folder self-clean script…" : "正在排程抹除主程式與暫存目錄...");
            Thread.Sleep(300);

            string appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string batPath = Path.Combine(Path.GetTempPath(), "debate_uninstall_wipe_" + Guid.NewGuid().ToString("N") + ".bat");

            string batContent = string.Format(
                "@echo off\r\n" +
                ":retry\r\n" +
                "timeout /t 1 /nobreak >nul\r\n" +
                "rmdir /s /q \"{0}\" >nul 2>&1\r\n" +
                "if exist \"{0}\" goto retry\r\n" +
                "del \"%~f0\" >nul 2>&1\r\n", appDir);

            try {
                File.WriteAllText(batPath, batContent, Encoding.Default);
                ProcessStartInfo psi = new ProcessStartInfo {
                    FileName = batPath,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    UseShellExecute = true
                };
                Process.Start(psi);
            } catch (Exception ex) {
                UpdateCommon.Log("Wipe bat spawn failed: " + ex);
            }

            UpdateProgress(100, en ? "Uninstallation completed!" : "已順利完成解除安裝。");
            Thread.Sleep(200);
        }

        private void FinalizeSelfDeleteAndClose() {
            Close();
        }
    }

    public class App : Application {
        [STAThread]
        public static void Main(string[] args) {
            bool silent = false;
            if (args != null) {
                foreach (string a in args) {
                    if (string.Equals(a, "--silent", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(a, "/quiet", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase)) {
                        silent = true;
                        break;
                    }
                }
            }

            if (silent) {
                // 靜默模式直接執行
                SilentUninstall();
                return;
            }

            new App().Run(new UninstallerWindow());
        }

        private static void SilentUninstall() {
            string[] procNames = { "DebateCompanion", "DebateCompanionUpdater", "辯論陪伴台帳" };
            foreach (string pName in procNames) {
                foreach (Process p in Process.GetProcessesByName(pName)) {
                    try { p.Kill(); p.WaitForExit(1500); } catch { }
                }
            }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\DebateCompanion", false); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\debate-companion", false); } catch { }

            try {
                string deskPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "模擬庭提問陪伴台帳.lnk");
                if (File.Exists(deskPath)) File.Delete(deskPath);
                string startPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "模擬庭提問陪伴台帳.lnk");
                if (File.Exists(startPath)) File.Delete(startPath);
            } catch { }

            UpdateCommon.NotifyShell();

            string appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string batPath = Path.Combine(Path.GetTempPath(), "debate_uninstall_wipe_" + Guid.NewGuid().ToString("N") + ".bat");
            string batContent = string.Format(
                "@echo off\r\n:retry\r\ntimeout /t 1 /nobreak >nul\r\nrmdir /s /q \"{0}\" >nul 2>&1\r\nif exist \"{0}\" goto retry\r\ndel \"%~f0\" >nul 2>&1\r\n", appDir);
            try {
                File.WriteAllText(batPath, batContent, Encoding.Default);
                Process.Start(new ProcessStartInfo { FileName = batPath, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, UseShellExecute = true });
            } catch { }
        }
    }
}
