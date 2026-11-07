using System;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;

namespace DebateCompanion {
    public class UpdateManifest {
        public string Version;
        public string MinimumVersion;
        public bool Mandatory;
        public string InstallerUrl;
        public string Sha256;
        public long Size;
        public string ReleaseDate;
        public string NotesZh;
        public string NotesEn;

        public bool IsForcedFor(string currentVersion) {
            if (!UpdateCommon.IsNewer(Version, currentVersion)) return false;
            if (Mandatory) return true;
            return !string.IsNullOrEmpty(MinimumVersion) && UpdateCommon.IsNewer(MinimumVersion, currentVersion);
        }
    }

    public static class UpdateCommon {
        static UpdateCommon() {
            try {
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072 | (SecurityProtocolType)12288;
            } catch {
                try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch { }
            }
        }

        public static string CurrentBuildVersion { get { return BuildInfo.Version; } }
        public static string ManifestUrl {
            get {
                string env = Environment.GetEnvironmentVariable("DEBATE_UPDATE_URL");
                return string.IsNullOrEmpty(env) ? BuildInfo.ManifestUrl : env;
            }
        }

        public static string StateDir {
            get {
                string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "DebateCompanion");
                try { Directory.CreateDirectory(d); } catch { }
                return d;
            }
        }

        public static Version ParseVersion(string v) {
            if (string.IsNullOrEmpty(v)) return new Version(0, 0, 0);
            v = v.Trim().TrimStart('v', 'V');
            int cut = v.IndexOfAny(new[] { '-', '+', ' ' });
            if (cut >= 0) v = v.Substring(0, cut);
            string[] parts = v.Split('.');
            int[] n = new int[4];
            for (int i = 0; i < 4 && i < parts.Length; i++) {
                int x; int.TryParse(parts[i], out x); n[i] = Math.Max(0, x);
            }
            return new Version(n[0], n[1], n[2], n[3]);
        }

        public static bool IsNewer(string candidate, string current) {
            return ParseVersion(candidate) > ParseVersion(current);
        }

