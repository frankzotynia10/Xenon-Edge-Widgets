# UI Automation bridge for the Apple Music Edge helper.
# Apple Music for Windows doesn't expose shuffle / repeat / favorite / browsing to other apps,
# so this drives the Apple Music window's own controls through Windows UI Automation
# (the accessibility API screen readers use). No clicks or keystrokes are simulated.
#
# stdout: {"type":"ext", shuffle, repeat:'off'|'all'|'one', favorite:true|false|null, hasTrack}
#         {"type":"reply", id, ok, data | error}
# stdin:  {"id":1,"cmd":"shuffle"|"repeat"|"favorite"|"seek"|"playlists"|"list"|"play"|"playAll"|"search", ...}
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]
$Raw = [System.Windows.Automation.TreeWalker]::RawViewWalker
$True_ = [System.Windows.Automation.Condition]::TrueCondition
function Cond($prop, $v) { New-Object System.Windows.Automation.PropertyCondition($prop, $v) }
function ById($scope, $id) { $scope.FindFirst($TS::Descendants, (Cond $AE::AutomationIdProperty $id)) }
function Pat($e, $p) { $e.GetCurrentPattern($p::Pattern) }
function Invoke-El($e) { (Pat $e ([System.Windows.Automation.InvokePattern])).Invoke() }
function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6)); [Console]::Out.Flush() }
function Log($m) { [Console]::Error.WriteLine($m) }

$script:root = $null; $script:hwnd = 0; $script:bar = $null; $script:lastRootCheck = [DateTime]::MinValue

function Get-Root {
  if ($script:root -and ([DateTime]::Now - $script:lastRootCheck).TotalSeconds -lt 5) { return $script:root }
  $script:lastRootCheck = [DateTime]::Now
  $p = Get-Process -Name AppleMusic -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { $script:root = $null; $script:bar = $null; $script:hwnd = 0; return $null }
  if ($p.MainWindowHandle -ne $script:hwnd -or -not $script:root) {
    $script:hwnd = $p.MainWindowHandle
    $script:root = $AE::FromHandle($p.MainWindowHandle)
    $script:bar = $null
  }
  return $script:root
}
function Reset-Root { $script:root = $null; $script:bar = $null; $script:hwnd = 0; $script:lastRootCheck = [DateTime]::MinValue }

function Get-Bar {
  $r = Get-Root; if (-not $r) { throw 'Apple Music is not open' }
  if (-not $script:bar) { $script:bar = ById $r 'TransportBar' }
  if (-not $script:bar) { throw 'Apple Music player bar not found' }
  return $script:bar
}

# ---------- now-playing extras ----------
function Get-FavButton($bar) { $bar.FindFirst($TS::Descendants, (Cond $AE::NameProperty 'Favorite')) }
function Read-Ext {
  $bar = Get-Bar
  $sh = ById $bar 'ShuffleButton'
  $rep = ById $bar 'RepeatButton'
  $lcd = ById $bar 'LCD'
  $fav = $null
  $fb = Get-FavButton $bar
  if ($fb) {
    $g = $Raw.GetFirstChild($fb)
    if ($g) {
      $n = $g.Current.Name
      # The star icon is a symbol-font glyph: U+100EC3 = filled (favorited), U+100EC2 = outline.
      if ($n.Length -ge 2) { $c = [int]$n[1]; if ($c -eq 0xDEC3) { $fav = $true } elseif ($c -eq 0xDEC2) { $fav = $false } }
    }
  }
  $repeat = 'off'
  if ($rep) { switch -Wildcard ($rep.Current.Name) { 'Repeat One*' { $repeat = 'one' } 'Repeat All*' { $repeat = 'all' } 'Repeat' { $repeat = 'all' } } }
  $shuffle = $false
  if ($sh) { $shuffle = (Pat $sh ([System.Windows.Automation.TogglePattern])).Current.ToggleState -eq 'On' }
  return [ordered]@{ type = 'ext'; available = $true; shuffle = $shuffle; repeat = $repeat; favorite = $fav; hasTrack = [bool]($lcd -and $lcd.Current.Name) }
}

# ---------- sidebar / pages ----------
function Get-Sidebar($id) { $r = Get-Root; if (-not $r) { throw 'Apple Music is not open' }; ById $r $id }

