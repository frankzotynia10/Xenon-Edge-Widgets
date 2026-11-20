# Key sender for the Deck widget. Started and kept running by deck.js.
# stdin, one command per line:
#   K <vk>,<vk>,...     press the keys in order, then release them in reverse (a hotkey combo)
#   T <base64 utf-8>    type the text as Unicode characters
#   V <0-100>           set the system volume (default playback device); above 0 also unmutes
#   M                   mute / unmute the system volume
#   AV <0-100> <proc>   set one app's volume (all its audio sessions); above 0 also unmutes
#   AM <proc>           mute / unmute one app
#   W <proc>,<proc>     the apps to report with "avol" lines
#   S                   turn all screens off (any mouse move, key or touch wakes them)
#   B                   read the Razer mouse battery now (it's also read once a minute)
# stdout:
#   vol <0-100|-> <0|1>               the system volume and whether it's muted, whenever it changes
#   avol <proc> <0-100|-> <0|1>       a watched app's volume ("-" = no audio session right now)
#   bat razer <0-100|-> <0|1> <name>  the Razer mouse's battery and whether it's charging ("-" = no answer)
#   fg <process> <0|1> <window class>   whenever the foreground window (or whether it fills its screen) changes;
#                                       1 = it covers the whole monitor, like a fullscreen game
#   ok | err <message>            after each command
# Keys go to whatever window has focus. The dashboard never takes focus, so that's the game or app you're in.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class DeckKeys {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
  delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc fn, uint pid, uint tid, uint flags);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] static extern UIntPtr SetTimer(IntPtr h, UIntPtr id, uint ms, IntPtr fn);
  [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);

  // True when the window covers its whole monitor (borderless or exclusive fullscreen).
  static bool FillsScreen(IntPtr h) {
    if (h == GetShellWindow() || h == GetDesktopWindow()) return false;
    RECT r; if (!GetWindowRect(h, out r)) return false;
    MONITORINFO mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
    return r.L <= mi.rcMonitor.L && r.T <= mi.rcMonitor.T && r.R >= mi.rcMonitor.R && r.B >= mi.rcMonitor.B
      && r.R - r.L <= (mi.rcMonitor.R - mi.rcMonitor.L) + 2 && r.B - r.T <= (mi.rcMonitor.B - mi.rcMonitor.T) + 2;   // not a maximized window's overhang
  }

  const uint KEYUP = 2, UNICODE = 4, EXTENDED = 1;
  static readonly HashSet<int> Extended = new HashSet<int> { 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5C, 0x6F, 0x90, 0xA3, 0xA5 };
  static readonly object outLock = new object();
  static WinEventProc proc;   // kept in a field so the GC can't collect the callback
  static string lastFg;

  // ---------- system volume (the default playback device) ----------
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo {}
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int NotUsed_EnumAudioEndpoints(int dataFlow, int mask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int NotUsed_Register(IntPtr n); int NotUsed_Unregister(IntPtr n); int GetChannelCount(out uint c);
    int SetMasterVolumeLevel(float db, ref Guid ctx); int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
    int GetMasterVolumeLevel(out float db); int GetMasterVolumeLevelScalar(out float level);
    int NotUsed_SetCh(uint c, float db, ref Guid ctx); int NotUsed_SetChS(uint c, float l, ref Guid ctx);
    int NotUsed_GetCh(uint c, out float db); int NotUsed_GetChS(uint c, out float l);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  // Per-app volume: each app's audio sessions on the default playback device.
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int NotUsed_GetAudioSessionControl(IntPtr guid, int flags, out IntPtr control);
    int NotUsed_GetSimpleAudioVolume(IntPtr guid, int flags, out IntPtr volume);
    int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator { int GetCount(out int count); int GetSession(int index, out IAudioSessionControl2 session); }
  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int state); int NotUsed_GetDisplayName(out IntPtr n); int NotUsed_SetDisplayName(IntPtr n, ref Guid c);
    int NotUsed_GetIconPath(out IntPtr p); int NotUsed_SetIconPath(IntPtr p, ref Guid c); int NotUsed_GetGroupingParam(out Guid g);
    int NotUsed_SetGroupingParam(ref Guid g, ref Guid c); int NotUsed_Register(IntPtr c); int NotUsed_Unregister(IntPtr c);
    int NotUsed_GetSessionIdentifier(out IntPtr id); int NotUsed_GetSessionInstanceIdentifier(out IntPtr id); int GetProcessId(out uint pid);
  }
  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    int SetMasterVolume(float level, ref Guid ctx); int GetMasterVolume(out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  // The volume controls of every session that belongs to a process with this name (Discord has several).
  static List<ISimpleAudioVolume> AppSessions(string proc) {
    List<ISimpleAudioVolume> list = new List<ISimpleAudioVolume>();
    if (devEnum == null) devEnum = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
    IMMDevice d; Marshal.ThrowExceptionForHR(devEnum.GetDefaultAudioEndpoint(0, 1, out d));
    Guid iid = typeof(IAudioSessionManager2).GUID; object o;
    Marshal.ThrowExceptionForHR(d.Activate(ref iid, 23, IntPtr.Zero, out o));
    IAudioSessionEnumerator e; ((IAudioSessionManager2)o).GetSessionEnumerator(out e);
    int n; e.GetCount(out n);
    for (int i = 0; i < n; i++) {
      IAudioSessionControl2 s; e.GetSession(i, out s);
      uint pid; s.GetProcessId(out pid); if (pid == 0) continue;   // 0 = system sounds
      string name; try { name = Process.GetProcessById((int)pid).ProcessName; } catch { continue; }
      if (string.Equals(name, proc, StringComparison.OrdinalIgnoreCase)) list.Add((ISimpleAudioVolume)s);
    }
    return list;
  }
  public static void SetAppVolume(string proc, int pct) {
    lock (volLock) {
      foreach (ISimpleAudioVolume v in AppSessions(proc)) {
        v.SetMasterVolume(Math.Max(0, Math.Min(100, pct)) / 100f, ref volCtx);
        if (pct > 0) v.SetMute(false, ref volCtx);
      }
    }
    ReportApps();
  }
  public static void ToggleAppMute(string proc) {
    lock (volLock) {
      List<ISimpleAudioVolume> l = AppSessions(proc); if (l.Count == 0) return;
      bool m; l[0].GetMute(out m);
      foreach (ISimpleAudioVolume v in l) v.SetMute(!m, ref volCtx);
    }
    ReportApps();
  }
  static string[] watchApps = new string[0];
  static readonly Dictionary<string, string> lastApp = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
  // "avol <process> <0-100|-> <0|1>" for each watched app when it changes; "-" = it has no audio right now.
  static void ReportApps() {
    foreach (string a in watchApps) {
      string val;
      try {
        lock (volLock) {
          List<ISimpleAudioVolume> l = AppSessions(a);
          if (l.Count == 0) val = "- 0";
          else { float lv; bool m; l[0].GetMasterVolume(out lv); l[0].GetMute(out m); val = (int)Math.Round(lv * 100) + " " + (m ? "1" : "0"); }
        }
      } catch { val = "- 0"; }
      string prev; if (lastApp.TryGetValue(a, out prev) && prev == val) continue;
      lastApp[a] = val; Say("avol " + a + " " + val);
    }
  }
  static readonly object volLock = new object();
  static IMMDeviceEnumerator devEnum;
  static Guid volCtx = Guid.NewGuid();
  // Asks for the default device each time, so switching speakers/headphones just works.
  static IAudioEndpointVolume Endpoint() {
    if (devEnum == null) devEnum = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
    IMMDevice d; Marshal.ThrowExceptionForHR(devEnum.GetDefaultAudioEndpoint(0 /* render */, 1 /* multimedia */, out d));
    Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
    Marshal.ThrowExceptionForHR(d.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out o));
    return (IAudioEndpointVolume)o;
  }
  public static void SetVolume(int pct) {
    lock (volLock) {
      IAudioEndpointVolume v = Endpoint();
      v.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, pct)) / 100f, ref volCtx);
      if (pct > 0) v.SetMute(false, ref volCtx);   // dragging up unmutes, like the Windows slider
    }
    ReportVolume();
  }
  public static void ToggleMute() {
    lock (volLock) { IAudioEndpointVolume v = Endpoint(); bool m; v.GetMute(out m); v.SetMute(!m, ref volCtx); }
    ReportVolume();
  }
  static string lastVol;
  // "vol <0-100> <0|1 muted>" whenever it changes, from here or anywhere else.
  static void ReportVolume() {
    string line;
    try { lock (volLock) { IAudioEndpointVolume v = Endpoint(); float l; bool m; v.GetMasterVolumeLevelScalar(out l); v.GetMute(out m); line = "vol " + (int)Math.Round(l * 100) + " " + (m ? "1" : "0"); } }
    catch { line = "vol - 0"; }   // no playback device
    if (line != lastVol) { lastVol = line; Say(line); }
  }

  static void Say(string s) { lock (outLock) { Console.WriteLine(s); Console.Out.Flush(); } }

  // ---------- Razer mouse battery, asked straight from the mouse over USB (no Synapse needed) ----------
  // Razer's 90-byte feature report: transaction id 0x1F, class 0x07, command 0x80 = battery (0-255), 0x84 = charging.
  [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_SetFeature(Microsoft.Win32.SafeHandles.SafeFileHandle h, byte[] b, int n);
  [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_GetFeature(Microsoft.Win32.SafeHandles.SafeFileHandle h, byte[] b, int n);
  [DllImport("hid.dll", CharSet = CharSet.Unicode)] static extern bool HidD_GetProductString(Microsoft.Win32.SafeHandles.SafeFileHandle h, StringBuilder b, int n);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFile(string p, uint access, uint share, IntPtr sa, uint disp, uint flags, IntPtr t);
  static readonly object batLock = new object();
  static string razerPath, lastBat;

  static List<string> RazerPaths() {
    List<string> list = new List<string>();
    using (Microsoft.Win32.RegistryKey hid = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Enum\HID")) {
      if (hid == null) return list;
      foreach (string dev in hid.GetSubKeyNames()) {
        if (!dev.StartsWith("VID_1532&", StringComparison.OrdinalIgnoreCase)) continue;
        using (Microsoft.Win32.RegistryKey k = hid.OpenSubKey(dev))
          foreach (string inst in k.GetSubKeyNames()) list.Add(@"\\?\HID#" + dev + "#" + inst + "#{4d1e55b2-f16f-11cf-88cb-001111000030}");
      }
    }
    return list;
  }
  static byte[] RazerAsk(Microsoft.Win32.SafeHandles.SafeFileHandle h, byte cls, byte cmd) {
    byte[] q = new byte[91]; q[2] = 0x1F; q[6] = 2; q[7] = cls; q[8] = cmd;
    byte crc = 0; for (int i = 3; i <= 88; i++) crc ^= q[i]; q[89] = crc;
    if (!HidD_SetFeature(h, q, 91)) return null;
    Thread.Sleep(60);
    byte[] r = new byte[91];
    if (!HidD_GetFeature(h, r, 91)) return null;
    return r[1] == 0x02 && r[7] == cls && r[8] == cmd ? r : null;   // status 2 = answered
  }
  // "<0-100> <charging 0|1> <product name>", or null if this interface isn't a Razer mouse that answers
  static string ReadRazer(string path) {
    Microsoft.Win32.SafeHandles.SafeFileHandle h = CreateFile(path, 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h.IsInvalid) h = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    using (h) {
      if (h.IsInvalid) return null;
      byte[] b = RazerAsk(h, 0x07, 0x80); if (b == null) return null;
      byte[] c = RazerAsk(h, 0x07, 0x84);
      StringBuilder name = new StringBuilder(128); HidD_GetProductString(h, name, 256);
      return (int)Math.Round(b[10] * 100 / 255.0) + " " + (c != null && c[10] == 1 ? "1" : "0") + " " + name.ToString().Trim();
    }
  }
  // bat razer <0-100|-> <0|1> <name>, when it changes ("-" = no Razer mouse answering: unplugged or asleep)
  static void ReportBattery(bool force) {
    lock (batLock) {
      string got = razerPath != null ? ReadRazer(razerPath) : null;
      if (got == null) { razerPath = null; foreach (string p in RazerPaths()) { got = ReadRazer(p); if (got != null) { razerPath = p; break; } } }
      string line = "bat razer " + (got ?? "-");
      if (force || line != lastBat) { lastBat = line; Say(line); }
    }
  }

  static INPUT Key(int vk, bool up) {
    INPUT i = new INPUT(); i.type = 1;
    i.u.ki.wVk = (ushort)vk; i.u.ki.wScan = (ushort)MapVirtualKey((uint)vk, 0);
    i.u.ki.dwFlags = (up ? KEYUP : 0) | (Extended.Contains(vk) ? EXTENDED : 0);
    return i;
  }
  static void Send(List<INPUT> list) {
    INPUT[] a = list.ToArray();
    if (SendInput((uint)a.Length, a, Marshal.SizeOf(typeof(INPUT))) != a.Length) throw new Exception("SendInput failed: " + Marshal.GetLastWin32Error());
  }

  public static void Combo(int[] vks) {
    List<INPUT> down = new List<INPUT>(), up = new List<INPUT>();
    foreach (int vk in vks) down.Add(Key(vk, false));
    for (int i = vks.Length - 1; i >= 0; i--) up.Add(Key(vks[i], true));
    Send(down);
    Thread.Sleep(30);   // some games miss a key that goes down and up in the same frame
    Send(up);
  }

  public static void Text(string s) {
    foreach (char c in s) {
      List<INPUT> l = new List<INPUT>();
      foreach (bool up in new[] { false, true }) {
        INPUT i = new INPUT(); i.type = 1; i.u.ki.wScan = c; i.u.ki.dwFlags = UNICODE | (up ? KEYUP : 0); l.Add(i);
      }
      Send(l);
    }
  }

  static void ReportForeground() {
    IntPtr h = GetForegroundWindow(); if (h == IntPtr.Zero) return;
    uint pid; GetWindowThreadProcessId(h, out pid);
    string name = "?"; try { name = Process.GetProcessById((int)pid).ProcessName; } catch { }
    StringBuilder cls = new StringBuilder(256); GetClassName(h, cls, 256);
    string line = "fg " + name + " " + (FillsScreen(h) ? "1" : "0") + " " + cls;
    if (line != lastFg) { lastFg = line; Say(line); }
  }

  public static void Run() {
    Thread reader = new Thread(() => {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        try {
          if (line.StartsWith("K ")) {
            List<int> vks = new List<int>();
            foreach (string p in line.Substring(2).Split(',')) vks.Add(int.Parse(p));
            Combo(vks.ToArray());
          } else if (line.StartsWith("T ")) {
            Text(Encoding.UTF8.GetString(Convert.FromBase64String(line.Substring(2))));
          } else if (line.StartsWith("V ")) {
            SetVolume(int.Parse(line.Substring(2)));
          } else if (line == "M") {
            ToggleMute();
          } else if (line == "S") {
            // Screens off. Wait for the finger to lift first, or that touch wakes them straight back up.
            Thread.Sleep(600);
            PostMessage((IntPtr)0xFFFF /* HWND_BROADCAST */, 0x0112 /* WM_SYSCOMMAND */, (IntPtr)0xF170 /* SC_MONITORPOWER */, (IntPtr)2 /* off */);
          } else if (line.StartsWith("AV ")) {        // AV <pct> <process>
            string[] p = line.Substring(3).Split(new[] { ' ' }, 2);
            SetAppVolume(p[1], int.Parse(p[0]));
          } else if (line.StartsWith("AM ")) {        // AM <process>
            ToggleAppMute(line.Substring(3));
          } else if (line.StartsWith("W ")) {         // W <process>,<process>,...  apps to report
            watchApps = line.Substring(2).Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            lastApp.Clear(); ReportApps();
          } else if (line == "B") {                   // read the mouse battery now
            ReportBattery(true);
          } else continue;
          Say("ok");
        } catch (Exception e) { Say("err " + e.Message.Replace("\n", " ")); }
      }
      Environment.Exit(0);   // deck.js went away
    });
    reader.IsBackground = true; reader.Start();
    // Volume changed elsewhere (keyboard, Windows, an app): checked 4 times a second, sent only when it changes.
    Thread vol = new Thread(() => { int i = 0; while (true) { ReportVolume(); if (i++ % 2 == 0) ReportApps(); Thread.Sleep(250); } });
    vol.IsBackground = true; vol.Start();
    // Mouse battery: once a minute (it changes slowly; Razer's own app checks about as often).
    Thread bat = new Thread(() => { while (true) { try { ReportBattery(false); } catch { } Thread.Sleep(60000); } });
    bat.IsBackground = true; bat.Start();

    try { SetProcessDpiAwarenessContext((IntPtr)(-4)); } catch { }   // real pixels, for the fullscreen check
    proc = (hook, ev, hwnd, idObject, idChild, thread, time) => ReportForeground();
    SetWinEventHook(3 /* EVENT_SYSTEM_FOREGROUND */, 3, IntPtr.Zero, proc, 0, 0, 0 /* WINEVENT_OUTOFCONTEXT */);
    ReportForeground();
    SetTimer(IntPtr.Zero, UIntPtr.Zero, 2000, IntPtr.Zero);   // re-check now and then: a game can go fullscreen after it gets focus
    MSG m;
    while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { if (m.message == 0x113 /* WM_TIMER */) ReportForeground(); }
  }
}
'@

[DeckKeys]::Run()
