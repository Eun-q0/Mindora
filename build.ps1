# =============================================================================
# build.ps1 — src/ 의 분리된 앱 소스와 정적 자산을 루트 배포 폴더로 복사합니다.
#
#   PowerShell 에서:  .\build.ps1
#
# src/ 를 수정한 뒤 실행하면 루트의 index.html, css/, js/와 PWA 자원이 갱신됩니다.
# 배포본도 HTML·CSS·JS를 분리해 브라우저 캐시를 재사용하면서 기존 루트 앱 주소를
# 그대로 유지합니다. 생성물은 직접 고치지 말고 src/ 를 고치세요.
# =============================================================================
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'src'
$enc = [System.Text.UTF8Encoding]::new($false)

function ReadUtf8($p) { return [System.IO.File]::ReadAllText($p, $enc) }

$html = ReadUtf8 (Join-Path $src 'index.html')

# 로드 순서 = 의존 순서. src/index.html 의 script 태그와 반드시 일치해야 한다.
$jsFiles = @('engine.js', 'planner.js', 'storage.js', 'meals.js', 'studylog.js', 'avatar.js', 'group.js', 'cloud.js', 'backup.js', 'league.js', 'filter.js', 'notes.js', 'neis.js', 'kids.js', 'sound.js', 'report.js', 'pomodoro.js', 'slime.js', 'app.js')
$scriptTags = (($jsFiles | ForEach-Object { '<script src="js/' + $_ + '"></script>' }) -join "`r`n") + "`r`n"

$html = $html -replace "`r?`n", "`r`n"
if (-not $html.Contains($scriptTags)) { throw 'src/index.html 의 script 태그 블록이 build.ps1 의 $jsFiles 목록과 일치하지 않습니다.' }

$outPath = Join-Path $root 'index.html'
[System.IO.File]::WriteAllText($outPath, $html, $enc)

# 코드 자산을 분리해 두면 HTML이 작아지고 변경되지 않은 파일을 재사용할 수 있다.
foreach ($dir in @('css', 'js')) {
    $target = Join-Path $root $dir
    if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target | Out-Null }
    Copy-Item (Join-Path $src "$dir\*") $target -Recurse -Force
}

# PWA·검색·공유 미리보기 자원은 브라우저와 크롤러가 별도 URL로 요청한다.
$assets = @('manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-maskable.svg',
            'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png',
            'avatar-sheet.png', 'og-cover.png',
            'ads.txt', 'robots.txt', 'sitemap.xml')
foreach ($a in $assets) {
    $from = Join-Path $src $a
    if (Test-Path $from) { Copy-Item $from (Join-Path $root $a) -Force }
    else { Write-Warning "missing asset: src/$a" }
}

$kb = [math]::Round((Get-Item $outPath).Length / 1KB, 1)
Write-Output "OK - root app rebuilt ($kb KB) + separate CSS/JS + $($assets.Count) assets copied."