function Expand-Playlists {
  $h = Get-Sidebar 'Sidebar_Header_Playlists'
  if ($h) {
    try { $ec = Pat $h ([System.Windows.Automation.ExpandCollapsePattern]); if ($ec.Current.ExpandCollapseState -ne 'Expanded') { $ec.Expand(); Start-Sleep -Milliseconds 400 } } catch {}
  }
}

function Get-Playlists {
  Expand-Playlists
  $r = Get-Root
  $items = $r.FindAll($TS::Descendants, (Cond $AE::ClassNameProperty 'Microsoft.UI.Xaml.Controls.NavigationViewItem'))
  $out = @()
  foreach ($i in $items) {
    $id = $i.Current.AutomationId
    if ($id -like 'DBID:*IKIND:ePlaylist') { $out += [ordered]@{ id = $id; name = $i.Current.Name.Trim() } }
  }
  return ,$out
}

function Get-ContentList {
  $r = Get-Root
  $content = $r.FindFirst($TS::Descendants, (New-Object System.Windows.Automation.AndCondition((Cond $AE::NameProperty 'Content'), (Cond $AE::ControlTypeProperty $CT::Group))))
  $scope = if ($content) { $content } else { $r }
  return $scope.FindFirst($TS::Descendants, (Cond $AE::ClassNameProperty 'ListView'))
}

$script:page = $null   # target currently shown in Apple Music, as far as we know
$script:rows = $null   # cached song row elements for $script:page

function Open-Target($target) {
  $navId = if ($target -eq 'songs') { 'Sidebar_Library_Songs' } else { $target }
  if ($navId -like 'DBID:*') { Expand-Playlists }
  $nav = Get-Sidebar $navId
  if (-not $nav) { throw "Couldn't find '$target' in the Apple Music sidebar" }
  $sel = Pat $nav ([System.Windows.Automation.SelectionItemPattern])
  $already = $sel.Current.IsSelected -and $script:page -eq $target -and $script:rows
  if ($already) { return }
  $before = Get-ContentList
  $beforeId = if ($before) { ($before.GetRuntimeId() -join '.') } else { '' }
  $sel.Select()
  $script:page = $target; $script:rows = $null
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Start-Sleep -Milliseconds 350
  while ($sw.ElapsedMilliseconds -lt 5000) {
    $l = Get-ContentList
    if ($l -and (($l.GetRuntimeId() -join '.') -ne $beforeId -or $sel.Current.IsSelected)) {
      $ic = Pat $l ([System.Windows.Automation.ItemContainerPattern])
      if ($ic.FindItemByProperty($null, $null, $null)) { Start-Sleep -Milliseconds 250; return }
    }
    Start-Sleep -Milliseconds 150
  }
  throw "Apple Music didn't open '$target'"
}

$TimeRx = '^\d{1,2}:\d{2}(:\d{2})?$'
function Get-Rows {
  if ($script:rows) { return $script:rows }
  $l = Get-ContentList
  if (-not $l) { throw 'No song list on screen' }
  $ic = Pat $l ([System.Windows.Automation.ItemContainerPattern])
  # Apple Music loads long lists in chunks; walk until the count stops growing.
  $prev = -1; $rows = $null
  for ($try = 0; $try -lt 12; $try++) {
    $rows = New-Object System.Collections.ArrayList
    $l = Get-ContentList
    $ic = Pat $l ([System.Windows.Automation.ItemContainerPattern])
    $cur = $null
    while ($true) {
      $cur = $ic.FindItemByProperty($cur, $null, $null)
      if (-not $cur) { break }
      $c = $cur.Current
      # song rows are ListViewItems (rows not yet on screen are named after their data type)
      if ($c.ClassName -eq 'ListViewItem' -and $c.Name -notmatch ' Updated ') { [void]$rows.Add($cur) }
    }
    if ($rows.Count -eq $prev -and $rows.Count -gt 0) { break }
    $prev = $rows.Count
    Start-Sleep -Milliseconds 400
  }
  $script:rows = $rows
  return $rows
}

