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

# cx = centre of the character, hw = half width to keep before the neighbour starts
$CHARS = @(
    @{ id = 'm1'; cx = 258;  hw = 71 }, @{ id = 'm2'; cx = 400;  hw = 71 },
    @{ id = 'm3'; cx = 541;  hw = 71 }, @{ id = 'f1'; cx = 701;  hw = 60 },
    @{ id = 'f2'; cx = 824;  hw = 60 }, @{ id = 'f3'; cx = 944;  hw = 60 },
    @{ id = 'f4'; cx = 1065; hw = 60 }, @{ id = 'f5'; cx = 1184; hw = 60 }
)

function SrcColor($x, $y) {
    if ($x -lt 0) { $x = 0 }; if ($x -ge $SW) { $x = $SW - 1 }
    if ($y -lt 0) { $y = 0 }; if ($y -ge $SH) { $y = $SH - 1 }
    $i = $y * $stride + $x * 4
    return [System.Drawing.Color]::FromArgb(255, $buf[$i + 2], $buf[$i + 1], $buf[$i])
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

    $keepL = 100 - $c.hw; $keepR = 100 + $c.hw
    for ($y = 0; $y -lt $CELL; $y++) {
        $sy = $CHAR_TOP + $y
        $bl = New-Object System.Drawing.SolidBrush (SrcColor ($c.cx - $c.hw - 1) $sy)
        $g.FillRectangle($bl, $rc.X, ($rc.Y + $y), $keepL, 1)
        $bl.Dispose()
        $br = New-Object System.Drawing.SolidBrush (SrcColor ($c.cx + $c.hw + 1) $sy)
        $g.FillRectangle($br, ($rc.X + $keepR), ($rc.Y + $y), ($CELL - $keepR), 1)
        $br.Dispose()
    }
    Write-Output ("char {0} -> cell {1}" -f $c.id, $idx)
    $idx++
}

$g.Dispose()
$out = Join-Path $sp '..\src\avatar-sheet.png'
$sheet.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose(); $src.Dispose()
Write-Output ("saved {0} ({1} KB) cells={2} cols={3} rows={4}" -f $out, [math]::Round((Get-Item $out).Length / 1KB, 1), $idx, $COLS, $nRows)
