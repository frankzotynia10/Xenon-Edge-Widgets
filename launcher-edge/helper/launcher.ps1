# App launcher bridge for the Edge helper. Talks JSON lines over stdin/stdout.
#   {"cmd":"apps"}                         -> {"type":"apps","apps":[{id,name,target}]}   (Start menu apps)
#   {"cmd":"watch","ids":[...]}            -> {"type":"running","ids":[...]} whenever the set changes
#   {"cmd":"icon","id":"...","out":"x.png"} -> {"type":"icon","id":"...","ok":true}
#   {"cmd":"launch","id":"..."}            -> brings the app to the front if it's open, otherwise starts it
param()
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class EdgeLauncher {
  // stdin on a background thread (Console.In.ReadLineAsync blocks in Windows PowerShell)
  public static System.Collections.Concurrent.BlockingCollection<string> Lines = new System.Collections.Concurrent.BlockingCollection<string>();
  public static void StartReader() {
    var t = new System.Threading.Thread(() => { try { string l; while ((l = Console.In.ReadLine()) != null) Lines.Add(l); } catch { } Lines.CompleteAdding(); });
    t.IsBackground = true; t.Start();
  }
  // ---------- icons ----------
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }
  [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; public SIZE(int x, int y) { cx = x; cy = y; } }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int size, ref BITMAP bm);
  [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public ushort bmPlanes, bmBitsPixel; public IntPtr bmBits; }
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
  [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr hdc, IntPtr hbm, uint start, uint lines, byte[] bits, ref BITMAPINFOHEADER bmi, uint usage);
  [StructLayout(LayoutKind.Sequential)] struct BITMAPINFOHEADER { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }

  public static bool SaveIcon(string appId, string outPath, int size) {
    object o;
    SHCreateItemFromParsingName("shell:AppsFolder\\" + appId, IntPtr.Zero, new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), out o);
    var f = (IShellItemImageFactory)o;
    IntPtr hbm;
    // SIIGBF_BIGGERSIZEOK (1) | SIIGBF_ICONONLY (4)
    int hr = f.GetImage(new SIZE(size, size), 0x1 | 0x4, out hbm);
    if (hr != 0 || hbm == IntPtr.Zero) return false;
    try {
      var bm = new BITMAP(); GetObject(hbm, Marshal.SizeOf(typeof(BITMAP)), ref bm);
      int w = bm.bmWidth, h = bm.bmHeight;
      var bi = new BITMAPINFOHEADER { biSize = Marshal.SizeOf(typeof(BITMAPINFOHEADER)), biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
      var bits = new byte[w * h * 4];
      IntPtr dc = CreateCompatibleDC(IntPtr.Zero);
      try { GetDIBits(dc, hbm, 0, (uint)h, bits, ref bi, 0); } finally { DeleteDC(dc); }
      bool anyAlpha = false;
      for (int i = 3; i < bits.Length; i += 4) if (bits[i] != 0) { anyAlpha = true; break; }
      using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        for (int i = 0; i < bits.Length; i += 4) {
          int a = anyAlpha ? bits[i + 3] : 255;
          if (anyAlpha && a > 0 && a < 255) { // shell images are premultiplied
            bits[i] = (byte)Math.Min(255, bits[i] * 255 / a); bits[i + 1] = (byte)Math.Min(255, bits[i + 1] * 255 / a); bits[i + 2] = (byte)Math.Min(255, bits[i + 2] * 255 / a);
          }
          bits[i + 3] = (byte)a;
        }
        // Store apps can hand back a black glyph meant for a light taskbar; flip those to white for the dark Edge tiles
        long n = 0; double lum = 0, sat = 0;
        for (int i = 0; i < bits.Length; i += 4) {
          if (bits[i + 3] < 128) continue;
          int b = bits[i], g = bits[i + 1], r = bits[i + 2];
          int mx = Math.Max(r, Math.Max(g, b)), mn = Math.Min(r, Math.Min(g, b));
          lum += 0.2126 * r + 0.7152 * g + 0.0722 * b; sat += mx - mn; n++;
        }
        if (n > 0 && lum / n < 60 && sat / n < 30) {
          for (int i = 0; i < bits.Length; i += 4) { bits[i] = (byte)(255 - bits[i]); bits[i + 1] = (byte)(255 - bits[i + 1]); bits[i + 2] = (byte)(255 - bits[i + 2]); }
        }
        Marshal.Copy(bits, 0, data.Scan0, bits.Length);
        bmp.UnlockBits(data);
        Directory.CreateDirectory(Path.GetDirectoryName(outPath));
        bmp.Save(outPath, ImageFormat.Png);
      }
      return true;
    } finally { DeleteObject(hbm); }
  }

  // ---------- windows ----------
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder sb, ref int size);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern int GetApplicationUserModelId(IntPtr h, ref int len, StringBuilder sb);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid riid, out IPropertyStore ps);
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore { int GetCount(out uint c); int GetAt(uint i, out PROPERTYKEY k); int GetValue(ref PROPERTYKEY k, out PROPVARIANT v); int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v); int Commit(); }
  [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(16)] public IntPtr p2; }
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pv);

  public class Win { public IntPtr Hwnd; public string Aumid = ""; public string Exe = ""; }

  static string WindowAumid(IntPtr h) {
    try {
      var iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
      IPropertyStore ps;
      if (SHGetPropertyStoreForWindow(h, ref iid, out ps) != 0 || ps == null) return "";
      var key = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
      PROPVARIANT v;
      string s = "";
      if (ps.GetValue(ref key, out v) == 0) { if (v.vt == 31 && v.p != IntPtr.Zero) s = Marshal.PtrToStringUni(v.p); PropVariantClear(ref v); }
      Marshal.ReleaseComObject(ps);
      return s ?? "";
    } catch { return ""; }
  }

  public static List<Win> Windows() {
    var list = new List<Win>();
    var procCache = new Dictionary<uint, string[]>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;            // GW_OWNER
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;                                // WS_EX_TOOLWINDOW
      if (GetWindowTextLength(h) == 0) return true;
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string[] pinfo;
      if (!procCache.TryGetValue(pid, out pinfo)) {
        pinfo = new[] { "", "" };
        IntPtr ph = OpenProcess(0x1000, false, pid);                                       // PROCESS_QUERY_LIMITED_INFORMATION
        if (ph != IntPtr.Zero) {
          try {
            var sb = new StringBuilder(1024); int n = sb.Capacity;
            if (QueryFullProcessImageName(ph, 0, sb, ref n)) pinfo[0] = sb.ToString();
            var ab = new StringBuilder(512); int an = ab.Capacity;
            if (GetApplicationUserModelId(ph, ref an, ab) == 0) pinfo[1] = ab.ToString();
          } finally { CloseHandle(ph); }
        }
        procCache[pid] = pinfo;
      }
      var w = new Win { Hwnd = h, Exe = pinfo[0] };
      w.Aumid = WindowAumid(h);
      if (w.Aumid == "") w.Aumid = pinfo[1];
      list.Add(w);
      return true;
    }, IntPtr.Zero);
    return list;
  }

  public static bool Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);                                                     // SW_RESTORE
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);         // Alt tap unlocks SetForegroundWindow
    return SetForegroundWindow(h);
  }

  public static void Launch(string appId) {
    Process.Start(new ProcessStartInfo("explorer.exe", "shell:AppsFolder\\" + appId) { UseShellExecute = false });
  }
}
'@

