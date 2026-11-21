# 용머리 까치(주보) 자동 올림 — 윈도우 작업 스케줄러가 매주 금요일 18시에 올리고 토요일 10시에 다시 확인 (install.ps1로 등록)
#  1) F:\1BONA\8용머리까치\연도년까치\ 에서 이번 주일 날짜의 주보 한글 파일을 찾는다 (가장 나중에 고친 것)
#  2) 한글 2020으로 쪽마다 그림을 만든다
#  3) 원칙(2026-11-21 사용자): 주보 파일은 인쇄용 "2쪽 맞춤" → 항상 1쪽(앞·뒷면 한 장)만 올린다
#  4) 그림을 저장소에 commit·push → 배포 확인 → D1(bulletins, bulletin_images)에 넣는다
#  5) 주보 글에 나온 일정을 홈페이지 본당 일정에 넣는다(schedule.mjs, 이미 있는 일정은 건너뜀)
# 수동 실행 예: powershell -ExecutionPolicy Bypass -File weekly.ps1 -Date 2026.11.22 -DryRun
param([string]$Date, [switch]$DryRun, [switch]$Force)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing

$Repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$SrcRoot = 'F:\1BONA\8용머리까치'
$Site = 'https://yongmeori-catholic.jangsangyun0310.workers.dev'
$Data = Join-Path $env:LOCALAPPDATA 'YongmeoriBulletin'
$Wt = "$Data\worktree"
$Tmp = "$Data\tmp"
$StateFile = "$Data\state.json"
$LogFile = "$Data\log.txt"
$ErrNote = Join-Path ([Environment]::GetFolderPath('Desktop')) '주보자동올림_오류.txt'
New-Item -ItemType Directory -Force $Data, $Tmp | Out-Null

function Log([string]$m) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m"
  Write-Output $line
  [IO.File]::AppendAllText($LogFile, $line + "`r`n", [Text.Encoding]::UTF8)
}

