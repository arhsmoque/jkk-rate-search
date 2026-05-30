#Requires -Version 7.0
<#
.SYNOPSIS
    Patches user-visible text strings in public/index.html (title, subtitle,
    search placeholder, footer). Targets specific elements — never touches
    structure, attributes, or CSP.

.EXAMPLE
    # Rebrand the app
    .\patch-copy.ps1 -Title "JKR Kadar Kerja" -Subtitle "Sistem Carian Harga"

    # Change search placeholder hint
    .\patch-copy.ps1 -Placeholder "Cari e.g. konkrit, paip, scaffolding…"

    # Update footer data note
    .\patch-copy.ps1 -Footer "Offline-ready • Data: JKR 2024 • Tekan / untuk cari"

.PARAMETER Title         Text inside <h1>
.PARAMETER Subtitle      Text inside <header><p>
.PARAMETER Placeholder   search input placeholder attribute
.PARAMETER Footer        Text inside <footer class="footer">
#>
param(
    [string]$Title,
    [string]$Subtitle,
    [string]$Placeholder,
    [string]$Footer
)

$htmlPath = Join-Path (Split-Path $PSScriptRoot -Parent) "public\index.html"
if (-not (Test-Path $htmlPath)) { Write-Error "Not found: $htmlPath"; exit 1 }

$content = Get-Content $htmlPath -Raw -Encoding utf8
$changed = [System.Collections.Generic.List[string]]::new()

if (-not [string]::IsNullOrWhiteSpace($Title)) {
    $content = $content -replace '(<h1>)[^<]+(</h1>)', "`${1}$Title`${2}"
    $changed.Add('title')
}

if (-not [string]::IsNullOrWhiteSpace($Subtitle)) {
    # <p> immediately after </h1> inside <header>
    $content = $content -replace '(</h1>\s*<p>)[^<]+(</p>)', "`${1}$Subtitle`${2}"
    $changed.Add('subtitle')
}

if (-not [string]::IsNullOrWhiteSpace($Placeholder)) {
    $content = $content -replace '(placeholder=")[^"]+(")', "`${1}$Placeholder`${2}"
    $changed.Add('placeholder')
}

if (-not [string]::IsNullOrWhiteSpace($Footer)) {
    # Footer content may have leading/trailing whitespace — use [\s\S]*? inside tags
    $content = $content -replace '(<footer class="footer">\s*)[\s\S]*?(\s*</footer>)', "`${1}$Footer`${2}"
    $changed.Add('footer')
}

if ($changed.Count -eq 0) {
    Write-Host "No changes made." -ForegroundColor Yellow
    exit 0
}

Set-Content $htmlPath $content -NoNewline -Encoding utf8
Write-Host "patch-copy: updated $($changed.Count) field(s): $($changed -join ', ')" -ForegroundColor Green
