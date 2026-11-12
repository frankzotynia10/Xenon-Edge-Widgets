# Registers a Task Scheduler task that keeps the Edge widget helpers running:
# it runs at login and every 5 minutes, and restarts any helper that isn't answering.
# Replaces the old per-helper Startup-folder shortcuts. Runs as you; no admin needed.
$ErrorActionPreference = 'Stop'
$vbs = Join-Path $PSScriptRoot 'run-watchdog.vbs'
$taskName = 'Edge Widget Helpers'

$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument "`"$vbs`"" -WorkingDirectory $PSScriptRoot
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($atLogon, $every5) -Settings $settings `
  -Principal $principal -Description 'Keeps the combined Xeneon Edge helper (edge-helper) running.' -Force | Out-Null
Write-Host "Registered scheduled task '$taskName'."

# The task now handles login too, so the old Startup shortcuts are redundant.
$startup = [Environment]::GetFolderPath('Startup')
foreach ($n in 'Discord Edge Helper.lnk', 'Apple Music Edge Helper.lnk', 'Notifications Edge Helper.lnk') {
  $p = Join-Path $startup $n
  if (Test-Path $p) { Remove-Item $p; Write-Host "Removed old Startup shortcut: $n" }
}

Start-ScheduledTask -TaskName $taskName
Write-Host 'Started it once now.'