        public static UpdateManifest FetchManifest(int timeoutMs) {
            string url = ManifestUrl;
            if (string.IsNullOrEmpty(url)) return null;

            try {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.UserAgent = "DebateCompanionDesk/" + CurrentBuildVersion;
                req.Timeout = timeoutMs;
                using (WebResponse resp = req.GetResponse())
                using (Stream stream = resp.GetResponseStream())
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8)) {
                    string json = reader.ReadToEnd();
                    var ser = new JavaScriptSerializer();
                    var dict = ser.Deserialize<System.Collections.Generic.Dictionary<string, object>>(json);
                    if (dict == null) return null;

                    var m = new UpdateManifest();
                    m.Version = dict.ContainsKey("version") ? Convert.ToString(dict["version"]) : "";
                    m.MinimumVersion = dict.ContainsKey("minimumVersion") ? Convert.ToString(dict["minimumVersion"]) : "";
                    m.Mandatory = dict.ContainsKey("mandatory") && Convert.ToBoolean(dict["mandatory"]);
                    m.InstallerUrl = dict.ContainsKey("installerUrl") ? Convert.ToString(dict["installerUrl"]) : "";
                    m.Sha256 = dict.ContainsKey("sha256") ? Convert.ToString(dict["sha256"]) : "";
                    m.Size = dict.ContainsKey("size") ? Convert.ToInt64(dict["size"]) : 0;
                    m.ReleaseDate = dict.ContainsKey("releaseDate") ? Convert.ToString(dict["releaseDate"]) : "";

                    if (dict.ContainsKey("notes") && dict["notes"] is System.Collections.Generic.Dictionary<string, object>) {
                        var notesDict = (System.Collections.Generic.Dictionary<string, object>)dict["notes"];
                        if (notesDict.ContainsKey("zh")) m.NotesZh = Convert.ToString(notesDict["zh"]);
                        if (notesDict.ContainsKey("en")) m.NotesEn = Convert.ToString(notesDict["en"]);
                    }
                    return m;
                }
            } catch {
                return null;
            }
        }

        public static bool VerifySha256(string filePath, string expectedSha256) {
            if (string.IsNullOrEmpty(expectedSha256) || !File.Exists(filePath)) return false;
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(filePath)) {
                byte[] hash = sha.ComputeHash(stream);
                StringBuilder sb = new StringBuilder();
                foreach (byte b in hash) sb.Append(b.ToString("x2"));
                return string.Equals(sb.ToString(), expectedSha256.Trim(), StringComparison.OrdinalIgnoreCase);
            }
        }

        // ==========================================
        // Custom WPF UI Styling conforming to wason.dev
        // ==========================================
        public static readonly Color ColorPaper = Color.FromRgb(0xF1, 0xEC, 0xE2);
        public static readonly Color ColorPaper2 = Color.FromRgb(0xE7, 0xE0, 0xD2);
        public static readonly Color ColorPaper3 = Color.FromRgb(0xDD, 0xD4, 0xC3);
        public static readonly Color ColorPaperCard = Color.FromRgb(0xFA, 0xF7, 0xF2);
        public static readonly Color ColorInk = Color.FromRgb(0x1D, 0x1B, 0x17);
        public static readonly Color ColorInk2 = Color.FromRgb(0x4C, 0x48, 0x40);
        public static readonly Color ColorInk3 = Color.FromRgb(0x85, 0x7F, 0x73);
        public static readonly Color ColorRule = Color.FromRgb(0xCF, 0xC6, 0xB4);
        public static readonly Color ColorShu = Color.FromRgb(0xB9, 0x47, 0x2B);
        public static readonly Color ColorShuDark = Color.FromRgb(0x8E, 0x33, 0x20);

        public static Window CreateWindowShell(string windowTitle, double width, double height, out StackPanel bodyPanel, out StackPanel buttonPanel) {
            var win = new Window {
                Title = windowTitle,
                Width = width + 24,
                Height = height + 24,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                WindowStyle = WindowStyle.None,
                AllowsTransparency = true,
                Background = Brushes.Transparent,
                ResizeMode = ResizeMode.NoResize
            };

            var outerBorder = new Border {
                Margin = new Thickness(12),
                CornerRadius = new CornerRadius(10),
                Background = new SolidColorBrush(ColorPaper),
                BorderBrush = new SolidColorBrush(ColorRule),
                BorderThickness = new Thickness(1),
                Effect = new DropShadowEffect {
                    Color = Colors.Black,
                    BlurRadius = 18,
                    Opacity = 0.22,
                    ShadowDepth = 5
                }
            };

            var mainGrid = new Grid();
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(42, GridUnitType.Pixel) });
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            mainGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(56, GridUnitType.Pixel) });

            // TitleBar Header
            var header = new Border {
                Background = new SolidColorBrush(ColorPaper2),
                CornerRadius = new CornerRadius(10, 10, 0, 0),
                BorderBrush = new SolidColorBrush(ColorRule),
                BorderThickness = new Thickness(0, 0, 0, 1),
                Padding = new Thickness(12, 0, 8, 0)
            };
            header.MouseDown += (s, e) => {
                if (e.ChangedButton == MouseButton.Left) win.DragMove();
            };

            var headerGrid = new Grid();
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            // Seal + Title
            var titleBox = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            var seal = new Border {
                Width = 20,
                Height = 20,
                CornerRadius = new CornerRadius(3),
                Background = new SolidColorBrush(ColorShu),
                Margin = new Thickness(0, 0, 8, 0)
            };
            var sealText = new TextBlock {
                Text = "辯",
                Foreground = new SolidColorBrush(ColorPaper),
                FontSize = 11,
                FontWeight = FontWeights.Bold,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            seal.Child = sealText;
            titleBox.Children.Add(seal);

            var titleText = new TextBlock {
                Text = windowTitle,
                FontSize = 13,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(ColorInk),
                VerticalAlignment = VerticalAlignment.Center
            };
            titleBox.Children.Add(titleText);
            Grid.SetColumn(titleBox, 0);
            headerGrid.Children.Add(titleBox);

            // Close button
            var closeBtn = new Button {
                Content = "✕",
                Width = 28,
                Height = 28,
                Background = Brushes.Transparent,
                BorderBrush = Brushes.Transparent,
                Foreground = new SolidColorBrush(ColorInk2),
                FontSize = 12,
                Cursor = Cursors.Hand,
                VerticalAlignment = VerticalAlignment.Center
            };
            closeBtn.Click += (s, e) => win.Close();
            Grid.SetColumn(closeBtn, 2);
            headerGrid.Children.Add(closeBtn);

            header.Child = headerGrid;
            Grid.SetRow(header, 0);
            mainGrid.Children.Add(header);

            // Body Card
            var bodyBorder = new Border {
                Margin = new Thickness(16, 12, 16, 8),
                Padding = new Thickness(14),
                Background = new SolidColorBrush(ColorPaperCard),
                BorderBrush = new SolidColorBrush(ColorPaper3),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6)
            };
            bodyPanel = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            bodyBorder.Child = bodyPanel;
            Grid.SetRow(bodyBorder, 1);
            mainGrid.Children.Add(bodyBorder);

            // Button Footer
            var footer = new Border {
                Background = new SolidColorBrush(ColorPaper2),
                CornerRadius = new CornerRadius(0, 0, 10, 10),
                BorderBrush = new SolidColorBrush(ColorRule),
                BorderThickness = new Thickness(0, 1, 0, 0),
                Padding = new Thickness(16, 0, 16, 0)
            };
            buttonPanel = new StackPanel {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center
            };
            footer.Child = buttonPanel;
            Grid.SetRow(footer, 2);
            mainGrid.Children.Add(footer);

            outerBorder.Child = mainGrid;
            win.Content = outerBorder;
            return win;
        }

        public static Button CreateStyledButton(string text, bool isPrimary, double width = 110, double height = 32) {
            var btn = new Button {
                Content = text,
                Width = width,
                Height = height,
                Cursor = Cursors.Hand,
                FontWeight = isPrimary ? FontWeights.Bold : FontWeights.Normal,
                FontSize = 12,
                Margin = new Thickness(4, 0, 4, 0)
            };

            var bg = isPrimary ? new SolidColorBrush(ColorShu) : new SolidColorBrush(ColorPaper2);
            var fg = isPrimary ? Brushes.White : new SolidColorBrush(ColorInk);
            var border = isPrimary ? new SolidColorBrush(ColorShuDark) : new SolidColorBrush(ColorRule);

            btn.Background = bg;
            btn.Foreground = fg;
            btn.BorderBrush = border;
            btn.BorderThickness = new Thickness(1);

            return btn;
        }
    }
}
