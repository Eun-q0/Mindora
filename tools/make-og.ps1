# =============================================================================
# make-og.ps1 - build src/og-cover.png (1200 x 630) for link previews.
#
#   powershell -ExecutionPolicy Bypass -File tools/make-og.ps1
#
# Why this exists: og:image used to be icon-512.png, a 512x512 square. KakaoTalk,
# Discord and X all lay out link cards at roughly 1.91:1, so a square icon gets
# cropped or shrunk into a corner. Sharing is how this app spreads, so the card
# is drawn at the size those services actually want.
#
# Nothing is downloaded and no source picture is needed - the card is drawn from
# shapes and text, so re-running it always reproduces the same file.
#
# The copy is drawn from the landing hero so the two never drift apart.
#
# NOTE: this file must stay UTF-8 *with BOM*. PowerShell 5.1 falls back to the
# system codepage without one, which turns every Korean string into mojibake.
# =============================================================================
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$W = 1200
$H = 630

# --------------------------------------------------------------- palette
# Same tokens as the dark theme in landing/index.html.
function C([int]$r, [int]$g, [int]$b, [int]$a = 255) {
    return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}
$INK      = C 15 18 32        # #0f1220
$INK_2    = C 36 30 74        # deep violet corner
$SURFACE  = C 27 32 53
$LINE     = C 47 55 82
$WHITE    = C 255 255 255
$MUTED    = C 174 183 204
$DIM      = C 144 154 179
$ACCENT   = C 155 131 255     # #9b83ff
$ACCENT_2 = C 143 165 255
$CYAN     = C 90 210 236      # #5ad2ec

$bmp = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# --------------------------------------------------------------- helpers
function RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
    $p.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
    $p.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

# A soft round glow, drawn as a centre-to-edge fade.
function Glow([single]$cx, [single]$cy, [single]$rad, $color, [int]$alpha) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddEllipse(($cx - $rad), ($cy - $rad), ($rad * 2), ($rad * 2))
    $br = New-Object System.Drawing.Drawing2D.PathGradientBrush $p
    $br.CenterColor = [System.Drawing.Color]::FromArgb($alpha, $color.R, $color.G, $color.B)
    $br.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $color.R, $color.G, $color.B))
    $g.FillPath($br, $p)
    $br.Dispose(); $p.Dispose()
}

# Font lookup: Malgun Gothic ships with Windows and carries Hangul. If a machine
# somehow lacks it, GDI+ substitutes rather than throwing, so no guard is needed.
function F([single]$size, [string]$style = 'Bold', [string]$name = 'Malgun Gothic') {
    $st = [System.Drawing.FontStyle]::Regular
    if ($style -eq 'Bold') { $st = [System.Drawing.FontStyle]::Bold }
    return New-Object System.Drawing.Font $name, $size, $st, ([System.Drawing.GraphicsUnit]::Pixel)
}

function Text([string]$s, $font, $brush, [single]$x, [single]$y) {
    # StringFormat.GenericTypographic drops the padding GDI+ adds around a run,
    # so x really is the left edge and columns line up.
    $fmt = [System.Drawing.StringFormat]::GenericTypographic.Clone()
    $fmt.FormatFlags = $fmt.FormatFlags -bor [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces
    $g.DrawString($s, $font, $brush, $x, $y, $fmt)
}

function TextW([string]$s, $font) {
    $fmt = [System.Drawing.StringFormat]::GenericTypographic
    return $g.MeasureString($s, $font, [System.Drawing.PointF]::new(0, 0), $fmt).Width
}

# --------------------------------------------------------------- background
$bgRect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $bgRect, $INK, $INK_2, 22.0
$g.FillRectangle($bg, $bgRect)
$bg.Dispose()

Glow 120 40 620 $ACCENT 66
Glow 1080 620 520 $CYAN 40
Glow 700 -60 420 $ACCENT_2 30

# --------------------------------------------------------------- brand row
$MX = 80          # left margin
$markSize = 56
$markPath = RoundRect $MX 62 $markSize $markSize 15
$markRect = New-Object System.Drawing.Rectangle $MX, 62, $markSize, $markSize
$markBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $markRect, (C 124 92 255), $CYAN, 45.0
$g.FillPath($markBrush, $markPath)
$markBrush.Dispose(); $markPath.Dispose()

# A simple glyph inside the mark: three stacked rounded bars, like the score bars
# in the app. An emoji would be safer to read but GDI+ renders it monochrome.
$glyph = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(235, 255, 255, 255))
foreach ($b in @(@(14, 30), @(20, 22), @(26, 34))) {
    $p = RoundRect ($MX + 15) (62 + $b[0]) $b[1] 5 2.5
    $g.FillPath($glyph, $p); $p.Dispose()
}
$glyph.Dispose()

$fBrand = F 34 'Bold'
$brBrand = New-Object System.Drawing.SolidBrush $WHITE
Text 'Mindora' $fBrand $brBrand ($MX + $markSize + 18) 74

# --------------------------------------------------------------- headline
# 55px, not larger: the first line is the longest string on the card and at 62px
# it ran under the score card. The copy is kept identical to the landing hero.
$fH1 = F 55 'Bold'
$brH1 = New-Object System.Drawing.SolidBrush $WHITE
Text '무작정 오래 앉아 있는' $fH1 $brH1 $MX 182

