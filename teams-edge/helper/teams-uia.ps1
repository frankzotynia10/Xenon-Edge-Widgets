# Teams meeting bridge via Windows UI Automation (the accessibility API screen readers use).
# Used because Teams' own local "third-party app API" isn't available on this PC.
# Reads the meeting window's buttons (stable ids like microphone-button / hangup-button) and
# invokes them directly - no keystrokes, no focus stealing.
#
# stdout: {"type":"meeting", inMeeting, title, isMuted, isVideoOn, isHandRaised, isSharing, can...}
#         {"type":"log", msg}
# stdin:  mute | video | hand | chat | share | leave | react <like|love|applause|wow|laugh>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]
function Cond($p, $v) { New-Object System.Windows.Automation.PropertyCondition($p, $v) }
function Emit($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }
function Log($m) { Emit ([ordered]@{ type = 'log'; msg = $m }) }

$IDS = @{ mute = 'microphone-button'; video = 'video-button'; hand = 'raisehands-button'; react = 'reaction-menu-button';
          chat = 'chat-button'; share = 'share-button'; leave = 'hangup-button' }
$REACT_NAMES = @{ like = 'Like'; love = 'Heart'; applause = 'Applause'; wow = 'Surprised'; laugh = 'Laugh' }

$script:win = $null; $script:btn = @{}; $script:lastScan = [DateTime]::MinValue

$script:checked = @{}   # hwnd -> "title|time" of windows already searched with no hang-up button
function Find-MeetingWindow {
  $ids = @((Get-Process ms-teams -ErrorAction SilentlyContinue).Id)
  if (-not $ids.Count) { return $null }
  $now = [DateTime]::Now
  foreach ($w in $AE::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
    if ($ids -notcontains $w.Current.ProcessId) { continue }
    # Searching a Teams window's whole tree is the expensive (and leaky) part, so only do it when
    # the window is new, its title changed, or 30 s have passed since it was last searched.
    $hwnd = $w.Current.NativeWindowHandle; $title = [string]$w.Current.Name
    $seen = $script:checked[$hwnd]
    if ($seen -and $seen.Title -eq $title -and ($now - $seen.At).TotalSeconds -lt 30) { continue }
    $h = $w.FindFirst($TS::Descendants, (Cond $AE::AutomationIdProperty 'hangup-button'))
    if ($h) { $script:checked.Remove($hwnd); return $w }
    $script:checked[$hwnd] = @{ Title = $title; At = $now }
  }
  return $null
}

function Refresh-Buttons {
  $script:btn = @{}
  if (-not $script:win) { return }
  foreach ($k in $IDS.Keys) {
    $e = $script:win.FindFirst($TS::Descendants, (Cond $AE::AutomationIdProperty $IDS[$k]))
    if ($e) { $script:btn[$k] = $e }
  }
}

function Name-Of($k) { try { if ($script:btn[$k]) { return [string]$script:btn[$k].Current.Name } } catch { } return '' }
function Enabled-Of($k) { try { if ($script:btn[$k]) { return [bool]$script:btn[$k].Current.IsEnabled } } catch { } return $false }

function Read-State {
  # re-find the meeting window every couple of seconds (it appears/disappears with calls)
  if (-not $script:win -or ([DateTime]::Now - $script:lastScan).TotalSeconds -ge 2) {
    $script:lastScan = [DateTime]::Now
    $w = Find-MeetingWindow
    if (-not $w) { $script:win = $null; $script:btn = @{} }
    elseif (-not $script:win -or $w.Current.NativeWindowHandle -ne $script:win.Current.NativeWindowHandle -or -not $script:btn['leave']) { $script:win = $w; Refresh-Buttons }
  }
  if (-not $script:win) { return [ordered]@{ type = 'meeting'; inMeeting = $false } }
  try { $title = [string]$script:win.Current.Name } catch { $script:win = $null; return [ordered]@{ type = 'meeting'; inMeeting = $false } }
  $title = $title -replace '\s*\|\s*Microsoft Teams\s*$', ''
  $mic = Name-Of 'mute'; $cam = Name-Of 'video'; $hand = Name-Of 'hand'; $share = Name-Of 'share'; $chat = Name-Of 'chat'
  return [ordered]@{
    type = 'meeting'; inMeeting = $true; title = $title
    isMuted = [bool]($mic -match '^(?i)unmute')
    isVideoOn = [bool]($cam -match '(?i)turn camera off|stop video|camera off$')
    isHandRaised = [bool]($hand -match '(?i)lower')
    isSharing = [bool]($share -match '(?i)stop')
    hasUnreadMessages = [bool]($chat -match '(?i)unread|new message')
    canToggleMute = (Enabled-Of 'mute'); canToggleVideo = (Enabled-Of 'video'); canToggleHand = (Enabled-Of 'hand')
    canReact = (Enabled-Of 'react'); canToggleChat = (Enabled-Of 'chat'); canToggleShareTray = (Enabled-Of 'share'); canLeave = (Enabled-Of 'leave')
    raw = [ordered]@{ mic = $mic; cam = $cam; hand = $hand; share = $share; chat = $chat }
  }
}

