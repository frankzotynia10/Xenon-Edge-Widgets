// Battery levels of wireless mice and keyboards, asked straight from the devices. Compiled into deck-keys.ps1,
// which runs Batteries.Scan() on its own thread once a minute (and on "B") and prints the line it returns.
// Scan() returns one line: bats <id>|<0-100 or ->|<charging 0|1>|<name>;...   all devices seen so far
//           ids: razer:<pid>  logitech:<pid>:<slot>  pulsar:<pid>  bt:<address>
//           "-" = seen before but not answering now (off, asleep or out of range)
// Supported:
//   Razer      USB receivers and cables: Razer's 90-byte feature report, class 0x07 (0x80 battery, 0x84 charging)
//   Logitech   Unifying, Bolt and Lightspeed receivers and cables: HID++ 2.0 (Unified Battery, Battery Status or Battery Voltage)
//   Pulsar     4K/8K receivers (Compx chipset): 17-byte report 0x08, command 0x04 (battery). Read-only commands only.
//   Bluetooth  any Bluetooth LE device Windows already reads a battery level from (the % in Bluetooth settings)
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

public static class Batteries {
  [StructLayout(LayoutKind.Sequential)] struct CAPS {
    public ushort Usage, UsagePage, InLen, OutLen, FeatLen;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
    public ushort n1, n2, n3, n4, n5, n6, n7, n8, n9, n10;
  }
  [StructLayout(LayoutKind.Sequential)] struct DEVPROPKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Sequential)] struct SP_DEVINFO_DATA { public uint cbSize; public Guid ClassGuid; public uint DevInst; public IntPtr Reserved; }

  [DllImport("hid.dll")] static extern bool HidD_SetFeature(SafeFileHandle h, byte[] b, int n);
  [DllImport("hid.dll")] static extern bool HidD_GetFeature(SafeFileHandle h, byte[] b, int n);
  [DllImport("hid.dll", CharSet = CharSet.Unicode)] static extern bool HidD_GetProductString(SafeFileHandle h, StringBuilder b, int n);
  [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr p);
  [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr p);
  [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr p, out CAPS c);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern SafeFileHandle CreateFile(string p, uint access, uint share, IntPtr sa, uint disp, uint flags, IntPtr t);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] static extern IntPtr SetupDiGetClassDevs(IntPtr cls, string enumerator, IntPtr hwnd, uint flags);
  [DllImport("setupapi.dll")] static extern bool SetupDiEnumDeviceInfo(IntPtr set, uint i, ref SP_DEVINFO_DATA d);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode)]
  static extern bool SetupDiGetDevicePropertyW(IntPtr set, ref SP_DEVINFO_DATA d, ref DEVPROPKEY key, out uint type, byte[] buf, uint size, out uint req, uint flags);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] static extern bool SetupDiGetDeviceInstanceId(IntPtr set, ref SP_DEVINFO_DATA d, StringBuilder id, int size, out int req);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);

  const string HID_GUID = "{4d1e55b2-f16f-11cf-88cb-001111000030}";
  class Dev { public string Id, Name; public int Level = -1; public bool Charging; }
  static readonly Dictionary<string, Dev> seen = new Dictionary<string, Dev>();
  static readonly object scanLock = new object();

  static void Found(string id, string name, int level, bool charging) {
    Dev d;
    if (!seen.TryGetValue(id, out d)) { d = new Dev(); d.Id = id; seen[id] = d; }
    if (!string.IsNullOrEmpty(name)) d.Name = name.Trim();
    d.Level = Math.Max(0, Math.Min(100, level)); d.Charging = charging;
  }

  // Known device that didn't answer this time: listed with no level.
  static void Asleep(string id, string name) {
    Dev d;
    if (!seen.TryGetValue(id, out d)) { d = new Dev(); d.Id = id; seen[id] = d; }
    if (d.Name == null && !string.IsNullOrEmpty(name)) d.Name = name.Trim();
  }

  // HID interfaces of one vendor, from the registry: "VID_1532&PID_00E8&MI_03" -> its device paths.
  // Unplugged ones are listed too; they just fail to open.
  static List<string[]> HidPaths(string vid) {
    List<string[]> list = new List<string[]>();
    using (RegistryKey hid = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Enum\HID")) {
      if (hid == null) return list;
      foreach (string dev in hid.GetSubKeyNames()) {
        if (!dev.StartsWith("VID_" + vid + "&", StringComparison.OrdinalIgnoreCase)) continue;
        string pid = dev.Substring(13, 4).ToUpperInvariant();
        using (RegistryKey k = hid.OpenSubKey(dev))
          foreach (string inst in k.GetSubKeyNames()) list.Add(new[] { pid, @"\\?\HID#" + dev + "#" + inst + "#" + HID_GUID });
      }
    }
    return list;
  }
  static SafeFileHandle Open(string path, bool overlapped) {
    SafeFileHandle h = CreateFile(path, 0xC0000000, 3, IntPtr.Zero, 3, overlapped ? 0x40000000u : 0u, IntPtr.Zero);
    if (h.IsInvalid && !overlapped) h = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);   // feature reports work without read/write access
    return h;
  }
  static CAPS Caps(SafeFileHandle h) {
    CAPS c = new CAPS(); IntPtr p;
    if (HidD_GetPreparsedData(h, out p)) { HidP_GetCaps(p, out c); HidD_FreePreparsedData(p); }
    return c;
  }
  static string Product(SafeFileHandle h) { StringBuilder b = new StringBuilder(128); HidD_GetProductString(h, b, 256); return b.ToString(); }

  // An interrupt-report channel (vendor collection) with timeouts: one read stays outstanding between calls.
  class Chan : IDisposable {
    FileStream fs; Task<int> pending; byte[] buf; int len;
    public Chan(SafeFileHandle h, int inLen) { len = inLen; fs = new FileStream(h, FileAccess.ReadWrite, Math.Max(inLen, 1), true); }
    public void Write(byte[] b) { fs.Write(b, 0, b.Length); }
    public byte[] Read(int ms) {
      if (pending == null) { buf = new byte[len]; pending = fs.ReadAsync(buf, 0, len); }
      try { if (!pending.Wait(ms)) return null; } catch { pending = null; return null; }
      pending = null; return buf;
    }
    public void Dispose() { try { fs.Dispose(); } catch { } }
  }

  // ---------- Razer ----------
  static readonly Dictionary<string, string> razerPath = new Dictionary<string, string>();
  // The reply, or null. echoed: the receiver understood the question (it's a Razer control channel),
  // even if the mouse didn't answer (status 4 while it's asleep).
  static byte[] RazerAsk(SafeFileHandle h, byte tid, byte cls, byte cmd, ref bool echoed) {
    byte[] q = new byte[91]; q[2] = tid; q[6] = 2; q[7] = cls; q[8] = cmd;
    byte crc = 0; for (int i = 3; i <= 88; i++) crc ^= q[i]; q[89] = crc;
    if (!HidD_SetFeature(h, q, 91)) return null;
    Thread.Sleep(60);
    byte[] r = new byte[91];
    if (!HidD_GetFeature(h, r, 91)) return null;
    if (r[7] == cls && r[8] == cmd) echoed = true;
    return r[1] == 0x02 && r[7] == cls && r[8] == cmd ? r : null;   // status 2 = answered
  }
  static bool RazerRead(string pid, string path) {
    using (SafeFileHandle h = Open(path, false)) {
      if (h.IsInvalid) return false;
      bool echoed = false;
      foreach (byte tid in new byte[] { 0x1F, 0x3F, 0x9F }) {   // the transaction id differs between models
        byte[] b = RazerAsk(h, tid, 0x07, 0x80, ref echoed); if (b == null) continue;
        byte[] c = RazerAsk(h, tid, 0x07, 0x84, ref echoed);
        Found("razer:" + pid, Product(h), (int)Math.Round(b[10] * 100 / 255.0), c != null && c[10] == 1);
        return true;
      }
      if (echoed) Asleep("razer:" + pid, Product(h));   // the receiver is there, the mouse is asleep
      return echoed;
    }
  }
  static void Razer() {
    Dictionary<string, List<string>> byPid = new Dictionary<string, List<string>>();
    foreach (string[] p in HidPaths("1532")) { if (!byPid.ContainsKey(p[0])) byPid[p[0]] = new List<string>(); byPid[p[0]].Add(p[1]); }
    foreach (KeyValuePair<string, List<string>> kv in byPid) {
      string known; if (razerPath.TryGetValue(kv.Key, out known) && RazerRead(kv.Key, known)) continue;
      foreach (string path in kv.Value) if (path != known && RazerRead(kv.Key, path)) { razerPath[kv.Key] = path; break; }
    }
  }

  // ---------- Logitech (HID++ 2.0) ----------
  const byte SWID = 0x0A;
  static byte[] Hpp(Chan ch, byte dev, byte feat, byte fn, params byte[] args) {
    byte[] q = new byte[20]; q[0] = 0x11; q[1] = dev; q[2] = feat; q[3] = (byte)((fn << 4) | SWID);
    for (int i = 0; i < args.Length && i < 16; i++) q[4 + i] = args[i];
    ch.Write(q);
    DateTime end = DateTime.Now.AddMilliseconds(400);
    while (DateTime.Now < end) {
      byte[] r = ch.Read((int)Math.Max(1, (end - DateTime.Now).TotalMilliseconds));
      if (r == null) return null;
      if (r[0] != 0x11 || r[1] != dev) continue;
      if (r[2] == 0xFF && r[3] == feat) return null;                          // HID++ 2.0 error
      if (r[2] == feat && r[3] == q[3]) return (byte[])r.Clone();
    }
    return null;
  }
  static byte Feature(Chan ch, byte dev, ushort id) {
    byte[] r = Hpp(ch, dev, 0x00, 0, (byte)(id >> 8), (byte)id);   // Root: where is feature <id>?
    return r == null ? (byte)0 : r[4];
  }
  static string HppName(Chan ch, byte dev) {
    byte f = Feature(ch, dev, 0x0005); if (f == 0) return null;
    byte[] r = Hpp(ch, dev, f, 0); if (r == null) return null;
    int len = r[4]; StringBuilder s = new StringBuilder();
    while (s.Length < len) {
      byte[] part = Hpp(ch, dev, f, 1, (byte)s.Length); if (part == null) break;
      int before = s.Length;
      for (int i = 4; i < 20 && s.Length < len; i++) s.Append((char)part[i]);
      if (s.Length == before) break;
    }
    return s.ToString();
  }
  static readonly int[][] LIION = { new[] { 4186, 100 }, new[] { 4067, 90 }, new[] { 3989, 80 }, new[] { 3922, 70 }, new[] { 3859, 60 }, new[] { 3811, 50 },
    new[] { 3778, 40 }, new[] { 3751, 30 }, new[] { 3717, 20 }, new[] { 3671, 10 }, new[] { 3646, 5 }, new[] { 3579, 2 }, new[] { 3500, 0 } };
  static int FromVolts(int mv) {
    if (mv >= LIION[0][0]) return 100;
    for (int i = 1; i < LIION.Length; i++)
      if (mv >= LIION[i][0]) return LIION[i][1] + (mv - LIION[i][0]) * (LIION[i - 1][1] - LIION[i][1]) / (LIION[i - 1][0] - LIION[i][0]);
    return 0;
  }
  static bool HppBattery(Chan ch, byte dev, string id, string fallbackName) {
    byte f; byte[] r; int level = -1; bool charging = false;
    if ((f = Feature(ch, dev, 0x1004)) != 0 && (r = Hpp(ch, dev, f, 1)) != null) {          // Unified Battery: get_status
      level = r[4];
      if (level == 0 && r[5] != 0) level = (r[5] & 8) != 0 ? 90 : (r[5] & 4) != 0 ? 50 : (r[5] & 2) != 0 ? 20 : 5;   // only a coarse level
      charging = r[6] == 1 || r[6] == 2;
    } else if ((f = Feature(ch, dev, 0x1000)) != 0 && (r = Hpp(ch, dev, f, 0)) != null) {   // Battery Status
      level = r[4]; charging = r[6] == 1 || r[6] == 2 || r[6] == 4;
    } else if ((f = Feature(ch, dev, 0x1001)) != 0 && (r = Hpp(ch, dev, f, 0)) != null) {   // Battery Voltage
      level = FromVolts((r[4] << 8) | r[5]); charging = (r[6] & 0x80) != 0;
    }
    if (level < 0) return false;
    Dev d; string name = seen.TryGetValue(id, out d) && d.Name != null ? d.Name : (HppName(ch, dev) ?? fallbackName);
    Found(id, name, level, charging);
    return true;
  }
  static void Logitech() {
    foreach (string[] p in HidPaths("046D")) {
      SafeFileHandle h = Open(p[1], true);
      if (h.IsInvalid) continue;
      CAPS c = Caps(h);
      if (c.UsagePage != 0xFF00 || c.Usage != 0x02 || c.OutLen != 20) { h.Dispose(); continue; }   // the HID++ long-report channel only
      string product = Product(h);
      using (Chan ch = new Chan(h, c.InLen)) {
        // A cable or Bluetooth device answers as 0xFF; a receiver passes 1-6 on to its paired devices.
        if (HppBattery(ch, 0xFF, "logitech:" + p[0], product)) continue;
        for (byte slot = 1; slot <= 6; slot++) HppBattery(ch, slot, "logitech:" + p[0] + ":" + slot, product);
      }
    }
  }

  // ---------- Pulsar (Compx receivers) ----------
  static void Pulsar() {
    foreach (string[] p in HidPaths("3554")) {
      SafeFileHandle h = Open(p[1], true);
      if (h.IsInvalid) continue;
      CAPS c = Caps(h);
      if (c.UsagePage != 0xFF02 || c.OutLen != 17) { h.Dispose(); continue; }
      string product = Product(h);
      using (Chan ch = new Chan(h, c.InLen)) {
        byte[] q = new byte[17]; q[0] = 0x08; q[1] = 0x04;   // 0x04 = battery (read-only)
        int sum = 0; for (int i = 0; i < 16; i++) sum += q[i]; q[16] = (byte)((0x55 - sum) & 0xFF);
        ch.Write(q);
        DateTime end = DateTime.Now.AddMilliseconds(600);
        while (DateTime.Now < end) {
          byte[] r = ch.Read((int)Math.Max(1, (end - DateTime.Now).TotalMilliseconds));
          if (r == null) break;
          if (r[0] != 0x08 || r[1] != 0x04) continue;
          int s = 0; for (int i = 0; i < 16; i++) s += r[i];
          if (((0x55 - s) & 0xFF) != r[16] || r[6] > 100) break;   // not a reply we understand
          Found("pulsar:" + p[0], product.Replace(" Receiver", "").Replace(" Wireless", ""), r[6], r[7] == 1);
          break;
        }
        if (!seen.ContainsKey("pulsar:" + p[0]) || seen["pulsar:" + p[0]].Level < 0) Asleep("pulsar:" + p[0], product.Replace(" Receiver", "").Replace(" Wireless", ""));
      }
    }
  }

  // ---------- Bluetooth LE (what Windows already reads) ----------
  static void Bluetooth() {
    IntPtr set = SetupDiGetClassDevs(IntPtr.Zero, "BTHLE", IntPtr.Zero, 0x2 | 0x4 /* PRESENT | ALLCLASSES */);
    if (set == new IntPtr(-1)) return;
    try {
      DEVPROPKEY batKey = new DEVPROPKEY(); batKey.fmtid = new Guid("104EA319-6EE2-4701-BD47-8DDBF425BBE5"); batKey.pid = 2;
      DEVPROPKEY nameKey = new DEVPROPKEY(); nameKey.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"); nameKey.pid = 14;
      for (uint i = 0; ; i++) {
        SP_DEVINFO_DATA d = new SP_DEVINFO_DATA(); d.cbSize = (uint)Marshal.SizeOf(typeof(SP_DEVINFO_DATA));
        if (!SetupDiEnumDeviceInfo(set, i, ref d)) break;
        uint type, req; byte[] b = new byte[4];
        if (!SetupDiGetDevicePropertyW(set, ref d, ref batKey, out type, b, 4, out req, 0)) continue;
        byte[] nb = new byte[512]; string name = null;
        if (SetupDiGetDevicePropertyW(set, ref d, ref nameKey, out type, nb, 512, out req, 0)) name = Encoding.Unicode.GetString(nb, 0, (int)req).TrimEnd('\0');
        StringBuilder inst = new StringBuilder(512); int r2; SetupDiGetDeviceInstanceId(set, ref d, inst, 512, out r2);
        string addr = inst.ToString(); int us = addr.LastIndexOf('_'); addr = us >= 0 ? addr.Substring(us + 1) : addr;
        if (addr.Length > 12) addr = addr.Substring(0, 12);
        Found("bt:" + addr.ToLowerInvariant(), name, b[0], false);
      }
    } finally { SetupDiDestroyDeviceInfoList(set); }
  }

  public static string Scan() {
    lock (scanLock) {
      foreach (Dev d in seen.Values) d.Level = -1;
      try { Razer(); } catch { }
      try { Logitech(); } catch { }
      try { Pulsar(); } catch { }
      try { Bluetooth(); } catch { }
      StringBuilder s = new StringBuilder("bats ");
      bool first = true;
      foreach (Dev d in seen.Values) {
        if (!first) s.Append(';'); first = false;
        string name = (d.Name ?? d.Id).Replace("|", " ").Replace(";", " ");
        s.Append(d.Id).Append('|').Append(d.Level < 0 ? "-" : d.Level.ToString()).Append('|').Append(d.Charging ? "1" : "0").Append('|').Append(name);
      }
      return s.ToString();
    }
  }
}
