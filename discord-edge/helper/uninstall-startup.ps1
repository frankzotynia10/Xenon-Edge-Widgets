$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Discord Edge Helper.lnk'
if (Test-Path $lnk) { Remove-Item $lnk; Write-Host "Removed $lnk" }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$(Join-Path $PSScriptRoot 'index.js')*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "Stopped helper (PID $($_.ProcessId))" }
