<#
  Imprime une image PNG sur une imprimante nommee, a une taille physique exacte.
  Utilise System.Drawing.Printing : aucune dependance externe.

  Exemples :
    powershell -File print-image.ps1 -ListPrinters
    powershell -File print-image.ps1 -ListPapers -Printer "Brother QL-700"
    powershell -File print-image.ps1 -Image label.png -Printer "Brother QL-700" -WidthMm 62 -HeightMm 113
#>
[CmdletBinding()]
param(
  [string]$Image,
  [string]$Printer,
  [double]$WidthMm = 62,
  [double]$HeightMm = 113,
  [string]$PaperName = '',
  [double]$OffsetXMm = 0,  # recalage fin (+ = vers la droite)
  [double]$OffsetYMm = 0,  # recalage fin (+ = vers le bas)
  [switch]$ListPrinters,
  [switch]$ListPapers,
  [switch]$DryRun          # tout preparer sans envoyer a l'imprimante (test)
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Add-Type -AssemblyName System.Drawing

if ($ListPrinters) {
  $default = (New-Object System.Drawing.Printing.PrinterSettings).PrinterName
  $out = @()
  foreach ($n in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) {
    $out += [pscustomobject]@{ name = $n; isDefault = ($n -eq $default) }
  }
  $out | ConvertTo-Json -Compress -Depth 3
  exit 0
}

if ($ListPapers) {
  if (-not $Printer) { throw 'Parametre -Printer requis avec -ListPapers.' }
  $ps = New-Object System.Drawing.Printing.PrinterSettings
  $ps.PrinterName = $Printer
  if (-not $ps.IsValid) { throw "Imprimante introuvable : $Printer" }
  # La zone reellement imprimable depend du format choisi : c'est elle qui compte
  # pour positionner l'image, pas les dimensions nominales de la page.
  $page = New-Object System.Drawing.Printing.PageSettings($ps)
  $out = @()
  foreach ($p in $ps.PaperSizes) {
    $pa = $null
    try { $page.PaperSize = $p; $pa = $page.PrintableArea } catch {}
    $out += [pscustomobject]@{
      name       = $p.PaperName
      widthMm    = [Math]::Round($p.Width * 0.254, 1)
      heightMm   = [Math]::Round($p.Height * 0.254, 1)
      printXMm   = if ($pa) { [Math]::Round($pa.X * 0.254, 2) }      else { 0 }
      printYMm   = if ($pa) { [Math]::Round($pa.Y * 0.254, 2) }      else { 0 }
      printWMm   = if ($pa) { [Math]::Round($pa.Width * 0.254, 2) }  else { 0 }
      printHMm   = if ($pa) { [Math]::Round($pa.Height * 0.254, 2) } else { 0 }
    }
  }
  $out | ConvertTo-Json -Compress -Depth 3
  exit 0
}

if (-not $Image)   { throw 'Parametre -Image requis.' }
if (-not $Printer) { throw 'Parametre -Printer requis.' }

$imagePath = (Resolve-Path -LiteralPath $Image).Path
$script:img = [System.Drawing.Image]::FromFile($imagePath)

# Dimensions cibles en centiemes de pouce (unite de System.Drawing.Printing).
$script:pw = [int][Math]::Round(($WidthMm  / 25.4) * 100)
$script:ph = [int][Math]::Round(($HeightMm / 25.4) * 100)

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $Printer
if (-not $doc.PrinterSettings.IsValid) {
  $script:img.Dispose()
  throw "Imprimante introuvable ou hors ligne : $Printer"
}
$doc.DocumentName = 'Etiquette ' + [System.IO.Path]::GetFileNameWithoutExtension($imagePath)

# 1) Format explicitement demande, 2) format du pilote proche de la cible,
# 3) format personnalise.
$chosen = $null
if ($PaperName) {
  foreach ($p in $doc.PrinterSettings.PaperSizes) {
    if ($p.PaperName -eq $PaperName) { $chosen = $p; break }
  }
  if (-not $chosen) { Write-Warning "Format '$PaperName' absent du pilote, recherche automatique." }
}
if (-not $chosen) {
  $best = $null; $bestScore = [double]::MaxValue
  foreach ($p in $doc.PrinterSettings.PaperSizes) {
    if ($p.Width -le 0 -or $p.Height -le 0) { continue }
    $dw = [Math]::Abs($p.Width - $script:pw)
    if ($dw -gt 40) { continue }                      # largeur > 10 mm d'ecart : ignore
    $dh = [Math]::Abs($p.Height - $script:ph)
    $score = $dw * 4 + $dh                            # la largeur prime (rouleau)
    if ($score -lt $bestScore) { $bestScore = $score; $best = $p }
  }
  $chosen = $best
}
if ($chosen) {
  $doc.DefaultPageSettings.PaperSize = $chosen
  $script:pw = $chosen.Width
  $script:ph = $chosen.Height
} else {
  $custom = New-Object System.Drawing.Printing.PaperSize('Etiquette', $script:pw, $script:ph)
  $doc.DefaultPageSettings.PaperSize = $custom
}

$doc.DefaultPageSettings.Landscape = $false
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$doc.OriginAtMargins = $false

# Zone reellement imprimable. Avec OriginAtMargins = $false, l'origine du Graphics
# est deja le coin de cette zone : dessiner sur toute la largeur de la PAGE
# deborderait donc a droite de (largeur page - largeur imprimable).
$script:aw = $script:pw
$script:ah = $script:ph
try {
  $pa = $doc.DefaultPageSettings.PrintableArea
  if ($pa.Width -gt 10 -and $pa.Height -gt 10 -and $pa.Width -le $script:pw + 1 -and $pa.Height -le $script:ph + 1) {
    $script:aw = [int][Math]::Round($pa.Width)
    $script:ah = [int][Math]::Round($pa.Height)
  }
} catch {}

$script:ox = [int][Math]::Round(($OffsetXMm / 25.4) * 100)
$script:oy = [int][Math]::Round(($OffsetYMm / 25.4) * 100)

$doc.add_PrintPage({
  param($sender, $e)
  $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Display
  $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  # Contain dans la zone imprimable : on garde le ratio, on centre.
  # Evite toute deformation du code-barres.
  $ir = $script:img.Width / $script:img.Height
  $pr = $script:aw / $script:ah
  if ($ir -gt $pr) { $w = $script:aw; $h = [int][Math]::Round($script:aw / $ir) }
  else             { $h = $script:ah; $w = [int][Math]::Round($script:ah * $ir) }
  $x = [int](($script:aw - $w) / 2) + $script:ox
  $y = [int](($script:ah - $h) / 2) + $script:oy

  $e.Graphics.DrawImage($script:img, (New-Object System.Drawing.Rectangle($x, $y, $w, $h)))
  $e.HasMorePages = $false
})

try {
  if (-not $DryRun) { $doc.Print() }
  $paper = $doc.DefaultPageSettings.PaperSize.PaperName
  $tag = if ($DryRun) { 'DRYRUN' } else { 'OK' }
  $pageMm = '{0:N1}x{1:N1}' -f ($script:pw * 0.254), ($script:ph * 0.254)
  $areaMm = '{0:N1}x{1:N1}' -f ($script:aw * 0.254), ($script:ah * 0.254)
  Write-Output "$tag|$Printer|$paper|page ${pageMm}mm|imprimable ${areaMm}mm|decalage ${OffsetXMm}/${OffsetYMm}mm"
} finally {
  $script:img.Dispose()
  $doc.Dispose()
}
