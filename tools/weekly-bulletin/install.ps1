# Register the weekly bulletin upload in Windows Task Scheduler (run once on this computer).
#   Fri 18:00 upload, Sat 10:00 re-check (if the PC was off on Friday or the bulletin was edited).
#   Missed runs start when the PC is turned on. To remove: Unregister-ScheduledTask -TaskName 'YongmeoriBulletinWeekly'
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI and breaks Korean text.
$name = 'YongmeoriBulletinWeekly'
$script = Join-Path $PSScriptRoot 'weekly.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$triggers = @(
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Friday -At '18:00'),
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At '10:00')
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $name -Description 'Yongmeori Catholic Church: weekly bulletin auto upload' -Action $action -Trigger $triggers -Settings $settings -Force | Out-Null
Get-ScheduledTask -TaskName $name | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime
