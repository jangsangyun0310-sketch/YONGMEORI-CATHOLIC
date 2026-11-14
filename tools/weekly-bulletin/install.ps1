# 주보 자동 올림을 윈도우 작업 스케줄러에 등록 (이 컴퓨터에서 한 번만 실행)
#   매주 금요일 18:00 올림, 토요일 10:00 다시 확인(금요일에 컴퓨터가 꺼져 있었거나 주보를 고친 경우)
#   놓친 시간은 컴퓨터를 켜면 바로 실행. 지우려면: Unregister-ScheduledTask -TaskName '용머리 주보 자동 올림'
$script = Join-Path $PSScriptRoot 'weekly.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$triggers = @(
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Friday -At '18:00'),
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At '10:00')
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName '용머리 주보 자동 올림' -Action $action -Trigger $triggers -Settings $settings -Force | Out-Null
Get-ScheduledTask -TaskName '용머리 주보 자동 올림' | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime
