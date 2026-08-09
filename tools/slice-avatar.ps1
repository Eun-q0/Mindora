# =============================================================================
# slice-avatar.ps1 - build src/avatar-sheet.png from tools/avatar-source.png
#
#   8 characters, 4 columns x 2 rows, 200px cells.
#
# Each cell is the bust exactly as it was drawn - face, hair and the top the
# artist gave them. Nothing is recoloured or recombined, so every character
# looks the way the original picture looks.
#
# Neighbours stand close together in the source, so the strip left and right of
# each character is replaced by its own background. Filling it with a flat
# colour leaves a visible seam (the paper has a faint texture), so the edge
# pixel of each row is stretched outwards instead.
#
# ASCII comments only: PowerShell 5.1 reads .ps1 as the system codepage.
# =============================================================================
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sp = $PSScriptRoot
$src = New-Object System.Drawing.Bitmap (Join-Path $sp 'avatar-source.png')
$SW = $src.Width; $SH = $src.Height

$r = New-Object System.Drawing.Rectangle 0, 0, $SW, $SH
$d = $src.LockBits($r, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $d.Stride
$buf = New-Object byte[] ($stride * $SH)
[System.Runtime.InteropServices.Marshal]::Copy($d.Scan0, $buf, 0, $buf.Length)
$src.UnlockBits($d)

$BGR = 252; $BGG = 248; $BGB = 245
$CELL = 200
$COLS = 4
$CHAR_TOP = 104          # source y that maps to the top of a cell

# cx = centre of the character. hwL/hwR = how far to keep to each side before the
# neighbour starts. The two outermost characters have a card edge rather than a
# neighbour on their open side, so they get more room - f1's long hair spills
# past the halfway point and would otherwise be sliced off.
$CHARS = @(
    @{ id = 'm1'; cx = 258;  hwL = 71; hwR = 71 }, @{ id = 'm2'; cx = 400;  hwL = 71; hwR = 71 },
    @{ id = 'm3'; cx = 541;  hwL = 71; hwR = 71 }, @{ id = 'f1'; cx = 701;  hwL = 70; hwR = 60 },
    @{ id = 'f2'; cx = 824;  hwL = 60; hwR = 60 }, @{ id = 'f3'; cx = 944;  hwL = 60; hwR = 60 },
    @{ id = 'f4'; cx = 1065; hwL = 60; hwR = 60 }, @{ id = 'f5'; cx = 1184; hwL = 60; hwR = 60 }
)

function SrcColor($x, $y) {
    if ($x -lt 0) { $x = 0 }; if ($x -ge $SW) { $x = $SW - 1 }
    if ($y -lt 0) { $y = 0 }; if ($y -ge $SH) { $y = $SH - 1 }
    $i = $y * $stride + $x * 4
    return [System.Drawing.Color]::FromArgb(255, $buf[$i + 2], $buf[$i + 1], $buf[$i])
}

# Colour to paint the strip beside a character with.
#
# Taking whatever pixel sits on the cut line is wrong: where the hair reaches
# past that line it is the hair that gets smeared sideways, which is what put a
# dark band down the side of the long-wave character. So step outwards until an
# actual background pixel turns up, and fall back to flat background if the
# whole run is covered.
function EdgeColor($x0, $y, $dir) {
    for ($k = 0; $k -lt 26; $k++) {
        $x = $x0 + $dir * $k
        if ($x -lt 0 -or $x -ge $SW) { break }
        $i = $y * $stride + $x * 4
        $dist = [math]::Abs($buf[$i + 2] - $BGR) + [math]::Abs($buf[$i + 1] - $BGG) + [math]::Abs($buf[$i] - $BGB)
        if ($dist -le 10) { return [System.Drawing.Color]::FromArgb(255, $buf[$i + 2], $buf[$i + 1], $buf[$i]) }
    }
    return [System.Drawing.Color]::FromArgb(255, $BGR, $BGG, $BGB)
}

$nRows = [math]::Ceiling($CHARS.Count / $COLS)
$sheet = New-Object System.Drawing.Bitmap ($CELL * $COLS), ($CELL * $nRows), ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $BGR, $BGG, $BGB))
$g.Clear([System.Drawing.Color]::FromArgb(255, $BGR, $BGG, $BGB))

$idx = 0
foreach ($c in $CHARS) {
    $col = $idx % $COLS; $row = [math]::Floor($idx / $COLS)
    $rc = New-Object System.Drawing.Rectangle ($col * $CELL), ($row * $CELL), $CELL, $CELL
    $g.FillRectangle($bgBrush, $rc)
    $sr = New-Object System.Drawing.Rectangle ($c.cx - 100), $CHAR_TOP, 200, 200
    $g.DrawImage($src, $rc, $sr, [System.Drawing.GraphicsUnit]::Pixel)

    $keepL = 100 - $c.hwL; $keepR = 100 + $c.hwR
    for ($y = 0; $y -lt $CELL; $y++) {
        $sy = $CHAR_TOP + $y
        if ($keepL -gt 0) {
            $bl = New-Object System.Drawing.SolidBrush (EdgeColor ($c.cx - $c.hwL - 1) $sy (-1))
            $g.FillRectangle($bl, $rc.X, ($rc.Y + $y), $keepL, 1)
            $bl.Dispose()
        }
        if ($keepR -lt $CELL) {
            $br = New-Object System.Drawing.SolidBrush (EdgeColor ($c.cx + $c.hwR + 1) $sy (1))
            $g.FillRectangle($br, ($rc.X + $keepR), ($rc.Y + $y), ($CELL - $keepR), 1)
            $br.Dispose()
        }
    }
    Write-Output ("char {0} -> cell {1}" -f $c.id, $idx)
    $idx++
}

$g.Dispose()
$out = Join-Path $sp '..\src\avatar-sheet.png'
$sheet.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose(); $src.Dispose()
Write-Output ("saved {0} ({1} KB) cells={2} cols={3} rows={4}" -f $out, [math]::Round((Get-Item $out).Length / 1KB, 1), $idx, $COLS, $nRows)
