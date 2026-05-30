#Requires -Version 7.0
<#
.SYNOPSIS
    Patches user-visible text and PDF download links in public/index.html.
    Each parameter is optional — only supplied values are changed.
    Script is idempotent: safe to call multiple times.

.OUTPUTS
    Default: coloured status line to host.
    -Json:   single-line JSON object — { "status": "ok"|"error", "changed": [...], "count": N }
             or { "status": "error", "message": "..." } — suitable for agent parsing.

.EXAMPLE
    # Update all three PDF download links in one call
    .\patch-ui-text.ps1 `
        -CivilHref       "https://drive.google.com/file/d/FILEID_CIVIL/view" `
        -ElectricalHref  "https://drive.google.com/file/d/FILEID_ELEC/view" `
        -PukalHref       "https://drive.google.com/file/d/FILEID_PUKAL/view"

    # Rebrand the app heading and subtitle
    .\patch-ui-text.ps1 -Title "JKR Kadar Kerja" -Subtitle "Sistem Carian Harga"

    # Machine-readable output for agent pipelines
    .\patch-ui-text.ps1 -Footer "Data: JKR 2024 • Tekan / untuk cari" -Json

.PARAMETER PageTitle        Text inside <title> (browser tab / PWA name)
.PARAMETER MetaDescription  content= of <meta name="description">
.PARAMETER Title            Text inside <h1>
.PARAMETER Subtitle         Text inside <header><p> (edition line under <h1>)
.PARAMETER Placeholder      search input placeholder= attribute
.PARAMETER DownloadsNote    Text inside <p class="downloads-note">
.PARAMETER Footer           Text inside <footer class="footer">
.PARAMETER CivilHref        href= of the Civil download card <a> (Google Drive or direct PDF URL)
.PARAMETER ElectricalHref   href= of the Elektrik download card <a>
.PARAMETER PukalHref        href= of the Pukal download card <a>
.PARAMETER Json             Emit a single-line JSON result instead of coloured host output
#>
param(
    [string]$PageTitle,
    [string]$MetaDescription,
    [string]$Title,
    [string]$Subtitle,
    [string]$Placeholder,
    [string]$DownloadsNote,
    [string]$Footer,
    [string]$CivilHref,
    [string]$ElectricalHref,
    [string]$PukalHref,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'

$htmlPath = Join-Path (Split-Path $PSScriptRoot -Parent) "public\index.html"

if (-not (Test-Path $htmlPath)) {
    if ($Json) { [pscustomobject]@{ status = 'error'; message = "File not found: $htmlPath" } | ConvertTo-Json -Compress }
    else        { Write-Error "Not found: $htmlPath" }
    exit 1
}

$content = Get-Content $htmlPath -Raw -Encoding utf8
$changed = [System.Collections.Generic.List[string]]::new()

function Apply {
    param([string]$Name, [string]$Value, [string]$Pattern, [string]$Replacement)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $script:content }
    if ($script:content -notmatch $Pattern) {
        Write-Warning "  Pattern not found — skipped: $Name"
        return $script:content
    }
    $script:changed.Add($Name)
    return $script:content -replace $Pattern, $Replacement
}

# <title> tag
$content = Apply 'page-title' $PageTitle '(<title>)[^<]+(</title>)' "`${1}$PageTitle`${2}"

# <meta name="description" content="...">
$content = Apply 'meta-description' $MetaDescription '(name="description" content=")[^"]+(">' "`${1}$MetaDescription`${2}"

# <h1> heading
$content = Apply 'title' $Title '(<h1>)[^<]+(</h1>)' "`${1}$Title`${2}"

# <p> subtitle immediately after </h1>
$content = Apply 'subtitle' $Subtitle '(</h1>\s*<p>)[^<]+(</p>)' "`${1}$Subtitle`${2}"

# search placeholder
$content = Apply 'placeholder' $Placeholder '(placeholder=")[^"]+("(?=\s*$|\s+autocomplete))' "`${1}$Placeholder`${2}"

# downloads note
$content = Apply 'downloads-note' $DownloadsNote '(<p class="downloads-note">)[^<]+(</p>)' "`${1}$DownloadsNote`${2}"

# footer
$content = Apply 'footer' $Footer '(<footer class="footer">\s*)[\s\S]*?(\s*</footer>)' "`${1}$Footer`${2}"

# PDF download card hrefs — matched by data-doc= attribute on same tag
$content = Apply 'civil-href' $CivilHref '(<a href=")[^"]*(" class="download-card" data-doc="civil")' "`${1}$CivilHref`${2}"
$content = Apply 'electrical-href' $ElectricalHref '(<a href=")[^"]*(" class="download-card" data-doc="electrical")' "`${1}$ElectricalHref`${2}"
$content = Apply 'pukal-href' $PukalHref '(<a href=")[^"]*(" class="download-card" data-doc="pukal")' "`${1}$PukalHref`${2}"

if ($changed.Count -eq 0) {
    if ($Json) { [pscustomobject]@{ status = 'ok'; changed = @(); count = 0 } | ConvertTo-Json -Compress }
    else        { Write-Host "No changes made." -ForegroundColor Yellow }
    exit 0
}

Set-Content $htmlPath $content -NoNewline -Encoding utf8

if ($Json) {
    [pscustomobject]@{ status = 'ok'; changed = @($changed); count = $changed.Count } | ConvertTo-Json -Compress
} else {
    Write-Host "patch-ui-text: updated $($changed.Count) field(s): $($changed -join ', ')" -ForegroundColor Green
}
