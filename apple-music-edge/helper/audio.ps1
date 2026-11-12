# Audio bridge for the Apple Music Edge helper.
# - Captures what Windows is playing (WASAPI loopback) and turns it into visualizer bars.
#   Bars only move while Apple Music itself is making sound (its own level meter gates them).
# - Reads/sets Apple Music's volume in the Windows volume mixer.
# Output lines: "V <bars>" (one char per bar, '0'..'o' = 0..63), "S <volume 0-1> <muted 0|1> <found 0|1>".
# Input lines:  "vis on" / "vis off", "vol <0-1>", "mute <0|1>".
param([int]$Bands = 48, [string]$ProcessMatch = 'AppleMusic|AMPLibraryAgent|iTunes')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace EdgeAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo {}

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    int OpenPropertyStore(int access, out IntPtr store);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  }

  [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioClient {
    int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
    int GetBufferSize(out uint frames);
    int GetStreamLatency(out long latency);
    int GetCurrentPadding(out uint padding);
    int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
    int GetMixFormat(out IntPtr format);
    int GetDevicePeriod(out long defPeriod, out long minPeriod);
    int Start();
    int Stop();
    int Reset();
    int SetEventHandle(IntPtr handle);
    int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
  }

  [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioCaptureClient {
    int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
    int ReleaseBuffer(uint frames);
    int GetNextPacketSize(out uint frames);
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr guid, int flags, out IntPtr control);
    int GetSimpleAudioVolume(IntPtr guid, int flags, out IntPtr volume);
    int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int index, out IAudioSessionControl2 session);
  }

  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int state);
    int GetDisplayName(out IntPtr name);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid ctx);
    int GetIconPath(out IntPtr path);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid ctx);
    int GetGroupingParam(out Guid group);
    int SetGroupingParam(ref Guid group, ref Guid ctx);
    int RegisterAudioSessionNotification(IntPtr client);
    int UnregisterAudioSessionNotification(IntPtr client);
    int GetSessionIdentifier(out IntPtr id);
    int GetSessionInstanceIdentifier(out IntPtr id);
    int GetProcessId(out uint pid);
  }

  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    int SetMasterVolume(float level, ref Guid ctx);
    int GetMasterVolume(out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation {
    int GetPeakValue(out float peak);
  }

  public static class Bridge {
    const int FFT = 4096;
    static double[] bandDb; static double gainRef = -60;
    static readonly object sync = new object();
    static readonly float[] ring = new float[FFT * 2];
    static int ringPos;
    static volatile bool visOn = true;
    static Regex procMatch;
    static int bands;
    static Guid ctx = Guid.NewGuid();

    static IMMDeviceEnumerator enumerator;
    static IMMDevice device;
    static string deviceId;
    static IAudioClient client;
    static IAudioCaptureClient capture;
    static int channels, bits; static bool isFloat; static int sampleRate = 48000;
    static int decim = 1, decimN; static float decimSum; // averages down to ~48 kHz before the FFT

    static ISimpleAudioVolume appVolume;               // the most active Apple Music session (read)
    static ISimpleAudioVolume[] appVolumes = new ISimpleAudioVolume[0]; // all of them (write)
    static IAudioMeterInformation[] appMeters = new IAudioMeterInformation[0];
    static DateTime lastSessionScan = DateTime.MinValue;
    static string lastStatus = "";

    static void Out(string s) { lock (Console.Out) { Console.Out.WriteLine(s); Console.Out.Flush(); } }
    static void Err(string s) { Console.Error.WriteLine(s); }

    public static void Run(int bandCount, string processPattern) {
      bands = bandCount;
      procMatch = new Regex(processPattern, RegexOptions.IgnoreCase);
      enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCo();
      new Thread(ReadCommands) { IsBackground = true }.Start();

      var frame = Stopwatch.StartNew();
      var deviceCheck = Stopwatch.StartNew();
      double[] smooth = new double[bands];
      bool wasSilent = false;
      while (true) {
        try {
          if (client == null) OpenCapture();
          if (deviceCheck.ElapsedMilliseconds > 3000) {
            deviceCheck.Restart();
            IMMDevice d; enumerator.GetDefaultAudioEndpoint(0, 1, out d);
            string id; d.GetId(out id);
            if (id != deviceId) { Err("default output changed, reopening capture"); CloseCapture(); appVolume = null; appVolumes = new ISimpleAudioVolume[0]; appMeters = new IAudioMeterInformation[0]; continue; }
          }
          Drain();
        } catch (Exception e) {
          Err("capture error: " + e.Message);
          CloseCapture();
          Thread.Sleep(2000);
          continue;
        }

        if ((DateTime.Now - lastSessionScan).TotalMilliseconds > (appVolume == null ? 2000 : 10000)) ScanSessions();
        ReportVolume();

        if (frame.ElapsedMilliseconds >= 33) {
          frame.Restart();
          if (visOn) {
            float peak = 0;
            try { foreach (var m in appMeters) { float pk; m.GetPeakValue(out pk); if (pk > peak) peak = pk; } } catch { appMeters = new IAudioMeterInformation[0]; appVolume = null; }
            bool silent = peak < 0.0005f;
            if (silent) {
              if (!wasSilent) { Array.Clear(smooth, 0, smooth.Length); Out("V " + new string('0', bands)); }
            } else {
              Out("V " + Spectrum(smooth));
            }
            wasSilent = silent;
          }
        }
        Thread.Sleep(8);
      }
    }

    static void ReadCommands() {
      var stdin = new System.IO.StreamReader(Console.OpenStandardInput(), Encoding.UTF8);
      string line;
      while ((line = stdin.ReadLine()) != null) {
        line = line.Trim();
        try {
          if (line == "vis on") visOn = true;
          else if (line == "vis off") visOn = false;
          else if (line.StartsWith("vol ")) {
            float v = Math.Max(0f, Math.Min(1f, float.Parse(line.Substring(4), System.Globalization.CultureInfo.InvariantCulture)));
            foreach (var av in appVolumes) { av.SetMasterVolume(v, ref ctx); if (v > 0) av.SetMute(false, ref ctx); }
          } else if (line.StartsWith("mute ")) {
            foreach (var av in appVolumes) av.SetMute(line.EndsWith("1"), ref ctx);
          }
        } catch (Exception e) { Err("command '" + line + "' failed: " + e.Message); }
      }
      Environment.Exit(0);
    }

    static void OpenCapture() {
      IMMDevice d; Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out d));
      device = d; device.GetId(out deviceId);
      Guid iidClient = typeof(IAudioClient).GUID; object o;
      Marshal.ThrowExceptionForHR(device.Activate(ref iidClient, 23, IntPtr.Zero, out o));
      client = (IAudioClient)o;
      IntPtr fmt; Marshal.ThrowExceptionForHR(client.GetMixFormat(out fmt));
      int tag = Marshal.ReadInt16(fmt, 0);
      channels = Marshal.ReadInt16(fmt, 2);
      sampleRate = Marshal.ReadInt32(fmt, 4);
      bits = Marshal.ReadInt16(fmt, 14);
      isFloat = tag == 3;
      decim = Math.Max(1, (int)Math.Round(sampleRate / 48000.0)); decimN = 0; decimSum = 0;
      if (tag == unchecked((short)0xFFFE)) {
        byte[] g = new byte[16]; Marshal.Copy(new IntPtr(fmt.ToInt64() + 24), g, 0, 16);
        isFloat = new Guid(g) == new Guid("00000003-0000-0010-8000-00aa00389b71");
      }
      // shared mode, loopback, 200 ms buffer
      Marshal.ThrowExceptionForHR(client.Initialize(0, 0x00020000, 2000000, 0, fmt, IntPtr.Zero));
      Marshal.FreeCoTaskMem(fmt);
      Guid iidCap = typeof(IAudioCaptureClient).GUID; object c;
      Marshal.ThrowExceptionForHR(client.GetService(ref iidCap, out c));
      capture = (IAudioCaptureClient)c;
      Marshal.ThrowExceptionForHR(client.Start());
      Err(string.Format("capturing {0} Hz, {1} ch, {2}-bit {3}", sampleRate, channels, bits, isFloat ? "float" : "pcm"));
      ScanSessions();
    }

    static void CloseCapture() {
      try { if (client != null) client.Stop(); } catch { }
      if (capture != null) { try { Marshal.ReleaseComObject(capture); } catch { } }
      if (client != null) { try { Marshal.ReleaseComObject(client); } catch { } }
      capture = null; client = null; deviceId = null;
    }

    static void Drain() {
      uint packet;
      Marshal.ThrowExceptionForHR(capture.GetNextPacketSize(out packet));
      while (packet > 0) {
        IntPtr data; uint frames, flags; ulong p1, p2;
        Marshal.ThrowExceptionForHR(capture.GetBuffer(out data, out frames, out flags, out p1, out p2));
        bool silentBuf = (flags & 2) != 0;
        int bytesPer = bits / 8;
        lock (sync) {
          for (int f = 0; f < frames; f++) {
            float sum = 0;
            if (!silentBuf) {
              for (int ch = 0; ch < channels; ch++) {
                long off = ((long)f * channels + ch) * bytesPer;
                if (isFloat && bits == 32) sum += BitConverter.ToSingle(BitConverter.GetBytes(Marshal.ReadInt32(data, (int)off)), 0);
                else if (bits == 16) sum += Marshal.ReadInt16(data, (int)off) / 32768f;
                else if (bits == 32) sum += Marshal.ReadInt32(data, (int)off) / 2147483648f;
                else if (bits == 24) { int v = (Marshal.ReadByte(data, (int)off) | (Marshal.ReadByte(data, (int)off + 1) << 8) | ((sbyte)Marshal.ReadByte(data, (int)off + 2) << 16)); sum += v / 8388608f; }
              }
            }
            decimSum += sum / Math.Max(1, channels);
            if (++decimN >= decim) {
              ring[ringPos] = decimSum / decim;
              ringPos = (ringPos + 1) % ring.Length;
              decimN = 0; decimSum = 0;
            }
          }
        }
        capture.ReleaseBuffer(frames);
        Marshal.ThrowExceptionForHR(capture.GetNextPacketSize(out packet));
      }
    }

    static double[] re = new double[FFT], im = new double[FFT];
    static string Spectrum(double[] smooth) {
      lock (sync) {
        int start = (ringPos - FFT + ring.Length) % ring.Length;
        for (int i = 0; i < FFT; i++) {
          double w = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (FFT - 1));
          re[i] = ring[(start + i) % ring.Length] * w; im[i] = 0;
        }
      }
      Fft(re, im);
      var sb = new StringBuilder(bands);
      double lo = 45, hi = Math.Min(12000, sampleRate / decim / 2.0);
      double rate = (double)sampleRate / decim;
      double binHz = rate / FFT;
      if (bandDb == null || bandDb.Length != bands) bandDb = new double[bands];
      double frameMax = -200;
      for (int b = 0; b < bands; b++) {
        double f0 = lo * Math.Pow(hi / lo, (double)b / bands), f1 = lo * Math.Pow(hi / lo, (double)(b + 1) / bands);
        double fc = Math.Sqrt(f0 * f1);
        double power;
        int i0 = (int)Math.Ceiling(f0 / binHz), i1 = (int)Math.Floor(f1 / binHz);
        if (i1 >= i0 && i1 - i0 >= 1) {
          // wide band: average energy of the bins inside it
          double sum = 0; int n = 0;
          for (int i = Math.Max(1, i0); i <= i1 && i < FFT / 2; i++) { sum += re[i] * re[i] + im[i] * im[i]; n++; }
          power = n > 0 ? sum / n : 0;
        } else {
          // band narrower than a bin (bass): interpolate between the two nearest bins
          double x = fc / binHz; int k = Math.Max(1, (int)Math.Floor(x)); double t = x - k;
          double p0 = re[k] * re[k] + im[k] * im[k], p1 = re[k + 1] * re[k + 1] + im[k + 1] * im[k + 1];
          power = p0 * (1 - t) + p1 * t;
        }
        double db = 10 * Math.Log10(power / ((double)FFT * FFT) + 1e-14);
        db += 3.0 * Math.Log(fc / 1000.0, 2); // music falls off with frequency; lift highs a little
        bandDb[b] = db;
        if (db > frameMax) frameMax = db;
      }
      // automatic gain: follow the loudest band, decaying slowly so quiet passages still read as quieter
      if (frameMax > gainRef) gainRef = frameMax; else gainRef = Math.Max(frameMax, gainRef - 0.12);
      const double range = 38; // dB shown between empty and full bar
      for (int b = 0; b < bands; b++) {
        double level = (bandDb[b] - (gainRef - range)) / (range + 5); // 5 dB headroom so loud bands aren't pinned
        level = Math.Max(0, Math.Min(1, level));
        level = level * level * (3 - 2 * level); // ease: keeps the floor quiet and peaks punchy
        sb.Append((char)('0' + (int)Math.Round(level * 63)));
      }
      return sb.ToString();
    }

    static void Fft(double[] r, double[] i) {
      int n = r.Length;
      for (int j = 1, k = 0; j < n; j++) {
        int bit = n >> 1;
        for (; (k & bit) != 0; bit >>= 1) k ^= bit;
        k ^= bit;
        if (j < k) { double t = r[j]; r[j] = r[k]; r[k] = t; t = i[j]; i[j] = i[k]; i[k] = t; }
      }
      for (int len = 2; len <= n; len <<= 1) {
        double ang = -2 * Math.PI / len, wr = Math.Cos(ang), wi = Math.Sin(ang);
        for (int s = 0; s < n; s += len) {
          double cr = 1, ci = 0;
          for (int k = 0; k < len / 2; k++) {
            int a = s + k, b = s + k + len / 2;
            double xr = r[b] * cr - i[b] * ci, xi = r[b] * ci + i[b] * cr;
            r[b] = r[a] - xr; i[b] = i[a] - xi; r[a] += xr; i[a] += xi;
            double ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
          }
        }
      }
    }

    static void ScanSessions() {
      lastSessionScan = DateTime.Now;
      if (device == null) return;
      try {
        Guid iid = typeof(IAudioSessionManager2).GUID; object o;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out o));
        var mgr = (IAudioSessionManager2)o;
        IAudioSessionEnumerator en; Marshal.ThrowExceptionForHR(mgr.GetSessionEnumerator(out en));
        int n; en.GetCount(out n);
        ISimpleAudioVolume foundVol = null; int bestState = -1;
        var vols = new System.Collections.Generic.List<ISimpleAudioVolume>();
        var meters = new System.Collections.Generic.List<IAudioMeterInformation>();
        for (int k = 0; k < n; k++) {
          IAudioSessionControl2 s; en.GetSession(k, out s);
          uint pid; s.GetProcessId(out pid);
          if (pid == 0) continue;
          string name;
          try { name = Process.GetProcessById((int)pid).ProcessName; } catch { continue; }
          if (!procMatch.IsMatch(name)) continue;
          int st; s.GetState(out st); // 1 = active
          vols.Add((ISimpleAudioVolume)s); meters.Add((IAudioMeterInformation)s);
          if (st > bestState) { bestState = st; foundVol = (ISimpleAudioVolume)s; }
        }
        appVolume = foundVol; appVolumes = vols.ToArray(); appMeters = meters.ToArray();
      } catch (Exception e) { Err("session scan failed: " + e.Message); }
    }

    static void ReportVolume() {
      string status;
      var av = appVolume;
      if (av == null) status = "S 1 0 0";
      else {
        try {
          float v; bool m; av.GetMasterVolume(out v); av.GetMute(out m);
          status = string.Format(System.Globalization.CultureInfo.InvariantCulture, "S {0:0.###} {1} 1", v, m ? 1 : 0);
        } catch { appVolume = null; status = "S 1 0 0"; }
      }
      if (status != lastStatus) { lastStatus = status; Out(status); }
    }
  }
}
'@

[EdgeAudio.Bridge]::Run($Bands, $ProcessMatch)
