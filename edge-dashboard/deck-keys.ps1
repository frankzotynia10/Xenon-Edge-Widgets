# Key sender for the Deck widget. Started and kept running by deck.js.
# stdin, one command per line:
#   K <vk>,<vk>,...     press the keys in order, then release them in reverse (a hotkey combo)
#   T <base64 utf-8>    type the text as Unicode characters
#   V <0-100>           set the system volume (default playback device); above 0 also unmutes
#   M                   mute / unmute the system volume
# stdout:
#   vol <0-100|-> <0|1>               the system volume and whether it's muted, whenever it changes
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
          } else continue;
          Say("ok");
        } catch (Exception e) { Say("err " + e.Message.Replace("\n", " ")); }
      }
      Environment.Exit(0);   // deck.js went away
    });
    reader.IsBackground = true; reader.Start();
    // Volume changed elsewhere (keyboard, Windows, an app): checked 4 times a second, sent only when it changes.
    Thread vol = new Thread(() => { while (true) { ReportVolume(); Thread.Sleep(250); } });
    vol.IsBackground = true; vol.Start();

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