# ---------- 상태(이미 올린 주보) ----------
function Load-State {
  $s = @{}
  if (Test-Path $StateFile) {
    $o = [IO.File]::ReadAllText($StateFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
    foreach ($p in $o.PSObject.Properties) { $s[$p.Name] = $p.Value }
  }
  return $s
}
function Save-State($s) { [IO.File]::WriteAllText($StateFile, ($s | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false)) }

# ---------- 주보 파일 찾기 ----------
function Find-Bulletin([datetime]$d) {
  $dirs = @("$SrcRoot\$($d.Year)년까치", "$SrcRoot\$($d.Year - 1)년까치", "$SrcRoot\$($d.Year + 1)년까치") | Where-Object { Test-Path $_ }
  $c = foreach ($dir in $dirs) {
    Get-ChildItem $dir -File | Where-Object {
      $_.Extension -in '.hwp', '.hwpx' -and $_.Name -match '까치' -and $_.Name -notmatch '백업|수정사항|공지' -and
      $_.Name -match '(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일' -and
      ([int]$(if ($matches[1]) { $matches[1] } else { $d.Year })) -eq $d.Year -and [int]$matches[2] -eq $d.Month -and [int]$matches[3] -eq $d.Day
    }
  }
  return $c | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

# ---------- 한글 → 쪽 그림 ----------
function Img-Ok([string]$f) {
  if (-not (Test-Path $f)) { return $false }
  try { $i = [System.Drawing.Image]::FromFile($f); $w = $i.Width; $i.Dispose(); return ($w -ge 1200) } catch { return $false }
}
function Render([string]$file, [string]$outDir) {
  Get-ChildItem $outDir -File -ErrorAction SilentlyContinue | Remove-Item
  $hwp = New-Object -ComObject HWPFrame.HwpObject
  try {
    $null = $hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModuleExample')
    try { $hwp.XHwpWindows.Item(0).Visible = $false } catch {}
    $null = $hwp.SetMessageBoxMode(0x2FFF1)
    $fmt = if ($file -like '*.hwpx') { 'HWPX' } else { 'HWP' }
    if (-not $hwp.Open($file, $fmt, 'forceopen:true;versionwarning:false')) { throw "한글 파일을 열지 못함: $file" }
    $pages = [int]$hwp.PageCount
    $text = [string]$hwp.GetTextFile('TEXT', '')
    $imgs = @()
    for ($p = 0; $p -lt [Math]::Min($pages, 2); $p++) {
      $bmp = "$outDir\p$($p + 1).bmp"
      # 커서가 개체 안에 있으면 그 개체만 찍히는 문제가 있어 문서 끝으로 옮긴 뒤 찍는다
      for ($t = 0; $t -lt 4 -and -not (Img-Ok $bmp); $t++) {
        Remove-Item $bmp -ErrorAction SilentlyContinue
        $null = $hwp.Run('MoveDocEnd'); Start-Sleep -Milliseconds (400 + 400 * $t)
        try { $null = $hwp.CreatePageImage($bmp, $p, 150, 24, 'bmp') } catch {}
      }
      if (-not (Img-Ok $bmp)) { throw "$($p + 1)쪽 그림을 만들지 못함" }
      $imgs += $bmp
    }
  } finally {
    try { $null = $hwp.Clear(1) } catch {}
    try { $hwp.Quit() } catch {}
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($hwp)
  }
  return @{ pages = $pages; text = $text; imgs = $imgs }
}

# ---------- 그림 비교·합치기 ----------
function Thumb($img, [int]$x, [int]$y, [int]$w, [int]$h) {
  $sw = 64; $sh = 48
  $small = New-Object System.Drawing.Bitmap $sw, $sh
  $g = [System.Drawing.Graphics]::FromImage($small)
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $sw, $sh), (New-Object System.Drawing.Rectangle $x, $y, $w, $h), [System.Drawing.GraphicsUnit]::Pixel); $g.Dispose()
  $v = New-Object 'double[]' ($sw * $sh)
  for ($i = 0; $i -lt $sw; $i++) { for ($j = 0; $j -lt $sh; $j++) { $v[$i * $sh + $j] = $small.GetPixel($i, $j).GetBrightness() } }
  $small.Dispose(); return , $v
}
function PageDiff($a, $b) { $s = 0.0; for ($i = 0; $i -lt $a.Length; $i++) { $s += [Math]::Abs($a[$i] - $b[$i]) }; return $s / $a.Length }
function StackFull($a, $b) {
  $bmp = New-Object System.Drawing.Bitmap $a.Width, ($a.Height + $b.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::White)
  $g.DrawImage($a, 0, 0, $a.Width, $a.Height); $g.DrawImage($b, 0, $a.Height, $b.Width, $b.Height)
  $g.Dispose(); return $bmp
}
function Save-Jpg($img, [string]$path) {
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $q = [long]80
  $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $q
  New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
  $w = [Math]::Min(1100, $img.Width); $h = [int]($img.Height * $w / $img.Width)
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::White)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, $w, $h); $g.Dispose()
  $bmp.Save($path, $enc, $ep); $bmp.Dispose()
}
# 홈페이지에 보일 그림 목록을 정한다 → @{ layout; pages = @(Bitmap…) }
function Decide-Pages($files) {
  $p1 = [System.Drawing.Image]::FromFile($files[0])
  if ($files.Count -lt 2) { return @{ layout = '1쪽'; pages = @($p1) } }
  $p2 = [System.Drawing.Image]::FromFile($files[1])
  if ($p1.Height -gt $p1.Width) {
    # 사용자 지시(2026-11-21): 주보 한글 파일은 인쇄용 "2쪽 맞춤"이라 1쪽에 앞·뒷면이 다 있음 → 항상 1쪽만 올린다
    # (2쪽은 양면 인쇄용 반복이거나 지난 호가 남은 쪽. 판정하지 않고 무조건 뺀다)
    $p2.Dispose(); return @{ layout = "2쪽 맞춤 → 1쪽만 (전체 $($files.Count)쪽)"; pages = @($p1) }
  }
  # A5 가로 두 쪽(앞면·뒷면) → 위아래로 붙여 한 장
  $full = PageDiff (Thumb $p1 0 0 $p1.Width $p1.Height) (Thumb $p2 0 0 $p2.Width $p2.Height)
  if ($full -lt 0.02) { $p2.Dispose(); return @{ layout = 'A5 가로, 같은 쪽 반복 → 1쪽만'; pages = @($p1) } }
  $s = StackFull $p1 $p2; $p1.Dispose(); $p2.Dispose()
  return @{ layout = 'A5 가로 앞뒷면 → 한 장으로'; pages = @($s) }
}

# ---------- 제목 ----------
function Get-Title([string]$text, [string]$dateStr) {
  $t = ($text -replace '&#\d+;', ' ' -replace '\s+', ' ').Trim()
  if ($t.Substring(0, [Math]::Min(200, $t.Length)) -notmatch '용머리\s*까치') { throw '주보 머리글("용머리 까치")이 없음 — 주보 파일이 아닌 것 같음' }
  if ($t -match '발간\s*제\s*\d+\s*호\s*\(\s*\d{4}\s*[.\-]\s*\d{1,2}\s*[.\-]\s*\d{1,2}\s*\.?\s*\)\s*(.{0,80})') {
    if ($matches[1] -match '^(.{1,40}?(?:주일|대축일|축일|성탄|성야|성금요일|성목요일)(?:\s*\([^)]{1,20}\))?)') {
      return ($matches[1] -replace '\s*\(\s*', '(' -replace '\s*\)', ')').Trim()
    }
  }
  $n = (& node "$PSScriptRoot\liturgy.mjs" $dateStr | Out-String).Trim()
  if ($n) { return $n } else { return '주보' }
}

# ---------- git (별도 작업 폴더: 사용자가 작업 중인 저장소는 건드리지 않음) ----------
function Git { & git.exe @args; if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') 실패" } }
function Prep-Worktree([int]$year) {
  if (-not (Test-Path "$Wt\.git")) {
    Git -C $Repo fetch -q origin
    Git -C $Repo worktree add -q --no-checkout --detach $Wt origin/main
    Git -C $Wt sparse-checkout set "public/images/uploads/$year"
  }
  Git -C $Wt sparse-checkout add "public/images/uploads/$year"
  Git -C $Wt fetch -q origin
  Git -C $Wt reset -q --hard origin/main
}
function Push-Worktree([string]$msg) {
  Git -C $Wt commit -q -m $msg
  for ($i = 0; $i -lt 3; $i++) {
    & git.exe -C $Wt push -q origin HEAD:main
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep 5; Git -C $Wt pull -q --rebase origin main   # 그사이 관리자 페이지가 올린 커밋이 있으면 위에 얹는다
  }
  throw 'git push 실패'
}

# ---------- D1 ----------
function D1-Query([string]$sql) {
  Push-Location $Repo
  try {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = (& npx wrangler d1 execute DB --remote --json --command $sql 2>$null | Out-String)
    $ErrorActionPreference = $old
    if ($LASTEXITCODE -ne 0) { throw "D1 조회 실패: $sql" }
    return @(($out | ConvertFrom-Json)[0].results)
  } finally { Pop-Location }
}
function D1-File([string]$sql) {
  $f = "$Tmp\run.sql"; [IO.File]::WriteAllText($f, $sql, (New-Object Text.UTF8Encoding $false))
  Push-Location $Repo
  try {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $null = (& npx wrangler d1 execute DB --remote --file $f 2>$null | Out-String)
    $ErrorActionPreference = $old
    if ($LASTEXITCODE -ne 0) { throw 'D1 쓰기 실패' }
  } finally { Pop-Location }
}
function Q([string]$s) { "'" + $s.Replace("'", "''") + "'" }

function Wait-Deployed([string]$rel, [long]$size) {
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep 15
    try {
      # HEAD는 캐시된 응답(CF-Cache-Status: HIT)에 Content-Length가 없어 끝까지 못 알아봄(2026-11-21) → 받아서 크기 비교
      $r = Invoke-WebRequest "$Site/$rel" -UseBasicParsing -Headers @{ 'Cache-Control' = 'no-cache' }
      if ([long]$r.RawContentLength -eq $size) { return }
    } catch {}
  }
  throw "배포 확인 시간 초과: $rel"
}