function Read-Texts($el) {
  # direct TextBlocks under the row (raw view), skipping glyph-only text and button labels
  $texts = New-Object System.Collections.ArrayList
  $stack = New-Object System.Collections.Stack
  $stack.Push($el)
  while ($stack.Count) {
    $e = $stack.Pop()
    $kids = New-Object System.Collections.ArrayList
    $ch = $Raw.GetFirstChild($e)
    while ($ch) { [void]$kids.Add($ch); $ch = $Raw.GetNextSibling($ch) }
    for ($k = $kids.Count - 1; $k -ge 0; $k--) {
      $x = $kids[$k]; $cx = $x.Current
      if ($cx.ControlType -eq $CT::Button -or $cx.ControlType -eq $CT::Hyperlink -or $cx.ControlType -eq $CT::Image) { continue }
      $stack.Push($x)
    }
    if ($e -ne $el -and $e.Current.ClassName -eq 'TextBlock') {
      $n = $e.Current.Name
      if ($n -and $n -match '[\p{L}\p{N}]') { [void]$texts.Add($n.Trim()) }
    }
  }
  return ,$texts
}

function Parse-Row($el, $i) {
  try { (Pat $el ([System.Windows.Automation.VirtualizedItemPattern])).Realize() } catch {}
  $texts = Read-Texts $el
  $title = ''; $time = ''; $rest = @()
  foreach ($t in $texts) {
    if (-not $title) { $title = $t; continue }
    if (-not $time -and $t -match $TimeRx) { $time = $t; continue }
    if ($t -eq 'Explicit' -or $t -match '^\d+$') { continue }
    $rest += $t
  }
  if (-not $title) { $title = $el.Current.Name }
  return [ordered]@{ i = $i; title = $title; artist = ($rest | Select-Object -First 1); album = ($rest | Select-Object -Skip 1 -First 1); time = $time }
}

function List-Target($target, [int]$offset, [int]$count) {
  Open-Target $target
  $rows = Get-Rows
  $items = @()
  $end = [Math]::Min($rows.Count, $offset + $count)
  for ($i = $offset; $i -lt $end; $i++) { $items += (Parse-Row $rows[$i] $i) }
  return [ordered]@{ target = $target; total = $rows.Count; offset = $offset; items = $items }
}

function Find-MenuItem($pattern, [int]$timeoutMs = 2500) {
  $r = Get-Root
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.ElapsedMilliseconds -lt $timeoutMs) {
    $mis = $r.FindAll($TS::Descendants, (Cond $AE::ControlTypeProperty $CT::MenuItem))
    foreach ($m in $mis) { if ($m.Current.Name -like $pattern) { return $m } }
    Start-Sleep -Milliseconds 120
  }
  return $null
}

function Find-MoreButton($row) {
  $b = $row.FindFirst($TS::Descendants, (Cond $AE::AutomationIdProperty 'MoreButton'))
  if (-not $b) { $b = $row.FindFirst($TS::Descendants, (New-Object System.Windows.Automation.AndCondition((Cond $AE::NameProperty 'More'), (Cond $AE::ControlTypeProperty $CT::Button)))) }
  return $b
}

function Run-RowMenu($row, $mode) {
  try { (Pat $row ([System.Windows.Automation.VirtualizedItemPattern])).Realize() } catch {}
  Start-Sleep -Milliseconds 120
  $more = Find-MoreButton $row
  if (-not $more) { throw 'No menu button on that song' }
  Invoke-El $more
  Start-Sleep -Milliseconds 250
  $pattern = switch ($mode) { 'next' { 'Play Next' } 'queue' { 'Add to Queue' } default { 'Play ?*' } }
  $mi = Find-MenuItem $pattern
  if (-not $mi -and $mode -eq 'play') { $mi = Find-MenuItem 'Play' 500 }
  if (-not $mi) {
    try { Invoke-El $more } catch {}  # close the menu again
    throw "Apple Music's menu had no '$pattern'"
  }
  Invoke-El $mi
}

