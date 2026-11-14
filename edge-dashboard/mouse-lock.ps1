# Mouse lock for the Xeneon Edge: the mouse can't move onto the Edge, but touch still works.
# A low-level mouse hook drops mouse moves that would land on the Edge. Touch and pen taps are
# promoted to mouse input tagged with MI_WP_SIGNATURE (0xFF515700) in dwExtraInfo, so those pass.
# After a tap the cursor sits on the Edge; the next real mouse move puts it back where it was.
#   powershell -NoProfile -ExecutionPolicy Bypass -File mouse-lock.ps1 [-Width 2560 -Height 720]
param([int]$Width = 2560, [int]$Height = 720)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class EdgeMouseLock {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData, flags, time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct MONITORINFOEX { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }

  delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
  delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, ref RECT r, IntPtr data);

  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr hMod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("user32.dll")] static extern UIntPtr SetTimer(IntPtr h, UIntPtr id, uint ms, IntPtr fn);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc fn, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFOEX mi);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);

  const int WH_MOUSE_LL = 14; const uint WM_MOUSEMOVE = 0x200, WM_TIMER = 0x113;
  const uint TOUCH_MASK = 0xFFFFFF00, TOUCH_SIGNATURE = 0xFF515700;

  static HookProc proc;                // kept in a field so the GC can't collect the callback
  static RECT edge; static bool haveEdge;
  static POINT lastOutside; static bool haveOutside;
  static int wantW, wantH;
  public static int Blocked;

  static bool InEdge(POINT p) { return haveEdge && p.X >= edge.L && p.X < edge.R && p.Y >= edge.T && p.Y < edge.B; }

  public static string FindEdge() {
    bool found = false; RECT r = new RECT();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr h, IntPtr dc, ref RECT rc, IntPtr d) {
      MONITORINFOEX mi = new MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
      if (GetMonitorInfo(h, ref mi) && mi.rcMonitor.R - mi.rcMonitor.L == wantW && mi.rcMonitor.B - mi.rcMonitor.T == wantH) { r = mi.rcMonitor; found = true; }
      return true;
    }, IntPtr.Zero);
    bool changed = found != haveEdge || r.L != edge.L || r.T != edge.T || r.R != edge.R || r.B != edge.B;
    edge = r; haveEdge = found;
    return changed ? (found ? string.Format("Edge at {0},{1} to {2},{3}", r.L, r.T, r.R, r.B) : "Edge not found") : null;
  }

  static IntPtr Hook(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0 && (uint)wParam == WM_MOUSEMOVE && haveEdge) {
      MSLLHOOKSTRUCT s = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
      bool touch = ((uint)s.dwExtraInfo.ToUInt64() & TOUCH_MASK) == TOUCH_SIGNATURE;
      if (!touch) {
        POINT cur; GetCursorPos(out cur);
        if (InEdge(s.pt)) {
          // A tap left the cursor on the Edge: send it back to where the mouse last was.
          if (InEdge(cur) && haveOutside) SetCursorPos(lastOutside.X, lastOutside.Y);
          Blocked++;
          return (IntPtr)1;
        }
        lastOutside = s.pt; haveOutside = true;
      }
    }
    return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
  }

  public static void Run(int w, int h) {
    try { SetProcessDpiAwarenessContext((IntPtr)(-4)); } catch { }  // per-monitor v2: real pixel coordinates
    wantW = w; wantH = h;
    Console.WriteLine(FindEdge() ?? "Edge not found"); Console.Out.Flush();
    POINT p; GetCursorPos(out p); if (!InEdge(p)) { lastOutside = p; haveOutside = true; }
    proc = Hook;
    if (SetWindowsHookEx(WH_MOUSE_LL, proc, GetModuleHandle(null), 0) == IntPtr.Zero) throw new Exception("SetWindowsHookEx failed: " + Marshal.GetLastWin32Error());
    SetTimer(IntPtr.Zero, UIntPtr.Zero, 5000, IntPtr.Zero);   // re-check the displays every 5 s
    MSG m;
    while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) {
      if (m.message == WM_TIMER) { string c = FindEdge(); if (c != null) { Console.WriteLine(c); Console.Out.Flush(); } }
    }
  }
}
'@

[EdgeMouseLock]::Run($Width, $Height)
