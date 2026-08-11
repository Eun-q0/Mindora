# =============================================================================
# build.ps1 — src/ 의 앱 소스와 정적 자산을 app/ 배포 폴더로 복사합니다.
#
#   PowerShell 에서:  .\build.ps1
#
# 배포되는 모양은 이렇습니다.
#
#   /            랜딩 페이지  ← landing/index.html 을 그대로 복사
#   /app/        앱 본체      ← HTML·CSS·JS 분리 배포 + PWA 자원
#   /robots.txt  /sitemap.xml  /ads.txt   크롤러가 도메인 루트에서 찾는 파일
#
# 처음 오는 사람이 소개를 먼저 보고 들어오도록 루트를 랜딩에 내주었습니다.
# 두 파일 다 생성물이므로 직접 고치지 말고 src/ 와 landing/ 을 고치세요.
# =============================================================================
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'src'
$enc = [System.Text.UTF8Encoding]::new($false)

function ReadUtf8($p) { return [System.IO.File]::ReadAllText($p, $enc) }

$html = ReadUtf8 (Join-Path $src 'index.html')
# 로드 순서 = 의존 순서. src/index.html 의 script 태그와 반드시 일치해야 한다.
$jsFiles = @('engine.js', 'planner.js', 'storage.js', 'studylog.js', 'avatar.js', 'group.js', 'cloud.js', 'league.js', 'neis.js', 'kids.js', 'sound.js', 'report.js', 'pomodoro.js', 'slime.js', 'app.js')

# 태그 블록은 파일 목록에서 직접 만들어 두 곳이 어긋나지 않게 한다.
$scriptTags = (($jsFiles | ForEach-Object { '<script src="js/' + $_ + '"></script>' }) -join "`r`n") + "`r`n"

$html = $html -replace "`r?`n", "`r`n"
if (-not $html.Contains($scriptTags)) { throw 'src/index.html 의 script 태그 블록이 build.ps1 의 $jsFiles 목록과 일치하지 않습니다.' }

$appDir = Join-Path $root 'app'
if (-not (Test-Path $appDir)) { New-Item -ItemType Directory -Path $appDir | Out-Null }
$outPath = Join-Path $appDir 'index.html'
[System.IO.File]::WriteAllText($outPath, $html, $enc)

# 코드 자산을 분리해 두면 HTML이 작아지고 브라우저가 변경되지 않은 파일을 재사용할 수 있다.
foreach ($dir in @('css', 'js')) {
    $target = Join-Path $appDir $dir
    if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target | Out-Null }
    Copy-Item (Join-Path $src "$dir\*") $target -Recurse -Force
}

# PWA 자원은 인라인할 수 없으므로(브라우저가 별도 URL로 받아 가야 한다) 그대로 복사한다.
# src/ 를 원본으로 두는 이유: 개발 서버(src/)와 배포본(app/)이 같은 파일을 보게 해야
# "로컬에선 되는데 배포하면 안 되는" 상황을 막을 수 있다.
#
# 서비스 워커의 스코프는 파일이 놓인 경로가 정한다. app/sw.js 는 /app/ 만 맡으므로
# 랜딩(/)은 워커 없이 그냥 뜬다 — 소개 페이지를 캐시에 가둘 이유가 없다.
$appAssets = @('manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-maskable.svg',
               'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png',
               'avatar-sheet.png')
foreach ($a in $appAssets) {
    $from = Join-Path $src $a
    if (Test-Path $from) { Copy-Item $from (Join-Path $appDir $a) -Force }
    else { Write-Warning "missing asset: src/$a" }
}

# 루트에 남아야 하는 파일들.
#   ads.txt·robots.txt·sitemap.xml — 크롤러가 /파일명 으로만 찾는다
#   아이콘 — 브라우저가 관례적으로 /apple-touch-icon.png 를 먼저 뒤진다
# manifest 와 sw.js 는 여기 두지 않는다. 루트에 sw.js 가 있으면 사이트 전체를
# 스코프로 잡는 워커가 다시 살아나 랜딩까지 캐시에 가둔다.
$rootAssets = @('ads.txt', 'robots.txt', 'sitemap.xml',
                'apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
                'icon-512-maskable.png', 'icon.svg', 'icon-maskable.svg')
foreach ($a in $rootAssets) {
    $from = Join-Path $src $a
    if (Test-Path $from) { Copy-Item $from (Join-Path $root $a) -Force }
    else { Write-Warning "missing asset: src/$a" }
}

# 루트 index.html 은 랜딩 페이지다. 앱과 달리 묶을 게 없어 그대로 복사한다.
$landingSrc = Join-Path $root 'landing\index.html'
if (-not (Test-Path $landingSrc)) { throw 'landing/index.html 이 없습니다.' }
$landing = ReadUtf8 $landingSrc
if ($landing -notmatch '/app/') { throw 'landing/index.html 의 시작하기 링크가 /app/ 을 가리키지 않습니다.' }
$rootIndex = Join-Path $root 'index.html'
[System.IO.File]::WriteAllText($rootIndex, $landing, $enc)

$kbApp = [math]::Round((Get-Item $outPath).Length / 1KB, 1)
$kbRoot = [math]::Round((Get-Item $rootIndex).Length / 1KB, 1)
# 콘솔 코드페이지에 따라 한글이 깨질 수 있어 빌드 로그는 ASCII 로 출력합니다.
Write-Output "OK - app/index.html rebuilt ($kbApp KB) + separate CSS/JS + $($appAssets.Count) PWA assets"
Write-Output "OK - index.html = landing ($kbRoot KB) + $($rootAssets.Count) crawler files at root"
