# Edge sleep cover: a full-screen window over the Xeneon Edge showing a heavily dimmed wallpaper
# (plus an optional faint clock). Toggled by a global hotkey (for a Stream Deck "Hotkey" button),
# by commands from the Edge helper on stdin, or woken by tapping the Edge.
#
# stdin:  sleep | wake | toggle | reload | quit
# stdout: state sleeping | state awake | info <text> | error <text>
param([string]$ConfigPath)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace EdgeSleep {
  public class Settings {
    public string Hotkey = "ctrl+alt+shift+f10";
    public string Wallpaper = "";      // empty = your desktop wallpaper
    public double Dim = 0.88;          // 0 = full brightness image, 1 = black
    public bool Clock = true;
    public bool TapToWake = true;
    public int ScreenWidth = 2560, ScreenHeight = 720;  // how to recognise the Edge
  }

  public class Cover : Form {
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    const int WM_HOTKEY = 0x0312, HOTKEY_ID = 0xED6E;

    public Settings S = new Settings();
    Bitmap art;              // pre-dimmed wallpaper, sized to the Edge
    System.Windows.Forms.Timer clockTimer;
    Point clockPos = new Point(0, 0);   // small offset from center
    Random rng = new Random();
    bool sleeping;
    string hotkeyText = "";

    public static void Out(string s) { lock (typeof(Cover)) { Console.Out.WriteLine(s); Console.Out.Flush(); } }

    public Cover() {
      FormBorderStyle = FormBorderStyle.None;
      StartPosition = FormStartPosition.Manual;
      ShowInTaskbar = false;
      TopMost = true;
      BackColor = Color.Black;
      DoubleBuffered = true;
      KeyPreview = true;
      clockTimer = new System.Windows.Forms.Timer { Interval = 1000 };
      clockTimer.Tick += (o, e) => { if (DateTime.Now.Second == 0) MoveClock(); Invalidate(); };
      MouseDown += (o, e) => { if (S.TapToWake) Wake(); };
      KeyDown += (o, e) => { if (e.KeyCode == Keys.Escape) Wake(); };
      Microsoft.Win32.SystemEvents.DisplaySettingsChanged += (o, e) => BeginInvoke((Action)(() => { if (sleeping) Place(); }));
    }

    protected override CreateParams CreateParams {
      get { var cp = base.CreateParams; cp.ExStyle |= 0x80; return cp; } // WS_EX_TOOLWINDOW: no alt-tab entry
    }
    protected override bool ShowWithoutActivation { get { return true; } }

    public static Screen FindEdge(Settings s) {
      foreach (var sc in Screen.AllScreens) if (sc.Bounds.Width == s.ScreenWidth && sc.Bounds.Height == s.ScreenHeight) return sc;
      return null;
    }

    public void Apply(Settings s) {
      S = s;
      if (IsHandleCreated) RegisterKey();
      BuildArt();
      if (sleeping) { Place(); Invalidate(); }
    }

    void RegisterKey() {
      UnregisterHotKey(Handle, HOTKEY_ID);
      uint mods = 0, vk = 0;
      foreach (var raw in (S.Hotkey ?? "").ToLowerInvariant().Split('+')) {
        var k = raw.Trim();
        if (k == "ctrl" || k == "control") mods |= 2; else if (k == "alt") mods |= 1; else if (k == "shift") mods |= 4; else if (k == "win") mods |= 8;
        else if (k.Length > 1 && k[0] == 'f' && char.IsDigit(k[1])) vk = (uint)(0x6F + int.Parse(k.Substring(1)));
        else if (k.Length == 1 && char.IsLetterOrDigit(k[0])) vk = (uint)char.ToUpperInvariant(k[0]);
      }
      if (vk == 0) { Out("error hotkey '" + S.Hotkey + "' not understood"); return; }
      mods |= 0x4000; // MOD_NOREPEAT
      if (RegisterHotKey(Handle, HOTKEY_ID, mods, vk)) { hotkeyText = S.Hotkey; Out("info hotkey " + S.Hotkey); }
      else Out("error hotkey " + S.Hotkey + " is already taken by another app");
    }

    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); RegisterKey(); }
    protected override void WndProc(ref Message m) {
      if (m.Msg == WM_HOTKEY && (int)m.WParam == HOTKEY_ID) { Toggle(); return; }
      base.WndProc(ref m);
    }

    static string DesktopWallpaper() {
      try {
        using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Control Panel\Desktop")) {
          var p = k == null ? null : k.GetValue("WallPaper") as string;
          if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
        }
      } catch { }
      var t = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Windows\Themes\TranscodedWallpaper");
      return File.Exists(t) ? t : null;
    }

    void BuildArt() {
      var scr = FindEdge(S);
      int w = scr != null ? scr.Bounds.Width : S.ScreenWidth, h = scr != null ? scr.Bounds.Height : S.ScreenHeight;
      var bmp = new Bitmap(w, h);
      using (var g = Graphics.FromImage(bmp)) {
        g.Clear(Color.Black);
        string path = string.IsNullOrEmpty(S.Wallpaper) ? DesktopWallpaper() : S.Wallpaper;
        bool drew = false;
        if (!string.IsNullOrEmpty(path) && File.Exists(path)) {
          try {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (var img = Image.FromStream(fs)) {
              // "cover" crop: fill the Edge, centered
              double sc = Math.Max((double)w / img.Width, (double)h / img.Height);
              int dw = (int)(img.Width * sc), dh = (int)(img.Height * sc);
              g.InterpolationMode = InterpolationMode.HighQualityBicubic;
              g.DrawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
              drew = true;
            }
          } catch (Exception ex) { Out("error wallpaper: " + ex.Message); }
        }
        if (!drew) {
          using (var br = new LinearGradientBrush(new Rectangle(0, 0, w, h), Color.FromArgb(18, 22, 40), Color.FromArgb(4, 4, 8), 20f)) g.FillRectangle(br, 0, 0, w, h);
        }
        int a = (int)Math.Round(Math.Max(0, Math.Min(1, S.Dim)) * 255);
        using (var shade = new SolidBrush(Color.FromArgb(a, 0, 0, 0))) g.FillRectangle(shade, 0, 0, w, h);
      }
      var old = art; art = bmp; if (old != null) old.Dispose();
    }

    void MoveClock() {
      // stays centered, but nudges a few pixels each minute so nothing sits in exactly one spot all night
      clockPos = new Point(rng.Next(-30, 31), rng.Next(-16, 17));
    }

    protected override void OnPaint(PaintEventArgs e) {
      var g = e.Graphics;
      if (art != null) g.DrawImage(art, 0, 0, ClientSize.Width, ClientSize.Height); else g.Clear(Color.Black);
      if (S.Clock) {
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        using (var f = new Font("Segoe UI Light", 96f, FontStyle.Regular, GraphicsUnit.Pixel))
        using (var f2 = new Font("Segoe UI", 28f, FontStyle.Regular, GraphicsUnit.Pixel))
        using (var b = new SolidBrush(Color.FromArgb(60, 255, 255, 255)))
        using (var b2 = new SolidBrush(Color.FromArgb(40, 255, 255, 255))) {
          string t1 = DateTime.Now.ToString("h:mm"), t2 = DateTime.Now.ToString("dddd, MMM d");
          var fmt = StringFormat.GenericTypographic;
          SizeF s1 = g.MeasureString(t1, f, PointF.Empty, fmt), s2 = g.MeasureString(t2, f2, PointF.Empty, fmt);
          float gap = 14f, total = s1.Height + gap + s2.Height;
          float cx = ClientSize.Width / 2f + clockPos.X, top = (ClientSize.Height - total) / 2f + clockPos.Y;
          g.DrawString(t1, f, b, cx - s1.Width / 2f, top, fmt);
          g.DrawString(t2, f2, b2, cx - s2.Width / 2f, top + s1.Height + gap, fmt);
        }
      }
    }

    void Place() {
      var scr = FindEdge(S);
      if (scr == null) { Out("error Edge screen not found"); return; }
      Bounds = scr.Bounds;
    }

    public void Sleep() {
      if (sleeping) return;
      var scr = FindEdge(S);
      if (scr == null) { Out("error Edge screen not found (looking for " + S.ScreenWidth + "x" + S.ScreenHeight + ")"); return; }
      if (art == null || art.Width != scr.Bounds.Width) BuildArt();
      sleeping = true;
      Place();
      MoveClock();
      Show();
      TopMost = false; TopMost = true; // re-assert z-order above iCUE
      clockTimer.Start();
      Out("state sleeping");
    }
    public void Wake() {
      if (!sleeping) return;
      sleeping = false;
      clockTimer.Stop();
      Hide();
      Out("state awake");
    }
    public void Toggle() { if (sleeping) Wake(); else Sleep(); }

    // ---------- entry ----------
    public static void Run(string configPath) {
      SetProcessDPIAware();
      Application.EnableVisualStyles();
      var form = new Cover();
      form.Apply(LoadSettings(configPath));
      var h = form.Handle; // create handle so the hotkey registers while hidden
      new Thread(() => {
        var stdin = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8);
        string line;
        while ((line = stdin.ReadLine()) != null) {
          var cmd = line.Trim();
          try {
            form.BeginInvoke((Action)(() => {
              if (cmd == "sleep") form.Sleep();
              else if (cmd == "wake") form.Wake();
              else if (cmd == "toggle") form.Toggle();
              else if (cmd == "reload") { form.Apply(LoadSettings(configPath)); Out("info reloaded"); }
              else if (cmd == "quit") Application.Exit();
            }));
          } catch { }
        }
        try { form.BeginInvoke((Action)(() => Application.Exit())); } catch { }
      }) { IsBackground = true }.Start();
      Out("state awake");
      Application.Run();
    }

    static Settings LoadSettings(string path) {
      var s = new Settings();
      try {
        if (string.IsNullOrEmpty(path) || !File.Exists(path)) return s;
        var json = File.ReadAllText(path);
        s.Hotkey = Str(json, "hotkey", s.Hotkey);
        s.Wallpaper = Str(json, "wallpaper", s.Wallpaper);
        s.Dim = Num(json, "dim", s.Dim);
        s.Clock = Bool(json, "clock", s.Clock);
        s.TapToWake = Bool(json, "tapToWake", s.TapToWake);
        s.ScreenWidth = (int)Num(json, "screenWidth", s.ScreenWidth);
        s.ScreenHeight = (int)Num(json, "screenHeight", s.ScreenHeight);
      } catch (Exception ex) { Out("error settings: " + ex.Message); }
      return s;
    }
    // tiny JSON readers for a flat settings file (avoids extra dependencies)
    static string Str(string j, string k, string d) {
      var m = System.Text.RegularExpressions.Regex.Match(j, "\"" + k + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
      return m.Success ? System.Text.RegularExpressions.Regex.Unescape(m.Groups[1].Value) : d;
    }
    static double Num(string j, string k, double d) {
      var m = System.Text.RegularExpressions.Regex.Match(j, "\"" + k + "\"\\s*:\\s*(-?[0-9.]+)");
      double v; return m.Success && double.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out v) ? v : d;
    }
    static bool Bool(string j, string k, bool d) {
      var m = System.Text.RegularExpressions.Regex.Match(j, "\"" + k + "\"\\s*:\\s*(true|false)");
      return m.Success ? m.Groups[1].Value == "true" : d;
    }
  }
}
'@

[EdgeSleep.Cover]::Run($ConfigPath)