function Get-FreshRow([int]$i) {
  # Apple Music recycles row containers as its list scrolls, so cached row elements can end up
  # pointing at a different song. Walk to row $i again, realize it, then walk once more.
  for ($pass = 0; $pass -lt 2; $pass++) {
    $l = Get-ContentList
    if (-not $l) { return $null }
    $ic = Pat $l ([System.Windows.Automation.ItemContainerPattern])
    $cur = $null; $k = -1
    while ($true) {
      $cur = $ic.FindItemByProperty($cur, $null, $null)
      if (-not $cur) { return $null }
      $c = $cur.Current
      if ($c.ClassName -eq 'ListViewItem' -and $c.Name -notmatch ' Updated ') { $k++; if ($k -eq $i) { break } }
    }
    if ($pass -eq 0) { try { (Pat $cur ([System.Windows.Automation.VirtualizedItemPattern])).Realize() } catch {}; Start-Sleep -Milliseconds 150 }
  }
  return $cur
}

function Play-Target($target, [int]$i, $title, $mode) {
  if ($target -eq 'search') { return Play-Search $i $title $mode }
  Open-Target $target
  $row = Get-FreshRow $i
  if ($row -and $title) {
    $texts = Read-Texts $row
    if (-not $texts.Count -or $texts[0] -ne $title) {
      $script:rows = $null
      throw "The list changed in Apple Music - reopen it and try again"
    }
  }
  if (-not $row) { throw "Couldn't find '$title' any more" }
  Run-RowMenu $row $mode
  return [ordered]@{ played = $title; mode = $mode }
}

function PlayAll-Target($target, [bool]$shuffle) {
  Open-Target $target
  $r = Get-Root
  $id = if ($shuffle) { 'ShuffleButtonElement' } else { 'PlayButtonElement' }
  $b = ById $r $id
  if (-not $b) { throw "This page has no $(if ($shuffle) { 'Shuffle' } else { 'Play' }) button" }
  Invoke-El $b
  return [ordered]@{ target = $target; shuffle = $shuffle }
}

# ---------- search ----------
$script:searchQ = $null
function Get-SearchSongsGrid {
  $l = Get-ContentList
  if (-not $l) { return $null }
  $ic = Pat $l ([System.Windows.Automation.ItemContainerPattern])
  $cur = $null
  while ($true) {
    $cur = $ic.FindItemByProperty($cur, $null, $null)
    if (-not $cur) { return $null }
    if ($cur.Current.Name -eq 'Songs') {
      try { (Pat $cur ([System.Windows.Automation.VirtualizedItemPattern])).Realize() } catch {}
      Start-Sleep -Milliseconds 200
      return $cur.FindFirst($TS::Descendants, (Cond $AE::ClassNameProperty 'GridView'))
    }
  }
}

function Run-Search($q) {
  $r = Get-Root; if (-not $r) { throw 'Apple Music is not open' }
  $tb = ById $r 'TextBox'
  if (-not $tb) { throw 'Search box not found' }
  (Pat $tb ([System.Windows.Automation.ValuePattern])).SetValue($q)
  Start-Sleep -Milliseconds 250
  $asb = $r.FindFirst($TS::Descendants, (Cond $AE::ClassNameProperty 'AutoSuggestBox'))
  Invoke-El $asb
  $script:page = 'search'; $script:rows = $null; $script:searchQ = $q
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Start-Sleep -Milliseconds 800
  while ($sw.ElapsedMilliseconds -lt 8000) {
    $g = Get-SearchSongsGrid
    if ($g) { return $g }
    Start-Sleep -Milliseconds 300
  }
  return $null
}

function Search-Songs($q) {
  $g = Run-Search $q
  $items = @()
  if ($g) {
    $ic = Pat $g ([System.Windows.Automation.ItemContainerPattern])
    $cur = $null; $i = 0
    while ($i -lt 40) {
      $cur = $ic.FindItemByProperty($cur, $null, $null)
      if (-not $cur) { break }
      try { (Pat $cur ([System.Windows.Automation.VirtualizedItemPattern])).Realize() } catch {}
      $texts = Read-Texts $cur
      $title = if ($texts.Count) { $texts[0] } else { $cur.Current.Name }
      $artist = ($texts | Select-Object -Skip 1 | Where-Object { $_ -ne 'Explicit' } | Select-Object -First 1)
      $items += [ordered]@{ i = $i; title = $title; artist = $artist; album = ''; time = '' }
      $i++
    }
  }
  return [ordered]@{ target = 'search'; q = $q; total = $items.Count; offset = 0; items = $items }
}

