# Adds a shortcut to your Startup folder so the helper runs hidden at login.
$vbs = Join-Path $PSScriptRoot 'start-hidden.vbs'
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Notifications Edge Helper.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = "$env:WINDIR\System32\wscript.exe"
$s.Arguments = "`"$vbs`""
$s.WorkingDirectory = $PSScriptRoot
$s.Save()
Write-Host "Installed: $lnk"
Write-Host "Starting helper now..."
Start-Process "$env:WINDIR\System32\wscript.exe" -ArgumentList "`"$vbs`""
