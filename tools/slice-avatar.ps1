# =============================================================================
# slice-avatar.ps1 - build src/avatar-sheet.png from tools/avatar-source.png
#
#   8 characters, 4 columns x 2 rows, 200px cells.
#
# Each cell is the bust exactly as it was drawn - face, hair and the top the
# artist gave them. Nothing is recoloured or recombined, so every character
# looks the way the original picture looks.
#
# The background behind every character is flattened to one flat colour.
#
# The source is a photographed/painted card: the paper carries a faint texture
# and an uneven wash, so the "background" is really a few hundred slightly
# different creams. Earlier this strip was filled by stretching each row's own
# edge pixel sideways, which turned that unevenness into visible horizontal
# streaks - worst behind the girls, where a hard band ran across the cell.
#
# So instead of copying the paper, the paper is replaced. A flood fill starts
# from the cell border and walks inwards over everything that is still close to
# the paper colour, painting it flat. It stops at the ink outline around each
# character, so hair, face and clothes are untouched - including the pale cream
# jumper, which is enclosed by its own outline and never reached.
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

# How far a pixel may sit from the flat colour and still count as paper.
# 26 swallows the uneven wash (the worst band measured 24) and stays well under
# the ink outline, which is darker than anything the fill may cross.
$BG_TOL = 26

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

    # Wipe the neighbours out with the flat colour. No sampling, no smear.
    $keepL = 100 - $c.hwL; $keepR = 100 + $c.hwR
    if ($keepL -gt 0) { $g.FillRectangle($bgBrush, $rc.X, $rc.Y, $keepL, $CELL) }
    if ($keepR -lt $CELL) { $g.FillRectangle($bgBrush, ($rc.X + $keepR), $rc.Y, ($CELL - $keepR), $CELL) }

    Write-Output ("char {0} -> cell {1}" -f $c.id, $idx)
    $idx++
}
$g.Dispose()

# --------------------------------------------------------------- flood fill
# Done on the finished sheet, cell by cell, so the strips and the kept picture
# end up as one continuous flat field with no seam between them.
$sr2 = New-Object System.Drawing.Rectangle 0, 0, $sheet.Width, $sheet.Height
$sd = $sheet.LockBits($sr2, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$sstride = $sd.Stride
$sbuf = New-Object byte[] ($sstride * $sheet.Height)
[System.Runtime.InteropServices.Marshal]::Copy($sd.Scan0, $sbuf, 0, $sbuf.Length)

$changedTotal = 0
$idx = 0
foreach ($c in $CHARS) {
    $col = $idx % $COLS; $row = [math]::Floor($idx / $COLS)
    $ox = $col * $CELL; $oy = $row * $CELL

    $seen = New-Object 'bool[]' ($CELL * $CELL)
    $stack = New-Object System.Collections.Generic.Stack[int]

    # Seed from the top edge and both sides. The bottom edge cuts across the
    # clothes, so it is left out - starting there would let the fill in through
    # a pale jumper instead of around it.
    for ($x = 0; $x -lt $CELL; $x++) { $stack.Push($x) }                       # y = 0
    for ($y = 1; $y -lt $CELL; $y++) { $stack.Push($y * $CELL); $stack.Push($y * $CELL + $CELL - 1) }

    $changed = 0
    while ($stack.Count -gt 0) {
        $p = $stack.Pop()
        if ($seen[$p]) { continue }
        $seen[$p] = $true
        $py = [math]::Floor($p / $CELL); $px = $p - $py * $CELL
        $i = ($oy + $py) * $sstride + ($ox + $px) * 4
        $dr = [math]::Abs($sbuf[$i + 2] - $BGR)
        $dg = [math]::Abs($sbuf[$i + 1] - $BGG)
        $db = [math]::Abs($sbuf[$i] - $BGB)
        $dist = [math]::Max([math]::Max($dr, $dg), $db)
        if ($dist -gt $BG_TOL) { continue }          # ink outline or clothing - stop here

        if ($dist -gt 0) {
            $sbuf[$i] = $BGB; $sbuf[$i + 1] = $BGG; $sbuf[$i + 2] = $BGR
            $changed++
        }
        if ($px -gt 0) { $stack.Push($p - 1) }
        if ($px -lt $CELL - 1) { $stack.Push($p + 1) }
        if ($py -gt 0) { $stack.Push($p - $CELL) }
        if ($py -lt $CELL - 1) { $stack.Push($p + $CELL) }
    }
    Write-Output ("flatten {0}: {1} px" -f $c.id, $changed)
    $changedTotal += $changed
    $idx++
}

[System.Runtime.InteropServices.Marshal]::Copy($sbuf, 0, $sd.Scan0, $sbuf.Length)
$sheet.UnlockBits($sd)

$out = Join-Path $sp '..\src\avatar-sheet.png'
$sheet.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose(); $src.Dispose()
Write-Output ("saved {0} ({1} KB) cells={2} cols={3} rows={4} flattened={5} px" -f $out, [math]::Round((Get-Item $out).Length / 1KB, 1), $idx, $COLS, $nRows, $changedTotal)