function Out-Json($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush() }
function Log($m) { Out-Json @{ type = 'log'; msg = "$m" } }

# ---------- Start menu apps ----------
$script:apps = @{}
function Load-Apps {
  $sh = New-Object -ComObject Shell.Application
  $list = @()
  $script:apps = @{}
  foreach ($it in $sh.NameSpace('shell:AppsFolder').Items()) {
    $id = $it.Path; if (-not $id) { continue }
    $target = ''
    try { $target = [string]$it.ExtendedProperty('System.Link.TargetParsingPath') } catch {}
    $a = [pscustomobject]@{ id = $id; name = $it.Name; target = $target }
    $script:apps[$id.ToLower()] = $a
    $list += $a
  }
  return $list
}

# Folders too broad to treat "anything running from here" as this app
$broad = @($env:windir, "$env:windir\System32", "$env:windir\SysWOW64", $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA,
  "$env:LOCALAPPDATA\Programs", "$env:LOCALAPPDATA\Microsoft\WindowsApps", $env:APPDATA) | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\').ToLower() }

function Find-Window($app, $wins) {
  $id = $app.id.ToLower()
  $t = if ($app.target -and $app.target -match '^[a-z]:\\') { $app.target.ToLower() } else { '' }
  $tdir = if ($t) { [IO.Path]::GetDirectoryName($t).ToLower() } else { '' }
  $dirOk = $tdir -and ($broad -notcontains $tdir)
  foreach ($w in $wins) { if ($w.Aumid -and $w.Aumid.ToLower() -eq $id) { return $w } }
  if ($t) { foreach ($w in $wins) { if ($w.Exe -and $w.Exe.ToLower() -eq $t) { return $w } } }
  if ($dirOk) { foreach ($w in $wins) { if ($w.Exe -and $w.Exe.ToLower().StartsWith($tdir + '\')) { return $w } } }
  return $null
}

$watch = @()
$lastRunning = $null
[EdgeLauncher]::StartReader()
Log 'App launcher bridge started'
while (-not [EdgeLauncher]::Lines.IsCompleted) {
  $line = $null
  if ([EdgeLauncher]::Lines.TryTake([ref]$line, 1500)) {
    try {
      $m = $line | ConvertFrom-Json
      switch ($m.cmd) {
        'apps' { $l = Load-Apps; Out-Json @{ type = 'apps'; apps = @($l) } }
        'watch' { $watch = @($m.ids); $lastRunning = $null }
        'icon' {
          $ok = $false
          try { $ok = [EdgeLauncher]::SaveIcon($m.id, $m.out, 256) } catch { Log "icon failed for $($m.id): $($_.Exception.Message)" }
          Out-Json @{ type = 'icon'; id = $m.id; ok = $ok }
        }
        'launch' {
          if ($script:apps.Count -eq 0) { [void](Load-Apps) }
          $app = $script:apps[[string]$m.id.ToLower()]
          if (-not $app) { Log "not a Start menu app: $($m.id)"; break }
          $w = Find-Window $app ([EdgeLauncher]::Windows())
          if ($w) { [void][EdgeLauncher]::Focus($w.Hwnd); Log "focused $($app.name)" }
          else { [EdgeLauncher]::Launch($app.id); Log "launched $($app.name)" }
          $lastRunning = $null
        }
      }
    } catch { Log "error: $($_.Exception.Message)" }
  }
  if ($watch.Count) {
    if ($script:apps.Count -eq 0) { [void](Load-Apps) }
    $wins = [EdgeLauncher]::Windows()
    $running = @($watch | Where-Object { $a = $script:apps[[string]$_.ToLower()]; $a -and (Find-Window $a $wins) })
    $sig = ($running -join '|')
    if ($sig -ne $lastRunning) { $lastRunning = $sig; Out-Json @{ type = 'running'; ids = @($running) } }
  }
}
