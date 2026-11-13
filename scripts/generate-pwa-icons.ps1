param([string]$Root)
# Generates ZARKHEZ PWA icons from the existing logo mark using System.Drawing (no npm deps).
Add-Type -AssemblyName System.Drawing
$src = Join-Path $Root 'public/images/zarkhez-logo-mark.png'
$outDir = Join-Path $Root 'public/icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$logo = [System.Drawing.Image]::FromFile($src)
$bg = [System.Drawing.Color]::FromArgb(255, 2, 20, 3)   # matches the logo's own background

function New-Icon([int]$size, [double]$scale, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear($bg)
  $inner = [int][Math]::Round($size * $scale)
  $off = [int][Math]::Floor(($size - $inner) / 2)
  $attr = New-Object System.Drawing.Imaging.ImageAttributes
  $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)  # avoids edge bleeding
  $dest = New-Object System.Drawing.Rectangle $off, $off, $inner, $inner
  $g.DrawImage($logo, $dest, 0, 0, $logo.Width, $logo.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
  $g.Dispose()
  $path = Join-Path $outDir $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  "{0,-28} {1,5}x{1,-5} {2,8} bytes" -f $name, $size, (Get-Item $path).Length
}

New-Icon 192 1.0  'icon-192.png'
New-Icon 512 1.0  'icon-512.png'
New-Icon 192 0.78 'maskable-192.png'   # logo kept inside the 80% maskable safe zone
New-Icon 512 0.78 'maskable-512.png'
New-Icon 180 1.0  'apple-touch-icon.png'
New-Icon 96  1.0  'icon-96.png'        # shortcut icons
New-Icon 32  1.0  'favicon-32.png'
$logo.Dispose()
