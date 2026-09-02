# Pulls the latest homepage content from GitHub at Windows logon.
# Logs each run to auto-pull.log next to this script so failures are visible.

$repoDir = 'C:\project'
$logFile = Join-Path $PSScriptRoot 'auto-pull.log'

function Write-Log($msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Out-File -FilePath $logFile -Append -Encoding utf8
}

try {
    Set-Location $repoDir
    $output = & git pull origin main
    Write-Log ($output -join ' | ')
    if ($LASTEXITCODE -ne 0) {
        Write-Log "git pull exited with code $LASTEXITCODE"
    }
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
}
