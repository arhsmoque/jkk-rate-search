#Requires -Version 7.0
<#
.SYNOPSIS
    Patches CSS custom properties in public/styles.css :root block.
    Run from anywhere — script locates the file relative to its own location.

.EXAMPLE
    # Change accent colour and font
    .\patch-theme.ps1 -Accent "#1a56db" -AccentLight "#dbeafe" -FontFamily "'Inter', sans-serif"

    # Scale up all font sizes by replacing the base token
    .\patch-theme.ps1 -FsBody "1.05rem" -FsTitle "1.35rem"

.PARAMETER Accent        New value for --accent       (e.g. "#003366")
.PARAMETER AccentLight   New value for --accent-light (e.g. "#e6f0ff")
.PARAMETER Bg            New value for --bg           (e.g. "#f5f7fa")
.PARAMETER Surface       New value for --surface      (e.g. "#ffffff")
.PARAMETER Success       New value for --success      (e.g. "#059669")
.PARAMETER Muted         New value for --muted        (e.g. "#6b7280")
.PARAMETER Border        New value for --border       (e.g. "#d1d5db")
.PARAMETER ChipBg        New value for --chip-bg      (e.g. "#e5e7eb")
.PARAMETER ChipText      New value for --chip-text    (e.g. "#374151")
.PARAMETER FontFamily    New value for --font-family  (e.g. "'Inter', sans-serif")
.PARAMETER FsTitle       New value for --fs-title     (e.g. "1.4rem")
.PARAMETER FsBody        New value for --fs-body      (e.g. "1.05rem")
.PARAMETER FsItem        New value for --fs-item      (e.g. "0.95rem")
.PARAMETER FsMeta        New value for --fs-meta      (e.g. "0.85rem")
.PARAMETER FsCode        New value for --fs-code      (e.g. "0.9rem")
.PARAMETER FsTiny        New value for --fs-tiny      (e.g. "0.75rem")
.PARAMETER FsMicro       New value for --fs-micro     (e.g. "0.7rem")
#>
param(
    [string]$Accent,
    [string]$AccentLight,
    [string]$Bg,
    [string]$Surface,
    [string]$Success,
    [string]$Muted,
    [string]$Border,
    [string]$ChipBg,
    [string]$ChipText,
    [string]$FontFamily,
    [string]$FsTitle,
    [string]$FsBody,
    [string]$FsItem,
    [string]$FsMeta,
    [string]$FsCode,
    [string]$FsTiny,
    [string]$FsMicro
)

$cssPath = Join-Path (Split-Path $PSScriptRoot -Parent) "public\styles.css"
if (-not (Test-Path $cssPath)) { Write-Error "Not found: $cssPath"; exit 1 }

# Map: CSS var name → new value (skip nulls/empty)
$patches = [ordered]@{
    '--accent'       = $Accent
    '--accent-light' = $AccentLight
    '--bg'           = $Bg
    '--surface'      = $Surface
    '--success'      = $Success
    '--muted'        = $Muted
    '--border'       = $Border
    '--chip-bg'      = $ChipBg
    '--chip-text'    = $ChipText
    '--font-family'  = $FontFamily
    '--fs-title'     = $FsTitle
    '--fs-body'      = $FsBody
    '--fs-item'      = $FsItem
    '--fs-meta'      = $FsMeta
    '--fs-code'      = $FsCode
    '--fs-tiny'      = $FsTiny
    '--fs-micro'     = $FsMicro
}

$content = Get-Content $cssPath -Raw -Encoding utf8
$changed = [System.Collections.Generic.List[string]]::new()

foreach ($varName in $patches.Keys) {
    $newVal = $patches[$varName]
    if ([string]::IsNullOrWhiteSpace($newVal)) { continue }

    # Pattern: --var-name: <anything up to semicolon>;
    $escaped = [regex]::Escape($varName)
    $pattern = "($escaped\s*:\s*)[^;]+(;)"
    if ($content -match $pattern) {
        $content = $content -replace $pattern, "`${1}$newVal`${2}"
        $changed.Add($varName)
    } else {
        Write-Warning "  Variable not found in :root — skipped: $varName"
    }
}

if ($changed.Count -eq 0) {
    Write-Host "No changes made." -ForegroundColor Yellow
    exit 0
}

Set-Content $cssPath $content -NoNewline -Encoding utf8
Write-Host "patch-theme: updated $($changed.Count) variable(s): $($changed -join ', ')" -ForegroundColor Green
