# =============================================================================
# build.ps1 — src/ 의 분리된 소스를 하나의 자체 완결 index.html 로 묶습니다.
#
#   PowerShell 에서:  .\build.ps1
#
# src/ 를 수정한 뒤 이 스크립트를 실행하면 루트의 index.html 이 다시 생성됩니다.
# (index.html 은 생성물이므로 직접 고치지 말고 src/ 를 고치세요)
# =============================================================================
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'src'
$enc = [System.Text.UTF8Encoding]::new($false)

function ReadUtf8($p) { return [System.IO.File]::ReadAllText($p, $enc) }

$html = ReadUtf8 (Join-Path $src 'index.html')
$css = ReadUtf8 (Join-Path $src 'css\styles.css')

# 로드 순서 = 의존 순서. src/index.html 의 script 태그와 반드시 일치해야 한다.
$jsFiles = @('engine.js', 'planner.js', 'storage.js', 'studylog.js', 'group.js', 'cloud.js', 'league.js', 'neis.js', 'kids.js', 'sound.js', 'report.js', 'pomodoro.js', 'app.js')
$js = ($jsFiles | ForEach-Object {
        "/* ===== src/js/$_ ===== */`r`n" + (ReadUtf8 (Join-Path $src "js\$_"))
    }) -join "`r`n`r`n"

if ($js -match '</script') { throw 'JS 안에 </script> 문자열이 있어 인라인할 수 없습니다.' }

$linkTag = '<link rel="stylesheet" href="css/styles.css">'
if (-not $html.Contains($linkTag)) { throw 'src/index.html 에서 스타일시트 link 태그를 찾지 못했습니다.' }
$html = $html.Replace($linkTag, "<style>`r`n$css`r`n</style>")

# 태그 블록은 파일 목록에서 직접 만들어 두 곳이 어긋나지 않게 한다.
$scriptTags = (($jsFiles | ForEach-Object { '<script src="js/' + $_ + '"></script>' }) -join "`r`n") + "`r`n"

$html = $html -replace "`r?`n", "`r`n"
if (-not $html.Contains($scriptTags)) { throw 'src/index.html 의 script 태그 블록이 build.ps1 의 $jsFiles 목록과 일치하지 않습니다.' }
$html = $html.Replace($scriptTags, "<script>`r`n$js`r`n</script>")

$outPath = Join-Path $root 'index.html'
[System.IO.File]::WriteAllText($outPath, $html, $enc)

# PWA 자원은 인라인할 수 없으므로(브라우저가 별도 URL로 받아 가야 한다) 그대로 복사한다.
# src/ 를 원본으로 두는 이유: 개발 서버(src/)와 배포본(루트)이 같은 파일을 보게 해야
# "로컬에선 되는데 배포하면 안 되는" 상황을 막을 수 있다.
$assets = @('manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-maskable.svg',
            'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png')
foreach ($a in $assets) {
    $from = Join-Path $src $a
    if (Test-Path $from) { Copy-Item $from (Join-Path $root $a) -Force }
    else { Write-Warning "missing asset: src/$a" }
}

$kb = [math]::Round((Get-Item $outPath).Length / 1KB, 1)
# 콘솔 코드페이지에 따라 한글이 깨질 수 있어 빌드 로그는 ASCII 로 출력합니다.
Write-Output "OK - index.html rebuilt ($kb KB) + $($assets.Count) PWA assets copied."