function Play-Search([int]$i, $title, $mode) {
  $g = Get-SearchSongsGrid
  if (-not $g -or $script:page -ne 'search') { if (-not $script:searchQ) { throw 'Search again first' }; $g = Run-Search $script:searchQ }
  if (-not $g) { throw 'Search results are gone' }
  $ic = Pat $g ([System.Windows.Automation.ItemContainerPattern])
  $cur = $null; $k = 0; $row = $null
  while ($true) {
    $cur = $ic.FindItemByProperty($cur, $null, $null)
    if (-not $cur) { break }
    if ($k -eq $i -or ($title -and $cur.Current.Name -like "$title*")) { $row = $cur; if ($k -eq $i) { break } }
    $k++
  }
  if (-not $row) { throw "Couldn't find '$title' in the results" }
  Run-RowMenu $row $mode
  return [ordered]@{ played = $title; mode = $mode }
}

# ---------- main loop ----------
function Handle($msg) {
  switch ($msg.cmd) {
    'shuffle' { $sh = ById (Get-Bar) 'ShuffleButton'; (Pat $sh ([System.Windows.Automation.TogglePattern])).Toggle(); return $null }
    'repeat' { Invoke-El (ById (Get-Bar) 'RepeatButton'); return $null }
    'favorite' {
      $fb = Get-FavButton (Get-Bar)
      if (-not $fb) { throw 'Nothing to favorite' }
      Invoke-El $fb; return $null
    }
    'seek' {
      $sc = ById (Get-Bar) 'LCDScrubber'
      if (-not $sc) { throw 'No seek bar' }
      $rv = Pat $sc ([System.Windows.Automation.RangeValuePattern])
      $max = $rv.Current.Maximum
      if ($max -le 0) { throw 'Seek bar not ready' }
      $rv.SetValue([Math]::Max(0, [Math]::Min($max, [double]$msg.pos))); return $null
    }
    'playlists' { return [ordered]@{ playlists = (Get-Playlists) } }
    'list' { return (List-Target $msg.target ([int]$msg.offset) ([int]$(if ($msg.count) { $msg.count } else { 40 }))) }
    'play' { return (Play-Target $msg.target ([int]$msg.i) $msg.title $(if ($msg.mode) { $msg.mode } else { 'play' })) }
    'playAll' { return (PlayAll-Target $msg.target ([bool]$msg.shuffle)) }
    'search' { return (Search-Songs ([string]$msg.q)) }
    default { throw "Unknown command $($msg.cmd)" }
  }
}

$stdin = New-Object IO.StreamReader([Console]::OpenStandardInput(), [Text.Encoding]::UTF8)
$stdinTask = $stdin.ReadLineAsync()
$lastExt = $null
$nextPoll = [DateTime]::MinValue

while ($true) {
  $handled = $false
  while ($stdinTask.IsCompleted) {
    $line = $stdinTask.Result
    if ($null -eq $line) { exit 0 }
    $stdinTask = $stdin.ReadLineAsync()
    if (-not $line.Trim()) { continue }
    $msg = $null
    try { $msg = $line | ConvertFrom-Json } catch { Log "bad command: $line"; continue }
    try {
      $data = Handle $msg
      Emit ([ordered]@{ type = 'reply'; id = $msg.id; ok = $true; data = $data })
    } catch {
      Log "command $($msg.cmd) failed: $($_.Exception.Message)"
      if ($_.Exception -is [System.Windows.Automation.ElementNotAvailableException]) { Reset-Root }
      Emit ([ordered]@{ type = 'reply'; id = $msg.id; ok = $false; error = $_.Exception.Message })
    }
    $handled = $true
  }
  if ($handled -or [DateTime]::Now -ge $nextPoll) {
    $nextPoll = [DateTime]::Now.AddMilliseconds(800)
    try { $ext = Read-Ext } catch {
      if ($_.Exception -is [System.Windows.Automation.ElementNotAvailableException]) { Reset-Root }
      $script:bar = $null
      $ext = [ordered]@{ type = 'ext'; available = $false; shuffle = $false; repeat = 'off'; favorite = $null; hasTrack = $false }
    }
    $json = $ext | ConvertTo-Json -Compress
    if ($json -ne $lastExt) { $lastExt = $json; [Console]::Out.WriteLine($json); [Console]::Out.Flush() }
  }
  Start-Sleep -Milliseconds 60
}