function Invoke-Btn($k) {
  $e = $script:btn[$k]
  if (-not $e) { Refresh-Buttons; $e = $script:btn[$k] }
  if (-not $e) { Log "no '$k' button in the meeting window"; return $false }
  try {
    $p = $null
    try { $p = $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) } catch { }
    if ($p) { $p.Invoke(); return $true }
    $t = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern); $t.Toggle(); return $true
  } catch { Log "couldn't press '$k': $($_.Exception.Message)"; Refresh-Buttons; return $false }
}

function Send-Reaction($type) {
  $want = $REACT_NAMES[$type]
  if (-not $want) { return }
  if (-not (Invoke-Btn 'react')) { return }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.ElapsedMilliseconds -lt 2500) {
    Start-Sleep -Milliseconds 150
    $cands = $script:win.FindAll($TS::Descendants, (Cond $AE::ControlTypeProperty $CT::Button)) + $script:win.FindAll($TS::Descendants, (Cond $AE::ControlTypeProperty $CT::MenuItem))
    foreach ($c in $cands) {
      $n = [string]$c.Current.Name
      if ($n -eq $want -or $n -like "$want reaction*" -or $n -like "*$want" -and $n.Length -lt 30) {
        try { $c.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); return } catch { }
      }
    }
  }
  Log "reaction '$want' not found in the reactions menu"
  Invoke-Btn 'react' | Out-Null   # close the menu again
}

$stdin = New-Object IO.StreamReader([Console]::OpenStandardInput(), [Text.Encoding]::UTF8)
$task = $stdin.ReadLineAsync()
$last = ''
Log 'Teams UI Automation bridge started'
# The managed UI Automation client leaks native memory on repeated tree searches (it reached 13 GB
# in two days). Collect regularly, and exit when it still grows; index.js restarts us in 3 s.
$me = Get-Process -Id $PID
$gcTimer = [Diagnostics.Stopwatch]::StartNew()
while ($true) {
  if ($gcTimer.Elapsed.TotalSeconds -ge 30) {
    $gcTimer.Restart()
    [GC]::Collect(); [GC]::WaitForPendingFinalizers(); [GC]::Collect()
    $me.Refresh(); $mb = [math]::Round($me.PrivateMemorySize64 / 1MB)
    if (($mb -gt 400 -and -not $script:win) -or $mb -gt 1500) { Log "recycling at $mb MB"; exit 0 }
  }
  while ($task.IsCompleted) {
    $line = $task.Result
    if ($null -eq $line) { exit 0 }
    $task = $stdin.ReadLineAsync()
    $parts = $line.Trim().Split(' ')
    try {
      switch ($parts[0]) {
        'react' { Send-Reaction $parts[1] }
        default { if ($IDS.ContainsKey($parts[0])) { [void](Invoke-Btn $parts[0]) } }
      }
    } catch { Log "command '$line' failed: $($_.Exception.Message)" }
    $script:lastScan = [DateTime]::MinValue
  }
  try { $s = Read-State } catch { $script:win = $null; $s = [ordered]@{ type = 'meeting'; inMeeting = $false } }
  $j = $s | ConvertTo-Json -Compress -Depth 4
  if ($j -ne $last) { $last = $j; [Console]::Out.WriteLine($j); [Console]::Out.Flush() }
  Start-Sleep -Milliseconds 400
}