# ---------- 한 주 처리 ----------
function Process([datetime]$d, $state) {
  $ds = $d.ToString('yyyy.MM.dd'); $ymd = $d.ToString('yyyyMMdd')
  $f = Find-Bulletin $d
  if (-not $f) { Log "$ds 주보 파일 없음"; return }
  $mt = $f.LastWriteTime.ToString('s')
  $prev = $state[$ds]
  if (-not $Force -and $prev -and $prev.file -eq $f.FullName -and $prev.mtime -eq $mt) {
    # 주보는 올렸는데 일정 등록만 실패했으면(예: 인터넷 끊김) 일정만 다시
    if (-not $prev.sched -and (Test-Path "$Data\text\$ds.txt")) { Add-Schedule $ds $state; return }
    Log "$ds 이미 올림(바뀐 것 없음): $($f.Name)"; return
  }

  Log "$ds 처리 시작: $($f.Name) (수정 $mt)"
  $rd = "$Tmp\render"; New-Item -ItemType Directory -Force $rd | Out-Null
  $r = Render $f.FullName $rd
  $title = Get-Title $r.text $ds
  $dec = Decide-Pages $r.imgs
  Log "$ds 제목: $title / 쪽수 $($r.pages) / $($dec.layout)"

  $rels = @(); $n = 0
  $outRoot = if ($DryRun) { "$Tmp\dryrun" } else { $null }
  if (-not $DryRun) { Prep-Worktree $d.Year; $outRoot = "$Wt\public" }
  foreach ($pg in $dec.pages) {
    $n++; $rel = "images/uploads/$($d.Year)/bulletin-$ymd-$n.jpg"
    Save-Jpg $pg "$outRoot\$($rel -replace '/', '\')"; $pg.Dispose(); $rels += $rel
  }
  New-Item -ItemType Directory -Force "$Data\text" | Out-Null
  [IO.File]::WriteAllText("$Data\text\$ds.txt", $r.text, (New-Object Text.UTF8Encoding $false))
  if ($DryRun) { Log "$ds [미리보기] $($rels -join ', ') → $outRoot"; Add-Schedule $ds $state; return }

  # 홈페이지에 이미 이 날짜 주보가 있는지 (관리자 페이지로 직접 올린 것은 건드리지 않음)
  $ex = @(D1-Query "SELECT id FROM bulletins WHERE date=$(Q $ds) ORDER BY id")  # @( ): 한 줄 결과도 배열로(PS 5.1은 한 개짜리 .Count가 없음)
  if ($ex.Count -gt 0 -and (-not $prev -or $prev.manual)) {
    Log "$ds 홈페이지에 이미 있음(직접 올린 것) → 주보 그림은 건너뜀, 일정만 확인"; Git -C $Wt reset -q --hard origin/main
    $state[$ds] = @{ file = $f.FullName; mtime = $mt; manual = $true; at = (Get-Date).ToString('s'); sched = $false }
    Save-State $state; Add-Schedule $ds $state; return
  }

  for ($k = $rels.Count + 1; $k -le 3; $k++) {   # 지난번보다 쪽이 줄었으면 남은 그림 삭제
    $old = "public/images/uploads/$($d.Year)/bulletin-$ymd-$k.jpg"
    if (Test-Path "$Wt\$($old -replace '/', '\')") { Git -C $Wt rm -q $old }
  }
  Git -C $Wt add -- ($rels | ForEach-Object { "public/$_" })
  & git.exe -C $Wt diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    Push-Worktree "주보 자동 올림: $ds $title"
    $last = "$Wt\public\$($rels[-1] -replace '/', '\')"
    Wait-Deployed $rels[-1] (Get-Item $last).Length
    Log "$ds 그림 배포 확인"
  }

  $sql = New-Object System.Collections.Generic.List[string]
  if ($ex.Count -gt 0) {
    $id = $ex[0].id
    $sql.Add("DELETE FROM bulletin_images WHERE bulletin_id=$id;")
    $sql.Add("UPDATE bulletins SET title=$(Q $title) WHERE id=$id;")
    for ($i = 0; $i -lt $rels.Count; $i++) { $sql.Add("INSERT INTO bulletin_images (bulletin_id, path, position) VALUES ($id, $(Q $rels[$i]), $i);") }
  } else {
    $sql.Add("INSERT INTO bulletins (date, title) VALUES ($(Q $ds), $(Q $title));")
    for ($i = 0; $i -lt $rels.Count; $i++) { $sql.Add("INSERT INTO bulletin_images (bulletin_id, path, position) VALUES ((SELECT max(id) FROM bulletins WHERE date=$(Q $ds)), $(Q $rels[$i]), $i);") }
  }
  D1-File (($sql -join "`n") + "`n")

  # 확인: 홈페이지 자료에 이 날짜 주보와 그림이 보이는지
  $api = Invoke-RestMethod "$Site/api/home" -Headers @{ 'Cache-Control' = 'no-cache' }
  $b = @($api.bulletins) | Where-Object { $_.date -eq $ds } | Select-Object -First 1
  if (-not $b -or @($b.images).Count -ne $rels.Count) { throw "$ds 홈페이지 확인 실패" }
  $state[$ds] = @{ file = $f.FullName; mtime = $mt; title = $title; images = $rels; at = (Get-Date).ToString('s'); sched = $false }
  Save-State $state
  Log "$ds 올림 완료: $title ($($rels.Count)장)"
  Add-Schedule $ds $state
}