# second line uses the brand gradient, same as the landing hero
$line2 = '공부는 그만.'
$w2 = TextW $line2 $fH1
$gr2 = New-Object System.Drawing.Rectangle $MX, 246, ([int][math]::Ceiling($w2) + 8), 72
$brH2 = New-Object System.Drawing.Drawing2D.LinearGradientBrush $gr2, $ACCENT, $CYAN, 12.0
Text $line2 $fH1 $brH2 $MX 250

# --------------------------------------------------------------- sub copy
$fSub = F 25 'Regular'
$brSub = New-Object System.Drawing.SolidBrush $MUTED
Text '수면·피로·스트레스로 오늘의 학습 준비도를 계산하고,' $fSub $brSub $MX 366
Text '무엇부터 몇 분 공부할지 정리해 드립니다.' $fSub $brSub $MX 402

# --------------------------------------------------------------- chips
$fChip = F 21 'Bold'
$chipY = 470
$chipX = $MX
foreach ($c in @('회원가입 없음', '설치 없음', '0원')) {
    $tw = TextW $c $fChip
    $cw = $tw + 40
    $p = RoundRect $chipX $chipY $cw 46 23
    $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(38, 155, 131, 255))
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(120, 155, 131, 255)), 1.4
    $g.FillPath($fill, $p); $g.DrawPath($pen, $p)
    $brC = New-Object System.Drawing.SolidBrush (C 202 191 255)
    Text $c $fChip $brC ($chipX + 20) ($chipY + 11)
    $fill.Dispose(); $pen.Dispose(); $brC.Dispose(); $p.Dispose()
    $chipX += $cw + 12
}

# --------------------------------------------------------------- domain
$fDom = F 22 'Bold'
$brDom = New-Object System.Drawing.SolidBrush $DIM
Text 'www.mindora.co.kr' $fDom $brDom $MX 556

# --------------------------------------------------------------- score card
# A small mock of the readiness screen, so the card shows the product and not
# just a slogan. Numbers match the landing hero mock (61 / 39 / 52 / 44 / 78 / 66).
$cx = 706; $cy = 132; $cw = 414; $ch = 366
$cardPath = RoundRect $cx $cy $cw $ch 26
$cardFill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(232, $SURFACE.R, $SURFACE.G, $SURFACE.B))
$cardPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(210, $LINE.R, $LINE.G, $LINE.B)), 1.6
$g.FillPath($cardFill, $cardPath)
$g.DrawPath($cardPen, $cardPath)
$cardFill.Dispose(); $cardPen.Dispose(); $cardPath.Dispose()

$fLbl = F 19 'Bold'
$brDim = New-Object System.Drawing.SolidBrush $DIM
Text '오늘의 준비도' $fLbl $brDim ($cx + 30) ($cy + 26)

$fBig = F 66 'Bold'
$brBig = New-Object System.Drawing.SolidBrush $WHITE
Text '61' $fBig $brBig ($cx + 28) ($cy + 56)

$fMode = F 19 'Regular'
Text '종합 컨디션 · 35분 / 7분' $fMode $brDim ($cx + 118) ($cy + 92)

$rows = @(
    @{ n = '집중'; v = 39 }, @{ n = '기억'; v = 52 }, @{ n = '계산'; v = 44 },
    @{ n = '창의'; v = 78 }, @{ n = '독해'; v = 66 }
)
$fRow = F 19 'Bold'
$fVal = F 19 'Bold'
$brRow = New-Object System.Drawing.SolidBrush $MUTED
$brVal = New-Object System.Drawing.SolidBrush $WHITE
$trackBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 39, 45, 62))

$ry = $cy + 152
$barX = $cx + 88; $barW = 232
foreach ($r in $rows) {
    Text $r.n $fRow $brRow ($cx + 30) ($ry - 3)
    $tp = RoundRect $barX ($ry + 3) $barW 11 5.5
    $g.FillPath($trackBrush, $tp); $tp.Dispose()

    $fw = [single]($barW * $r.v / 100.0)
    if ($fw -lt 12) { $fw = 12 }
    $fp = RoundRect $barX ($ry + 3) $fw 11 5.5
    $fr = New-Object System.Drawing.Rectangle ([int]$barX), ([int]$ry), ([int][math]::Ceiling($fw)), 18
    $fb = New-Object System.Drawing.Drawing2D.LinearGradientBrush $fr, $ACCENT, $CYAN, 0.0
    $g.FillPath($fb, $fp)
    $fb.Dispose(); $fp.Dispose()

    $vs = [string]$r.v
    $vw = TextW $vs $fVal
    Text $vs $fVal $brVal ($cx + $cw - 30 - $vw) ($ry - 3)
    $ry += 38
}

# --------------------------------------------------------------- save
$out = Join-Path $PSScriptRoot '..\src\og-cover.png'
$out = [System.IO.Path]::GetFullPath($out)
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose(); $bmp.Dispose()
Write-Output ("OK - og-cover.png {0}x{1} ({2} KB)" -f $W, $H, [math]::Round((Get-Item $out).Length / 1KB, 1))
