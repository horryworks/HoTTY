Add-Type -AssemblyName System.Drawing

$sourcePath = "public\icon.png"
$destPath = "public\icon_square.png"

if (-not (Test-Path $sourcePath)) {
    Write-Error "Source file not found: $sourcePath"
    exit 1
}

$img = [System.Drawing.Image]::FromFile($sourcePath)
$maxDim = [Math]::Max($img.Width, $img.Height)

$bmp = New-Object System.Drawing.Bitmap $maxDim, $maxDim
$g = [System.Drawing.Graphics]::FromImage($bmp)

$g.Clear([System.Drawing.Color]::Transparent)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

$x = ($maxDim - $img.Width) / 2
$y = ($maxDim - $img.Height) / 2

$g.DrawImage($img, $x, $y, $img.Width, $img.Height)

$bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
$img.Dispose()

Write-Output "Created squared image at $destPath ($maxDim x $maxDim)"
