Add-Type -AssemblyName System.Drawing

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$bitmaps = @()

foreach ($sz in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $sz, $sz
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # Transparent background
    $g.Clear([System.Drawing.Color]::Transparent)

    # Squircle paper background (#F1ECE2)
    $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0xF1, 0xEC, 0xE2))
    $radius = [Math]::Max(2, [int]($sz * 0.18))
    $rect = New-Object System.Drawing.Rectangle 1, 1, ($sz - 2), ($sz - 2)
    
    # Draw rounded rect for paper
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    
    $g.FillPath($bgBrush, $path)

    # Subtle hairline border (#CFC6B4)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 0xCF, 0xC6, 0xB4), 1.0)
    $g.DrawPath($pen, $path)

    # Central cinnabar red (#B9472B) seal
    $sealBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0xB9, 0x47, 0x2B))
    $sealMargin = [int]($sz * 0.22)
    $sealW = $sz - ($sealMargin * 2)
    $g.FillEllipse($sealBrush, $sealMargin, $sealMargin, $sealW, $sealW)

    # For larger sizes (>= 32), render the elegant "辯" character in white paper tone
    if ($sz -ge 32) {
        $fontSize = [float]($sz * 0.38)
        $fontFamily = New-Object System.Drawing.FontFamily("Microsoft JhengHei")
        $font = New-Object System.Drawing.Font ($fontFamily, $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $strFormat = New-Object System.Drawing.StringFormat
        $strFormat.Alignment = [System.Drawing.StringAlignment]::Center
        $strFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
        $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0xF1, 0xEC, 0xE2))
        $textRect = New-Object System.Drawing.RectangleF 0, ($sz * 0.02), $sz, $sz
        $g.DrawString("辯", $font, $textBrush, $textRect, $strFormat)
        $font.Dispose()
        $textBrush.Dispose()
    }

    $g.Dispose()
    $bitmaps += $bmp
}

# Encode to true multi-res ICO format
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms

# ICONDIR
$bw.Write([UInt16]0) # Reserved
$bw.Write([UInt16]1) # Type (1 = ICO)
$bw.Write([UInt16]$bitmaps.Count) # Image count

$offset = 6 + (16 * $bitmaps.Count)
$pngDataList = @()

foreach ($bmp in $bitmaps) {
    $pngStream = New-Object System.IO.MemoryStream
    $bmp.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes = $pngStream.ToArray()
    $pngDataList += ,$pngBytes
    $pngStream.Dispose()

    $w = if ($bmp.Width -ge 256) { 0 } else { [byte]$bmp.Width }
    $h = if ($bmp.Height -ge 256) { 0 } else { [byte]$bmp.Height }

    $bw.Write([byte]$w)
    $bw.Write([byte]$h)
    $bw.Write([byte]0) # Color palette count
    $bw.Write([byte]0) # Reserved
    $bw.Write([UInt16]1) # Color planes
    $bw.Write([UInt16]32) # Bits per pixel
    $bw.Write([UInt32]$pngBytes.Length)
    $bw.Write([UInt32]$offset)

    $offset += $pngBytes.Length
}

foreach ($pngBytes in $pngDataList) {
    $bw.Write($pngBytes)
}

$bw.Flush()
$outPath = Join-Path $PSScriptRoot "app.ico"
[System.IO.File]::WriteAllBytes($outPath, $ms.ToArray())
$bw.Dispose()
$ms.Dispose()

foreach ($bmp in $bitmaps) { $bmp.Dispose() }
Write-Host "Generated authentic website app.ico at $outPath"
