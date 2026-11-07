using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

// 模擬庭提問陪伴台帳 ・ 線上更新與安裝共用函式庫
// 版本號與更新清單網址由 build_installer.ps1 產生的 BuildInfo.g.cs 提供
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

        public string Notes(string lang) {
            string n = (lang == "en") ? NotesEn : NotesZh;
            return string.IsNullOrEmpty(n) ? (NotesZh ?? NotesEn ?? "") : n;
        }

        // 強制更新：清單標示 mandatory，或目前版本低於最低支援版本
        public bool IsForcedFor(string currentVersion) {
            if (!UpdateCommon.IsNewer(Version, currentVersion)) return false;
            if (Mandatory) return true;
            return !string.IsNullOrEmpty(MinimumVersion) && UpdateCommon.IsNewer(MinimumVersion, currentVersion);
        }
    }

    public static class UpdateCommon {
        public const int ExitNoAction = 0;
        public const int ExitInstallerLaunched = 10;
        public const int ExitForcedDeclined = 20;

        static UpdateCommon() {
            // .NET Framework 4.x 預設不啟用 TLS 1.2，GitHub 等主機會拒絕連線
            try {
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072 | (SecurityProtocolType)12288;
            } catch {
                try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch { }
            }
        }

        public static string CurrentBuildVersion { get { return BuildInfo.Version; } }

        // 可用環境變數 DEBATE_UPDATE_URL 覆寫
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

        public static string DownloadDir {
            get {
                string d = Path.Combine(Path.GetTempPath(), "DebateCompanionUpdate");
                try { Directory.CreateDirectory(d); } catch { }
                return d;
            }
        }

        public static readonly string LogPath = Path.Combine(Path.GetTempPath(), "DebateCompanionUpdate.log");
        public static void Log(string msg) {
            try { File.AppendAllText(LogPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + Environment.NewLine); } catch { }
        }

        // ───── 版本比較 ─────
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

        // ───── 取得線上更新清單 ─────
        public static UpdateManifest FetchManifest(int timeoutMs) {
            string url = ManifestUrl;
            if (string.IsNullOrEmpty(url)) throw new InvalidOperationException("Update manifest URL not configured");
            if (url.StartsWith("http", StringComparison.OrdinalIgnoreCase)) {
                url += (url.Contains("?") ? "&" : "?") + "t=" + DateTime.UtcNow.Ticks;
            }
            WebRequest req = WebRequest.Create(url);
            req.Timeout = timeoutMs;
            HttpWebRequest http = req as HttpWebRequest;
            if (http != null) {
                http.ReadWriteTimeout = timeoutMs;
                http.UserAgent = "DebateCompanion-Updater/" + CurrentBuildVersion;
                http.AllowAutoRedirect = true;
                http.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            }
            string json;
            using (WebResponse resp = req.GetResponse())
            using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) {
                json = sr.ReadToEnd();
            }
            return ParseManifest(json);
        }

        public static UpdateManifest ParseManifest(string json) {
            var ser = new JavaScriptSerializer();
            var d = ser.DeserializeObject(json.TrimStart('\uFEFF')) as Dictionary<string, object>;
            if (d == null) throw new FormatException("Invalid manifest");
            var m = new UpdateManifest {
                Version = Str(d, "version"),
                MinimumVersion = Str(d, "minimumVersion"),
                Mandatory = Bool(d, "mandatory"),
                InstallerUrl = Str(d, "installerUrl"),
                Sha256 = Str(d, "sha256"),
                ReleaseDate = Str(d, "releaseDate")
            };
            long size; long.TryParse(Str(d, "size") ?? "0", out size); m.Size = size;
            object notes;
            if (d.TryGetValue("notes", out notes)) {
                var nd = notes as Dictionary<string, object>;
                if (nd != null) { m.NotesZh = Str(nd, "zh"); m.NotesEn = Str(nd, "en"); }
                else if (notes != null) { m.NotesZh = m.NotesEn = notes.ToString(); }
            }
            if (string.IsNullOrEmpty(m.Version) || string.IsNullOrEmpty(m.InstallerUrl))
                throw new FormatException("Manifest missing version or installerUrl");
            return m;
        }

        static string Str(Dictionary<string, object> d, string k) {
            object v; return d.TryGetValue(k, out v) && v != null ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : null;
        }
        static bool Bool(Dictionary<string, object> d, string k) {
            object v; if (!d.TryGetValue(k, out v) || v == null) return false;
            if (v is bool) return (bool)v;
            bool b; return bool.TryParse(v.ToString(), out b) && b;
        }

        // ───── 下載與驗證 ─────
        public static void DownloadFile(string url, string dest, long expectedSize, Action<long, long> progress, Func<bool> cancel) {
            string part = dest + ".part";
            WebRequest req = WebRequest.Create(url);
            req.Timeout = 30000;
            HttpWebRequest http = req as HttpWebRequest;
            if (http != null) {
                http.ReadWriteTimeout = 60000;
                http.UserAgent = "DebateCompanion-Updater/" + CurrentBuildVersion;
                http.AllowAutoRedirect = true;
            }
            using (WebResponse resp = req.GetResponse()) {
                long total = resp.ContentLength > 0 ? resp.ContentLength : expectedSize;
                using (Stream src = resp.GetResponseStream())
                using (FileStream fs = new FileStream(part, FileMode.Create, FileAccess.Write)) {
                    byte[] buf = new byte[81920];
                    long done = 0;
                    int read;
                    DateTime last = DateTime.MinValue;
                    while ((read = src.Read(buf, 0, buf.Length)) > 0) {
                        if (cancel != null && cancel()) throw new OperationCanceledException();
                        fs.Write(buf, 0, read);
                        done += read;
                        if (progress != null && (DateTime.Now - last).TotalMilliseconds > 120) {
                            last = DateTime.Now;
                            progress(done, total);
                        }
                    }
                    if (progress != null) progress(done, total);
                }
            }
            if (File.Exists(dest)) File.Delete(dest);
            File.Move(part, dest);
        }

        public static string Sha256Of(string path) {
            using (var sha = SHA256.Create())
            using (var fs = File.OpenRead(path)) {
                byte[] h = sha.ComputeHash(fs);
                var sb = new StringBuilder(h.Length * 2);
                foreach (byte b in h) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        public static void VerifyInstaller(string path, UpdateManifest m) {
            using (var fs = File.OpenRead(path)) {
                if (fs.Length < 1024 || fs.ReadByte() != 'M' || fs.ReadByte() != 'Z')
                    throw new InvalidDataException("Downloaded file is not a valid executable");
            }
            if (!string.IsNullOrEmpty(m.Sha256)) {
                string actual = Sha256Of(path);
                if (!string.Equals(actual, m.Sha256.Trim(), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("SHA-256 mismatch");
            }
        }

        public static string InstallerDownloadPath(UpdateManifest m) {
            return Path.Combine(DownloadDir, "DebateCompanionSetup-" + ParseVersion(m.Version).ToString(3) + ".exe");
        }

        public static void CleanupOldDownloads() {
            try {
                string self = System.Reflection.Assembly.GetExecutingAssembly().Location;
                foreach (string f in Directory.GetFiles(DownloadDir)) {
                    if (string.Equals(f, self, StringComparison.OrdinalIgnoreCase)) continue;
                    try { if ((DateTime.Now - File.GetLastWriteTime(f)).TotalDays > 1) File.Delete(f); } catch { }
                }
            } catch { }
        }

        public static string FormatSize(long bytes) {
            if (bytes <= 0) return "—";
            return (bytes / 1024.0 / 1024.0).ToString("0.0") + " MB";
        }

        public static string Quote(string arg) {
            return "\"" + (arg ?? "").Replace("\"", "\\\"") + "\"";
        }

        [DllImport("shell32.dll")]
        public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

        public static void NotifyShell() {
            try {
                SHChangeNotify(0x08000000, 0x1000, IntPtr.Zero, IntPtr.Zero);
            } catch { }
        }
    }

    public class UpdateState {
        public long SnoozeUntilTicks;
        public string Lang;

        static string FilePath { get { return Path.Combine(UpdateCommon.StateDir, "update-state.json"); } }

        public static UpdateState Load() {
            var s = new UpdateState();
            try {
                if (File.Exists(FilePath)) {
                    var d = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(FilePath, Encoding.UTF8)) as Dictionary<string, object>;
                    if (d != null) {
                        object v;
                        if (d.TryGetValue("snoozeUntil", out v) && v != null) {
                            DateTime dt;
                            if (DateTime.TryParse(v.ToString(), System.Globalization.CultureInfo.InvariantCulture,
                                System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out dt))
                                s.SnoozeUntilTicks = dt.Ticks;
                        }
                        if (d.TryGetValue("lang", out v) && v != null) s.Lang = v.ToString();
                    }
                }
            } catch (Exception ex) { UpdateCommon.Log("State load failed: " + ex.Message); }
            return s;
        }

        public void Save() {
            try {
                var d = new Dictionary<string, object>();
                if (SnoozeUntilTicks > 0) d["snoozeUntil"] = new DateTime(SnoozeUntilTicks, DateTimeKind.Utc).ToString("o");
                if (!string.IsNullOrEmpty(Lang)) d["lang"] = Lang;
                File.WriteAllText(FilePath, new JavaScriptSerializer().Serialize(d), new UTF8Encoding(false));
            } catch (Exception ex) { UpdateCommon.Log("State save failed: " + ex.Message); }
        }

        public bool IsSnoozed { get { return SnoozeUntilTicks > DateTime.UtcNow.Ticks; } }
        public DateTime SnoozeUntilLocal { get { return new DateTime(SnoozeUntilTicks, DateTimeKind.Utc).ToLocalTime(); } }
    }
}
