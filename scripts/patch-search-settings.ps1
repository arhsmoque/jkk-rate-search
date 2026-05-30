#Requires -Version 7.0
<#
.SYNOPSIS
    Patches search behaviour settings (result limit, debounce, locale, DB path)
    in the CONFIG block of public/app.js. Only touches that delimited block.

.EXAMPLE
    # Raise result limit and tighten debounce
    .\patch-config.ps1 -SearchLimit 30 -Debounce 100

    # Switch locale for currency formatting
    .\patch-config.ps1 -Locale "ms-MY"

.PARAMETER SearchLimit   SEARCH_LIMIT integer       (e.g. 30)
.PARAMETER FuzzyMinSim   FUZZY_MIN_SIM float 0..1   (e.g. 0.55)
.PARAMETER Debounce      SEARCH_DEBOUNCE_MS integer (e.g. 200)
.PARAMETER Locale        LOCALE string              (e.g. "ms-MY")
.PARAMETER DbPath        DB_PATH string             (e.g. "assets/jkk-v2.db")
#>
param(
    [Nullable[int]]    $SearchLimit,
    [Nullable[double]] $FuzzyMinSim,
    [Nullable[int]]    $Debounce,
    [string]           $Locale,
    [string]           $DbPath
)

$jsPath = Join-Path (Split-Path $PSScriptRoot -Parent) "public\app.js"
if (-not (Test-Path $jsPath)) { Write-Error "Not found: $jsPath"; exit 1 }

$content = Get-Content $jsPath -Raw -Encoding utf8

# Validate we're operating inside the CONFIG block only
if ($content -notmatch 'const CONFIG = \{') {
    Write-Error "CONFIG block not found in app.js — has it been renamed?"; exit 1
}

$changed = [System.Collections.Generic.List[string]]::new()

function Update-NumericKey {
    param([string]$content, [string]$key, $newVal)
    $escaped = [regex]::Escape($key)
    $pattern = "($escaped\s*:\s*)[\d.]+(,)"
    if ($content -match $pattern) {
        return $content -replace $pattern, "`${1}$newVal`${2}"
    }
    Write-Warning "  Key not found: $key"
    return $content
}

function Update-StringKey {
    param([string]$content, [string]$key, [string]$newVal)
    $escaped = [regex]::Escape($key)
    # Match: KEY: "value", — value may contain letters, dots, hyphens, slashes
    $pattern = "($escaped\s*:\s*)""[^""]*""(,)"
    if ($content -match $pattern) {
        return $content -replace $pattern, "`${1}""$newVal""`${2}"
    }
    Write-Warning "  Key not found: $key"
    return $content
}

if ($null -ne $SearchLimit) {
    $content = Update-NumericKey $content 'SEARCH_LIMIT' $SearchLimit
    $changed.Add('SEARCH_LIMIT')
}
if ($null -ne $FuzzyMinSim) {
    $content = Update-NumericKey $content 'FUZZY_MIN_SIM' $FuzzyMinSim
    $changed.Add('FUZZY_MIN_SIM')
}
if ($null -ne $Debounce) {
    $content = Update-NumericKey $content 'SEARCH_DEBOUNCE_MS' $Debounce
    $changed.Add('SEARCH_DEBOUNCE_MS')
}
if (-not [string]::IsNullOrWhiteSpace($Locale)) {
    $content = Update-StringKey $content 'LOCALE' $Locale
    $changed.Add('LOCALE')
}
if (-not [string]::IsNullOrWhiteSpace($DbPath)) {
    $content = Update-StringKey $content 'DB_PATH' $DbPath
    $changed.Add('DB_PATH')
}

if ($changed.Count -eq 0) {
    Write-Host "No changes made." -ForegroundColor Yellow
    exit 0
}

Set-Content $jsPath $content -NoNewline -Encoding utf8
Write-Host "patch-config: updated $($changed.Count) key(s): $($changed -join ', ')" -ForegroundColor Green
