# Bridge to Windows' media session API (SMTC) for the Apple Music Edge helper.
# Writes one JSON line to stdout whenever the Apple Music session changes.
# Reads commands from stdin, one per line: play, pause, toggle, next, prev.
param([string]$AppMatch = 'AppleMusic|iTunes')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(5000)) { throw 'WinRT call timed out' }
  $task.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
Add-Type -AssemblyName System.Drawing
$ArtSize = 400
$AsStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
$MgrT =[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$PropsT = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Await ($MgrT::RequestAsync()) $MgrT

function Find-Session {
  foreach ($s in $mgr.GetSessions()) { if ($s.SourceAppUserModelId -match $AppMatch) { return $s } }
  return $null
}

function Read-Thumbnail($ref) {
  if (-not $ref) { return $null }
  $src = $null; $img = $null; $bmp = $null
  try {
    $stream = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    # PowerShell can't call interface methods on WinRT COM objects directly; reflection does the cast.
    $src = $AsStreamForRead.Invoke($null, @($stream))
    $ms = New-Object IO.MemoryStream
    $src.CopyTo($ms)
    if ($ms.Length -eq 0) { return $null }
    $ms.Position = 0
    # Apple Music hands over ~800 KB artwork; shrink it so the widget gets a small JPEG.
    $img = [System.Drawing.Image]::FromStream($ms)
    $side = [math]::Min($ArtSize, [math]::Max($img.Width, $img.Height))
    $bmp = New-Object System.Drawing.Bitmap($side, $side)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, $side, $side)
    $g.Dispose()
    $out = New-Object IO.MemoryStream
    $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]88)
    $bmp.Save($out, $enc, $ep)
    return 'data:image/jpeg;base64,' + [Convert]::ToBase64String($out.ToArray())
  } catch {
    [Console]::Error.WriteLine("artwork failed: $($_.Exception.Message)")
    return $null
  } finally {
    if ($bmp) { $bmp.Dispose() }; if ($img) { $img.Dispose() }; if ($src) { $src.Dispose() }
  }
}

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

$lastKey = $null
$lastJson = $null
$art = $null
$stdin = New-Object IO.StreamReader([Console]::OpenStandardInput(), [Text.Encoding]::UTF8)
$stdinTask = $stdin.ReadLineAsync()

while ($true) {
  # --- commands from the Node helper ---
  while ($stdinTask.IsCompleted) {
    $cmd = $stdinTask.Result
    if ($null -eq $cmd) { exit 0 }  # parent closed stdin
    $s = Find-Session
    if ($s) {
      try {
        switch ($cmd.Trim()) {
          'toggle' { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
          'play'   { $null = Await ($s.TryPlayAsync()) ([bool]) }
          'pause'  { $null = Await ($s.TryPauseAsync()) ([bool]) }
          'next'   { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
          'prev'   { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
        }
      } catch { [Console]::Error.WriteLine("command $cmd failed: $($_.Exception.Message)") }
    }
    $stdinTask = $stdin.ReadLineAsync()
  }

  # --- current state ---
  try {
    $s = Find-Session
    if (-not $s) {
      $out = @{ type = 'state'; active = $false }
      $lastKey = $null; $art = $null
    } else {
      $p = Await ($s.TryGetMediaPropertiesAsync()) $PropsT
      $pb = $s.GetPlaybackInfo()
      $tl = $s.GetTimelineProperties()
      $key = "$($p.Title)|$($p.Artist)|$($p.AlbumTitle)"
      $artChanged = $false
      if ($key -ne $lastKey) {
        $art = Read-Thumbnail $p.Thumbnail
        # Apple Music sometimes publishes the title before the artwork; retry once shortly after.
        if (-not $art -and $p.Thumbnail) { Start-Sleep -Milliseconds 400; $art = Read-Thumbnail $p.Thumbnail }
        $lastKey = $key; $artChanged = $true
      }
      $out = @{
        type = 'state'; active = $true
        app = $s.SourceAppUserModelId
        title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle
        status = [string]$pb.PlaybackStatus
        canNext = [bool]$pb.Controls.IsNextEnabled; canPrev = [bool]$pb.Controls.IsPreviousEnabled
        position = [math]::Round($tl.Position.TotalSeconds, 2)
        duration = [math]::Round(($tl.EndTime - $tl.StartTime).TotalSeconds, 2)
        updatedAt = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
        trackKey = $key
      }
    }
    $json = $out | ConvertTo-Json -Compress -Depth 4
    if ($json -ne $lastJson -or $artChanged) {
      $lastJson = $json
      if ($out.active -and $artChanged) { $out.art = $art }
      Emit $out
    }
  } catch {
    [Console]::Error.WriteLine("poll failed: $($_.Exception.Message)")
  }
  Start-Sleep -Milliseconds 400
}
