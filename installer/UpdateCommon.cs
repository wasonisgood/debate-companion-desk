using System;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

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
    }
}