# ---------- 주보에 나온 일정 → 홈페이지 본당 일정 (schedule.mjs, 2026-11-14 사용자 요청) ----------
function Add-Schedule([string]$ds, $state) {
  $args2 = @("$PSScriptRoot\schedule.mjs", '--text', "$Data\text\$ds.txt", '--date', $ds, '--state', "$Data\schedule.json")
  if ($DryRun) { $args2 += '--dry' }
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = & node @args2 2>&1 | Where-Object { "$_" -notmatch 'DeprecationWarning|trace-deprecation' }
  $code = $LASTEXITCODE; $ErrorActionPreference = $old
  foreach ($l in $out) { Log "$ds 일정: $l" }
  if ($code -ne 0) { throw "$ds 일정 자동 등록 실패(주보는 올라감, 다음 실행 때 다시 시도)" }
  if (-not $DryRun -and $state[$ds]) {
    $s = $state[$ds]
    if ($s -is [hashtable]) { $s.sched = $true } else { $s | Add-Member -Force sched $true }
    Save-State $state
  }
}

# ---------- 시작 ----------
$mutex = New-Object Threading.Mutex($false, 'Global\YongmeoriBulletinWeekly')
if (-not $mutex.WaitOne(0)) { Log '이미 실행 중 → 종료'; exit 0 }
try {
  if (-not (Test-Path $SrcRoot)) { throw "주보 폴더가 없음: $SrcRoot (F: 드라이브 연결 확인)" }
  $state = Load-State
  $today = (Get-Date).Date
  if ($Date) {
    $targets = @([datetime]::ParseExact($Date, 'yyyy.MM.dd', $null))
  } else {
    $dow = [int]$today.DayOfWeek                      # 일요일 0 … 토요일 6
    $thisSun = $today.AddDays((7 - $dow) % 7)          # 이번 주일(오늘이 주일이면 오늘)
    $targets = @($thisSun.AddDays(-7))                 # 지난 주일: 컴퓨터가 꺼져 있어 못 올렸으면 지금 올림
    # 이번 주일 주보는 금요일 저녁 6시부터(작성 중인 초안이 올라가지 않도록, 사용자 결정 2026-11-14)
    if (($dow -eq 5 -and (Get-Date).Hour -ge 18) -or $dow -eq 6 -or $dow -eq 0) { $targets += $thisSun }
  }
  $failed = $false
  foreach ($d in $targets) {
    try { Process $d $state } catch { $failed = $true; Log "$($d.ToString('yyyy.MM.dd')) 오류: $($_.Exception.Message)" }
  }
  if ($failed) {
    [IO.File]::WriteAllText($ErrNote, "주보 자동 올림 중 오류가 있었습니다. 기록: $LogFile`r`n`r`n" + ((Get-Content $LogFile -Encoding UTF8 -Tail 15) -join "`r`n"), [Text.Encoding]::UTF8)
    exit 1
  } elseif (Test-Path $ErrNote) { Remove-Item $ErrNote }
} finally { $mutex.ReleaseMutex() }
