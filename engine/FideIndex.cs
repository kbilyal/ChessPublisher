// Chess-Publisher r15 - fast FIDE directory + rating-list index (C# 5 / .NET Framework 4 compatible).
//
//  CP.FideIndex     : in-memory searchable index over the full FIDE LEGACY directory
//                     (players_legacy.txt, ~1.95M players incl. unrated). It replaces the old
//                     line-by-line PowerShell scan (many seconds per search) with a byte search over
//                     a compact lowercase buffer (milliseconds). The buffer is persisted next to the
//                     list in fide\.index so later launches only read one binary file.
//  CP.RatingsIndex  : parses standard/rapid/blitz once, merges them by FIDE ID and writes a compact
//                     NDJSON file that the UI streams instead of downloading + regex-parsing 3 x ~70 MB
//                     of text on every start.
//
// Both indexes are derived data: they are rebuilt automatically when the source list changes
// (length + last-write time signature) and are never the source of truth.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace CP
{
    public static class FideIndex
    {
        private sealed class Snapshot
        {
            public byte[] Hay;
            public int HayLen;
            public int[] LineStart;
            public long[] FileOff;
            public int Count;
            public string Header;
            public string Path;
        }

        private const int CacheMagic = 0x31494643; // "CFI1"
        private static readonly object Gate = new object();
        private static volatile Snapshot snap;
        private static ManualResetEvent readyEvent = new ManualResetEvent(false);
        private static bool loading;
        private static string lastError = "";
        private static string lastSource = "";
        private static long lastLoadMs;

        public static bool IsReady { get { return snap != null; } }
        public static int Count { get { Snapshot s = snap; return s == null ? 0 : s.Count; } }
        public static string Header { get { Snapshot s = snap; return s == null ? "" : s.Header; } }
        public static string Error { get { return lastError; } }
        public static string Source { get { return lastSource; } }
        public static long LoadMs { get { return lastLoadMs; } }

        public static bool WaitReady(int milliseconds)
        {
            if (snap != null) return true;
            return readyEvent.WaitOne(milliseconds) && snap != null;
        }

        /// <summary>Drop the in-memory index (e.g. after the source list was replaced) and reload in the background.</summary>
        public static void Reload(string fideFolder)
        {
            lock (Gate)
            {
                snap = null;
                readyEvent.Reset();
                loading = false;
            }
            StartLoad(fideFolder);
        }

        public static void StartLoad(string fideFolder)
        {
            lock (Gate)
            {
                if (loading || snap != null) return;
                loading = true;
            }
            Thread t = new Thread(delegate() { LoadWorker(fideFolder); });
            t.IsBackground = true;
            t.Name = "CP.FideIndex.Load";
            t.Start();
        }

        private static void LoadWorker(string fideFolder)
        {
            System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                string path = System.IO.Path.Combine(fideFolder, "players_legacy.txt");
                if (!File.Exists(path)) { lastError = "players_legacy.txt is not available."; return; }
                FileInfo fi = new FileInfo(path);
                string cache = System.IO.Path.Combine(System.IO.Path.Combine(fideFolder, ".index"), "legacy-v1.bin");
                Snapshot s = TryLoadCache(cache, fi);
                if (s != null) lastSource = "cache";
                else
                {
                    s = Build(fi);
                    lastSource = "built";
                    TrySaveCache(cache, fi, s);
                }
                snap = s;
                lastError = "";
                lastLoadMs = sw.ElapsedMilliseconds;
                readyEvent.Set();
            }
            catch (Exception ex)
            {
                lastError = ex.Message;
            }
            finally
            {
                lock (Gate) { loading = false; }
            }
        }

        // ---------------------------------------------------------------- build
        private static int ColumnStart(string header, string token, int fallback)
        {
            Match m = Regex.Match(header, "(?<!\\S)" + Regex.Escape(token) + "(?!\\S)", RegexOptions.IgnoreCase);
            return m.Success ? m.Index : fallback;
        }

        private static Snapshot Build(FileInfo fi)
        {
            byte[] buf = new byte[4 << 20];
            byte[] hay = new byte[96 << 20];
            int hayLen = 0;
            long[] offs = new long[2200000];
            int count = 0;
            string header = null;
            int nameStart = 15, fedStart = 76, sexStart = 80;

            using (FileStream fs = new FileStream(fi.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 20, FileOptions.SequentialScan))
            {
                long baseOff = 0;
                int have = 0;
                bool eof = false;
                while (!eof || have > 0)
                {
                    if (!eof)
                    {
                        int n = fs.Read(buf, have, buf.Length - have);
                        if (n <= 0) eof = true; else have += n;
                    }
                    int start = 0;
                    while (start < have)
                    {
                        int idx = Array.IndexOf<byte>(buf, (byte)10, start, have - start);
                        int end;
                        int next;
                        if (idx < 0)
                        {
                            if (!eof && have < buf.Length) break; // need more data
                            if (!eof) { // line longer than buffer: skip it
                                start = have; break;
                            }
                            end = have; next = have; // last line without newline
                        }
                        else { end = idx; next = idx + 1; }
                        int lineEnd = end;
                        if (lineEnd > start && buf[lineEnd - 1] == 13) lineEnd--;
                        int len = lineEnd - start;
                        if (len > 0)
                        {
                            string s = Encoding.UTF8.GetString(buf, start, len);
                            if (header == null)
                            {
                                header = s;
                                nameStart = ColumnStart(header, "Name", 15);
                                fedStart = ColumnStart(header, "Fed", 76);
                                sexStart = ColumnStart(header, "Sex", fedStart + 4);
                            }
                            else if (s.Length > nameStart + 1)
                            {
                                string id = s.Substring(0, nameStart).Trim();
                                if (IsId(id))
                                {
                                    int fe = Math.Min(fedStart, s.Length);
                                    string name = s.Substring(nameStart, fe - nameStart).Trim();
                                    string fed = "";
                                    if (s.Length > fedStart) fed = s.Substring(fedStart, Math.Min(sexStart, s.Length) - fedStart).Trim();
                                    string key = (id + " " + name + " " + fed).ToLowerInvariant();
                                    int need = key.Length * 3 + 2;
                                    if (hayLen + need > hay.Length) Array.Resize(ref hay, Math.Max(hay.Length * 2, hayLen + need));
                                    hayLen += Encoding.UTF8.GetBytes(key, 0, key.Length, hay, hayLen);
                                    hay[hayLen++] = 10;
                                    if (count == offs.Length) Array.Resize(ref offs, offs.Length * 2);
                                    offs[count++] = baseOff + start;
                                }
                            }
                        }
                        start = next;
                    }
                    // compact remaining bytes to the front of the buffer
                    int remain = have - start;
                    if (remain > 0 && start > 0) Buffer.BlockCopy(buf, start, buf, 0, remain);
                    baseOff += start;
                    have = remain;
                    if (eof && have == 0) break;
                    if (eof && start >= have + start) break;
                    if (eof) { /* process leftover once */ if (remain == 0) break; }
                }
            }

            if (count == 0) throw new InvalidDataException("The FIDE LEGACY directory contains no valid players.");
            Snapshot snapshot = new Snapshot();
            snapshot.Hay = hay;
            snapshot.HayLen = hayLen;
            snapshot.FileOff = offs;
            snapshot.Count = count;
            snapshot.Header = header ?? "";
            snapshot.Path = fi.FullName;
            snapshot.LineStart = ComputeLineStarts(hay, hayLen, count);
            return snapshot;
        }

        private static bool IsId(string id)
        {
            if (id.Length < 5 || id.Length > 15) return false;
            for (int i = 0; i < id.Length; i++) { char c = id[i]; if (c < '0' || c > '9') return false; }
            return true;
        }

        private static int[] ComputeLineStarts(byte[] hay, int hayLen, int count)
        {
            int[] ls = new int[count];
            int n = 0;
            int pos = 0;
            while (pos < hayLen && n < count)
            {
                ls[n++] = pos;
                int idx = Array.IndexOf<byte>(hay, (byte)10, pos, hayLen - pos);
                if (idx < 0) break;
                pos = idx + 1;
            }
            return ls;
        }

        // ---------------------------------------------------------------- cache
        private static Snapshot TryLoadCache(string cache, FileInfo source)
        {
            try
            {
                if (!File.Exists(cache)) return null;
                using (FileStream fs = new FileStream(cache, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 20, FileOptions.SequentialScan))
                using (BinaryReader br = new BinaryReader(fs, Encoding.UTF8))
                {
                    if (br.ReadInt32() != CacheMagic) return null;
                    if (br.ReadInt64() != source.Length) return null;
                    if (br.ReadInt64() != source.LastWriteTimeUtc.Ticks) return null;
                    int count = br.ReadInt32();
                    int hayLen = br.ReadInt32();
                    string header = br.ReadString();
                    if (count <= 0 || hayLen <= 0) return null;
                    byte[] offBytes = br.ReadBytes(count * 8);
                    if (offBytes.Length != count * 8) return null;
                    long[] offs = new long[count];
                    Buffer.BlockCopy(offBytes, 0, offs, 0, offBytes.Length);
                    byte[] hay = br.ReadBytes(hayLen);
                    if (hay.Length != hayLen) return null;
                    Snapshot s = new Snapshot();
                    s.Hay = hay; s.HayLen = hayLen; s.FileOff = offs; s.Count = count; s.Header = header; s.Path = source.FullName;
                    s.LineStart = ComputeLineStarts(hay, hayLen, count);
                    return s;
                }
            }
            catch { return null; }
        }

        private static void TrySaveCache(string cache, FileInfo source, Snapshot s)
        {
            try
            {
                string dir = System.IO.Path.GetDirectoryName(cache);
                Directory.CreateDirectory(dir);
                string tmp = cache + ".tmp";
                using (FileStream fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20))
                using (BinaryWriter bw = new BinaryWriter(fs, Encoding.UTF8))
                {
                    bw.Write(CacheMagic);
                    bw.Write(source.Length);
                    bw.Write(source.LastWriteTimeUtc.Ticks);
                    bw.Write(s.Count);
                    bw.Write(s.HayLen);
                    bw.Write(s.Header ?? "");
                    byte[] offBytes = new byte[s.Count * 8];
                    Buffer.BlockCopy(s.FileOff, 0, offBytes, 0, offBytes.Length);
                    bw.Write(offBytes);
                    bw.Write(s.Hay, 0, s.HayLen);
                }
                if (File.Exists(cache)) File.Delete(cache);
                File.Move(tmp, cache);
            }
            catch { /* read-only install folder: the index simply stays in memory */ }
        }

        // ---------------------------------------------------------------- search
        private static string[] SplitTerms(string query)
        {
            List<string> terms = new List<string>();
            foreach (string part in Regex.Split((query ?? "").Trim().ToLowerInvariant(), "[\\s,]+"))
                if (part.Length > 0) terms.Add(part);
            return terms.ToArray();
        }

        private static int IndexOfBytes(byte[] hay, byte[] pat, int start, int end)
        {
            int last = end - pat.Length;
            byte first = pat[0];
            int i = start;
            while (i <= last)
            {
                i = Array.IndexOf<byte>(hay, first, i, last - i + 1);
                if (i < 0) return -1;
                int j = 1;
                while (j < pat.Length && hay[i + j] == pat[j]) j++;
                if (j == pat.Length) return i;
                i++;
            }
            return -1;
        }

        private static int LineIndexOf(int[] ls, int count, int pos)
        {
            int lo = 0, hi = count - 1;
            while (lo < hi)
            {
                int mid = (lo + hi + 1) >> 1;
                if (ls[mid] <= pos) lo = mid; else hi = mid - 1;
            }
            return lo;
        }

        /// <summary>Returns raw LEGACY lines (at most <paramref name="limit"/>) or null while the index is not ready.</summary>
        public static string[] Search(string query, int limit)
        {
            Snapshot s = snap;
            if (s == null) return null;
            if (limit < 1) limit = 1;
            if (limit > 60) limit = 60;
            string[] terms = SplitTerms(query);
            if (terms.Length == 0) return new string[0];
            byte[][] tb = new byte[terms.Length][];
            int pivot = 0;
            for (int i = 0; i < terms.Length; i++)
            {
                tb[i] = Encoding.UTF8.GetBytes(terms[i]);
                if (tb[i].Length > tb[pivot].Length) pivot = i;
            }

            const int cap = 4000;
            List<int> hits = new List<int>();
            int pos = 0;
            while (pos < s.HayLen && hits.Count < cap)
            {
                int hit = IndexOfBytes(s.Hay, tb[pivot], pos, s.HayLen);
                if (hit < 0) break;
                int li = LineIndexOf(s.LineStart, s.Count, hit);
                int ls = s.LineStart[li];
                int le = (li + 1 < s.Count) ? s.LineStart[li + 1] - 1 : s.HayLen;
                bool ok = true;
                for (int t = 0; t < tb.Length && ok; t++)
                {
                    if (t == pivot) continue;
                    if (IndexOfBytes(s.Hay, tb[t], ls, le) < 0) ok = false;
                }
                if (ok) hits.Add(li);
                pos = le + 1;
            }
            if (hits.Count == 0) return new string[0];

            // Rank:
            // 0: Exact FIDE ID match
            // 1: Surname (text before comma) starts with first query term
            // 2: Any word token starts with all query terms
            // 3: Substring matches
            List<int> tier0 = new List<int>();
            List<int> tier1 = new List<int>();
            List<int> tier2 = new List<int>();
            List<int> tier3 = new List<int>();
            char[] seps = new char[] { ' ', ',', '.', '-', '\'' };
            string firstTerm = terms[0];
            bool isNumericQuery = terms.Length == 1 && IsId(firstTerm);

            foreach (int li in hits)
            {
                int ls = s.LineStart[li];
                int le = (li + 1 < s.Count) ? s.LineStart[li + 1] - 1 : s.HayLen;
                string text = Encoding.UTF8.GetString(s.Hay, ls, le - ls);

                if (isNumericQuery)
                {
                    int sp = text.IndexOf(' ');
                    string idPart = sp > 0 ? text.Substring(0, sp) : text;
                    if (idPart == firstTerm) { tier0.Add(li); continue; }
                }

                // Split at comma to inspect surname
                int comma = text.IndexOf(',');
                string surname = comma > 0 ? text.Substring(0, comma).Trim() : "";
                // remove leading ID from surname if present
                int spaceInSurname = surname.IndexOf(' ');
                if (spaceInSurname > 0) surname = surname.Substring(spaceInSurname + 1).Trim();

                if (surname.Length > 0 && surname.StartsWith(firstTerm, StringComparison.Ordinal))
                {
                    tier1.Add(li);
                    continue;
                }

                string[] tokens = text.Split(seps, StringSplitOptions.RemoveEmptyEntries);
                bool all = true;
                for (int t = 0; t < terms.Length && all; t++)
                {
                    bool any = false;
                    for (int k = 0; k < tokens.Length; k++)
                        if (tokens[k].StartsWith(terms[t], StringComparison.Ordinal)) { any = true; break; }
                    if (!any) all = false;
                }
                if (all) tier2.Add(li); else tier3.Add(li);
            }

            List<int> ranked = new List<int>(hits.Count);
            ranked.AddRange(tier0);
            ranked.AddRange(tier1);
            ranked.AddRange(tier2);
            ranked.AddRange(tier3);
            int take = Math.Min(limit, ranked.Count);
            long[] offsets = new long[take];
            for (int i = 0; i < take; i++) offsets[i] = s.FileOff[ranked[i]];
            return ReadRawLines(s.Path, offsets);
        }

        /// <summary>Returns raw LEGACY lines for the given FIDE IDs (null while not ready).</summary>
        public static string[] FindByIds(string[] ids)
        {
            Snapshot s = snap;
            if (s == null) return null;
            HashSet<long> wanted = new HashSet<long>();
            foreach (string raw in ids)
            {
                long v;
                if (raw != null && long.TryParse(raw.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out v)) wanted.Add(v);
            }
            List<long> offsets = new List<long>();
            if (wanted.Count == 0) return new string[0];
            for (int i = 0; i < s.Count && wanted.Count > 0; i++)
            {
                int p = s.LineStart[i];
                long v = 0;
                while (p < s.HayLen && s.Hay[p] >= (byte)'0' && s.Hay[p] <= (byte)'9') { v = v * 10 + (s.Hay[p] - (byte)'0'); p++; }
                if (wanted.Remove(v)) offsets.Add(s.FileOff[i]);
            }
            return ReadRawLines(s.Path, offsets.ToArray());
        }

        private static string[] ReadRawLines(string path, long[] offsets)
        {
            string[] result = new string[offsets.Length];
            byte[] b = new byte[4096];
            using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                for (int i = 0; i < offsets.Length; i++)
                {
                    fs.Seek(offsets[i], SeekOrigin.Begin);
                    int n = fs.Read(b, 0, b.Length);
                    int e = Array.IndexOf<byte>(b, (byte)10, 0, n);
                    if (e < 0) e = n;
                    if (e > 0 && b[e - 1] == 13) e--;
                    result[i] = Encoding.UTF8.GetString(b, 0, e);
                }
            }
            return result;
        }
    }

    public static class RatingsIndex
    {
        private sealed class Row
        {
            public string Id, Name = "", Fed = "FIDE", Title = "", Gender = "", Birth = "-";
            public int[] R = new int[3];
            public int[] K = new int[3];
        }

        private static readonly object Gate = new object();
        private static readonly string[] Files = new string[] { "standard.txt", "rapid.txt", "blitz.txt" };
        private static readonly string[] Keys = new string[] { "std", "rapid", "blitz" };
        private static readonly string[] Titles = new string[] { "GM", "IM", "WGM", "WIM", "FM", "WFM", "CM", "WCM" };

        private static string Signature(string folder)
        {
            StringBuilder sb = new StringBuilder("v1");
            foreach (string f in Files)
            {
                FileInfo fi = new FileInfo(Path.Combine(folder, f));
                sb.Append('|').Append(f).Append(':');
                if (fi.Exists) sb.Append(fi.Length.ToString(CultureInfo.InvariantCulture)).Append(':').Append(fi.LastWriteTimeUtc.Ticks.ToString(CultureInfo.InvariantCulture));
                else sb.Append("missing");
            }
            return sb.ToString();
        }

        public static string IndexPath(string folder) { return Path.Combine(Path.Combine(folder, ".index"), "ratings-v1.ndjson"); }

        /// <summary>First line (JSON metadata) of the up-to-date index, building it first if needed.</summary>
        public static string EnsureBuilt(string folder)
        {
            lock (Gate)
            {
                string sig = Signature(folder);
                string path = IndexPath(folder);
                string meta = ReadMeta(path);
                if (meta != null && meta.IndexOf("\"sig\":" + JsonString(sig), StringComparison.Ordinal) >= 0) return meta;
                Build(folder, path, sig);
                meta = ReadMeta(path);
                if (meta == null) throw new IOException("The rating index could not be written.");
                return meta;
            }
        }

        public static string ReadMeta(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;
                using (StreamReader sr = new StreamReader(path, new UTF8Encoding(false)))
                    return sr.ReadLine();
            }
            catch { return null; }
        }

        private static string JsonString(string v)
        {
            StringBuilder sb = new StringBuilder(v.Length + 2);
            AppendJson(sb, v);
            return sb.ToString();
        }

        private static void AppendJson(StringBuilder sb, string v)
        {
            sb.Append('"');
            for (int i = 0; i < v.Length; i++)
            {
                char c = v[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4")); else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        private static string PeriodFromHeader(string header)
        {
            Match m = Regex.Match(header, "(?<!\\S)(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\\d{2})(?!\\S)", RegexOptions.IgnoreCase);
            if (!m.Success) return DateTime.UtcNow.ToString("yyyy-MM", CultureInfo.InvariantCulture);
            string[] months = new string[] { "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC" };
            int mi = Array.IndexOf(months, m.Groups[1].Value.ToUpperInvariant()) + 1;
            return (2000 + int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture)).ToString(CultureInfo.InvariantCulture) + "-" + mi.ToString("00", CultureInfo.InvariantCulture);
        }

        private static string Slice(string line, int from, int to)
        {
            if (from < 0 || from >= line.Length) return "";
            if (to < 0 || to > line.Length) to = line.Length;
            if (to <= from) return "";
            return line.Substring(from, to - from).Trim();
        }

        private static int Col(string header, string token)
        {
            Match m = Regex.Match(header, "(?<!\\S)" + Regex.Escape(token) + "(?!\\S)", RegexOptions.IgnoreCase);
            return m.Success ? m.Index : -1;
        }

        private static int ParseList(string path, int type, Dictionary<long, Row> map, List<Row> order, out string period)
        {
            int parsed = 0;
            period = DateTime.UtcNow.ToString("yyyy-MM", CultureInfo.InvariantCulture);
            using (StreamReader sr = new StreamReader(path, new UTF8Encoding(false), true, 1 << 20))
            {
                string header = sr.ReadLine();
                if (string.IsNullOrWhiteSpace(header)) throw new InvalidDataException(Path.GetFileName(path) + " has no header.");
                period = PeriodFromHeader(header);
                int cName = Col(header, "Name"); if (cName < 0) cName = 15;
                int cFed = Col(header, "Fed");
                int cSex = Col(header, "Sex");
                int cTit = Col(header, "Tit");
                int cWTit = Col(header, "WTit");
                int cOTit = Col(header, "OTit");
                int cFoa = Col(header, "FOA");
                Match pm = Regex.Match(header, "(?<!\\S)(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\\d{2}(?!\\S)", RegexOptions.IgnoreCase);
                int cRating = pm.Success ? pm.Index : Col(header, "Rating");
                int cGms = Col(header, "Gms");
                int cK = Col(header, "K");
                int cBirth = Col(header, "B-day");
                int cFlag = Col(header, "Flag");
                if (cFed < 0 || cRating < 0) throw new InvalidDataException(Path.GetFileName(path) + " header is not a FIDE rating-list header.");
                int afterRating = cGms >= 0 ? cGms : (cK >= 0 ? cK : cBirth);
                int afterFed = cSex >= 0 ? cSex : (cTit >= 0 ? cTit : cRating);
                int afterSex = cTit >= 0 ? cTit : (cWTit >= 0 ? cWTit : cRating);
                int afterTit = cWTit >= 0 ? cWTit : (cOTit >= 0 ? cOTit : (cFoa >= 0 ? cFoa : cRating));
                int afterWTit = cOTit >= 0 ? cOTit : (cFoa >= 0 ? cFoa : cRating);
                int afterK = cBirth >= 0 ? cBirth : -1;
                int afterBirth = cFlag >= 0 ? cFlag : -1;

                string line;
                while ((line = sr.ReadLine()) != null)
                {
                    if (line.Length < cRating + 3) continue;
                    string id = Slice(line, 0, cName);
                    if (id.Length < 5 || id.Length > 15) continue;
                    long idv;
                    if (!long.TryParse(id, NumberStyles.None, CultureInfo.InvariantCulture, out idv)) continue;
                    string name = Slice(line, cName, cFed);
                    if (name.Length == 0) continue;
                    int rating;
                    if (!int.TryParse(Slice(line, cRating, afterRating), NumberStyles.None, CultureInfo.InvariantCulture, out rating)) continue;
                    if (rating < 100 || rating > 3300) continue;

                    string fed = Slice(line, cFed, afterFed).ToUpperInvariant();
                    if (!Regex.IsMatch(fed, "^[A-Z]{3}$")) fed = "FIDE";
                    string sex = cSex >= 0 ? Slice(line, cSex, afterSex).ToUpperInvariant() : "";
                    string gender = (sex == "M" || sex == "F") ? sex.ToLowerInvariant() : "";
                    string title = cTit >= 0 ? Slice(line, cTit, afterTit).ToUpperInvariant() : "";
                    if (Array.IndexOf(Titles, title) < 0)
                    {
                        title = cWTit >= 0 ? Slice(line, cWTit, afterWTit).ToUpperInvariant() : "";
                        if (Array.IndexOf(Titles, title) < 0) title = "";
                    }
                    int k = 0;
                    if (cK >= 0) { int.TryParse(Slice(line, cK, afterK), NumberStyles.None, CultureInfo.InvariantCulture, out k); if (k != 10 && k != 20 && k != 40) k = 0; }
                    string birth = "-";
                    if (cBirth >= 0)
                    {
                        string b = Slice(line, cBirth, afterBirth);
                        int by;
                        if (b.Length == 4 && int.TryParse(b, NumberStyles.None, CultureInfo.InvariantCulture, out by) && by >= 1900 && by <= 2035) birth = b;
                    }

                    Row row;
                    if (!map.TryGetValue(idv, out row))
                    {
                        row = new Row();
                        row.Id = id;
                        map[idv] = row;
                        order.Add(row);
                    }
                    row.Name = name;
                    if (fed.Length > 0) row.Fed = fed;
                    if (title.Length > 0) row.Title = title;
                    if (gender.Length > 0) row.Gender = gender;
                    if (birth != "-") row.Birth = birth;
                    row.R[type] = rating;
                    row.K[type] = k;
                    parsed++;
                }
            }
            return parsed;
        }

        private static void Build(string folder, string path, string sig)
        {
            Dictionary<long, Row> map = new Dictionary<long, Row>(900000);
            List<Row> order = new List<Row>(900000);
            int[] counts = new int[3];
            string[] periods = new string[3];
            long[] sizes = new long[3];
            for (int t = 0; t < 3; t++)
            {
                string file = Path.Combine(folder, Files[t]);
                if (!File.Exists(file)) throw new FileNotFoundException(Files[t] + " is not available.", file);
                sizes[t] = new FileInfo(file).Length;
                counts[t] = ParseList(file, t, map, order, out periods[t]);
                if (counts[t] < 1000) throw new InvalidDataException(Files[t] + " parsed only " + counts[t] + " records.");
            }

            StringBuilder meta = new StringBuilder();
            meta.Append("{\"v\":1,\"sig\":").Append(JsonString(sig));
            meta.Append(",\"built\":").Append(JsonString(DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)));
            meta.Append(",\"unique\":").Append(order.Count.ToString(CultureInfo.InvariantCulture));
            meta.Append(",\"lists\":{");
            for (int t = 0; t < 3; t++)
            {
                if (t > 0) meta.Append(',');
                meta.Append('"').Append(Keys[t]).Append("\":{\"count\":").Append(counts[t].ToString(CultureInfo.InvariantCulture));
                meta.Append(",\"period\":").Append(JsonString(periods[t]));
                meta.Append(",\"bytes\":").Append(sizes[t].ToString(CultureInfo.InvariantCulture)).Append('}');
            }
            meta.Append("}}");

            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string tmp = path + ".tmp";
            using (StreamWriter w = new StreamWriter(tmp, false, new UTF8Encoding(false), 1 << 20))
            {
                w.Write(meta.ToString());
                w.Write('\n');
                StringBuilder sb = new StringBuilder(1 << 20);
                int inBatch = 0;
                for (int i = 0; i < order.Count; i++)
                {
                    Row r = order[i];
                    sb.Append(inBatch == 0 ? '[' : ',');
                    sb.Append('[');
                    AppendJson(sb, r.Id); sb.Append(',');
                    AppendJson(sb, r.Name); sb.Append(',');
                    AppendJson(sb, r.Fed); sb.Append(',');
                    AppendJson(sb, r.Title); sb.Append(',');
                    AppendJson(sb, r.Gender); sb.Append(',');
                    AppendJson(sb, r.Birth); sb.Append(',');
                    sb.Append(r.R[0]).Append(',').Append(r.R[1]).Append(',').Append(r.R[2]).Append(',');
                    sb.Append(r.K[0]).Append(',').Append(r.K[1]).Append(',').Append(r.K[2]);
                    sb.Append(']');
                    inBatch++;
                    if (inBatch == 5000 || i == order.Count - 1)
                    {
                        sb.Append("]\n");
                        w.Write(sb.ToString());
                        sb.Length = 0;
                        inBatch = 0;
                    }
                }
            }
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }
    }
}
