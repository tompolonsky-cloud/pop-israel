# setup-tasks.ps1 — רושם 3 משימות ב-Task Scheduler לרענון אוטומטי
# להפעלה: לחץ ימני → "Run with PowerShell"

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source

if (-not $node) {
  Write-Host "❌ Node.js לא נמצא — נא להתקין מ-nodejs.org" -ForegroundColor Red
  pause; exit 1
}

$script = Join-Path $dir "refresh.js"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $dir

$times = @("08:00", "13:00", "19:00")
$taskName = "PopIsrael-Refresh"

# Remove old tasks if exist
foreach ($t in $times) {
  $name = "$taskName-$($t.Replace(':',''))"
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
}

# Create new tasks
foreach ($t in $times) {
  $name = "$taskName-$($t.Replace(':',''))"
  $trigger = New-ScheduledTaskTrigger -Daily -At $t
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

  Register-ScheduledTask -TaskName $name `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Pop Israel — רענון נתונים אוטומטי $t" | Out-Null

  Write-Host "✅ נרשמה משימה: $name ($t)" -ForegroundColor Green
}

Write-Host ""
Write-Host "🎉 3 משימות נרשמו בהצלחה!" -ForegroundColor Cyan
Write-Host "   הרענון יפעל בשעות 08:00, 13:00, 19:00 — כשהמחשב דלוק"
Write-Host ""
Write-Host "   חשוב: ודא שהשרת (start-server.bat) רץ לפני שעות הרענון"
Write-Host ""
pause
