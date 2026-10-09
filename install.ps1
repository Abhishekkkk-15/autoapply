<#
.SYNOPSIS
    Installs and bootstraps AutoApply on Windows.
.DESCRIPTION
    Installs uv (if missing), creates virtual environment, installs dependencies,
    installs Chromium via Playwright, sets up data directory and .env template,
    and validates the autoapply CLI installation.
.PARAMETER SkipPlaywright
    Skips downloading the Playwright Chromium browser binaries.
#>
[CmdletBinding()]
param(
    [switch]$SkipPlaywright
)

$ErrorActionPreference = "Stop"

# Enable UTF-8 encoding
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
}
if ($ScriptDir) {
    Set-Location $ScriptDir
}

if (-not (Test-Path "pyproject.toml") -or -not (Test-Path "job_agent")) {
    Write-Host "[ERROR] Please run this script from the root of the autoapply repository." -ForegroundColor Red
    exit 1
}

Write-Host @"
========================================================================
     _         _             _                   _       
    / \  _   _| |_ ___      / \   _ __  _ __   | |_   _ 
   / _ \| | | | __/ _ \    / _ \ | '_ \| '_ \  | | | | |
  / ___ \ |_| | || (_) |  / ___ \| |_) | |_) | | | |_| |
 /_/   \_\__,_|\__\___/  /_/   \_\ .__/| .__/  |_|\__, |
                                 |_|   |_|        |___/ 
      Autonomous AI Job Application Agent Setup
========================================================================
"@ -ForegroundColor Cyan

function Test-CommandExists($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

# 1. Check or install uv
Write-Host "`n[1/5] Checking package manager (uv)..." -ForegroundColor Yellow

$localBin = Join-Path $env:USERPROFILE ".local\bin"
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"

if (-not (Test-CommandExists "uv")) {
    if (Test-Path (Join-Path $localBin "uv.exe")) {
        $env:PATH = "$localBin;$env:PATH"
    } elseif (Test-Path (Join-Path $cargoBin "uv.exe")) {
        $env:PATH = "$cargoBin;$env:PATH"
    }
}

if (-not (Test-CommandExists "uv")) {
    Write-Host "  uv not found in PATH. Downloading and installing uv via Astral..." -ForegroundColor Cyan
    try {
        irm https://astral.sh/uv/install.ps1 | iex
        if (Test-Path (Join-Path $localBin "uv.exe")) {
            $env:PATH = "$localBin;$env:PATH"
        } elseif (Test-Path (Join-Path $cargoBin "uv.exe")) {
            $env:PATH = "$cargoBin;$env:PATH"
        }
    } catch {
        Write-Host "  Could not run Astral web installer. Trying pip fallback..." -ForegroundColor Yellow
        pip install --upgrade uv
    }
}

if (-not (Test-CommandExists "uv")) {
    Write-Host "[ERROR] Failed to install or locate 'uv'. Please install it from https://docs.astral.sh/uv/ and re-run." -ForegroundColor Red
    exit 1
}

$uvVersion = (uv --version)
Write-Host "  [OK] Found $uvVersion" -ForegroundColor Green

# 2. Sync dependencies
Write-Host "`n[2/5] Installing dependencies with 'uv sync'..." -ForegroundColor Yellow
uv sync
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] 'uv sync' failed. Check Python version compatibility (>=3.11, <3.14)." -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Python virtual environment and dependencies synchronized." -ForegroundColor Green

# 3. Install Playwright Chromium browser
Write-Host "`n[3/5] Checking browser engine..." -ForegroundColor Yellow
if ($SkipPlaywright) {
    Write-Host "  [SKIPPED] Playwright Chromium installation skipped by user flag." -ForegroundColor DarkGray
} else {
    Write-Host "  Installing Chromium browser for automation..." -ForegroundColor Cyan
    uv run playwright install chromium
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [WARN] Playwright install exited with code $LASTEXITCODE. You can re-run manually with 'uv run playwright install chromium'." -ForegroundColor Yellow
    } else {
        Write-Host "  [OK] Chromium installed successfully." -ForegroundColor Green
    }
}

# 4. Prepare local directories and config
Write-Host "`n[4/5] Setting up local directories and environment..." -ForegroundColor Yellow
$dataDir = Join-Path $ScriptDir "job_agent\data"
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    Write-Host "  [OK] Created local data directory: $dataDir" -ForegroundColor Green
} else {
    Write-Host "  [OK] Data directory exists: $dataDir" -ForegroundColor Green
}

$envFile = Join-Path $ScriptDir "job_agent\.env"
$envExample = Join-Path $ScriptDir "job_agent\.env.example"
if (-not (Test-Path $envFile)) {
    if (Test-Path $envExample) {
        Copy-Item $envExample $envFile
        Write-Host "  [OK] Created 'job_agent\.env' from template." -ForegroundColor Green
    }
} else {
    Write-Host "  [OK] 'job_agent\.env' already present." -ForegroundColor Green
}

# 5. Verify CLI executable
Write-Host "`n[5/5] Verifying AutoApply CLI..." -ForegroundColor Yellow
$helpOutput = uv run autoapply --help
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] AutoApply CLI verification failed." -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] 'autoapply' CLI successfully registered and operational!" -ForegroundColor Green

Write-Host @"

========================================================================
[SUCCESS] AutoApply Installation Complete!
========================================================================

Next Steps:
  1. Add your AI API key:
     Edit 'job_agent\.env' and provide your BROWSER_USE_API_KEY or OPENAI_API_KEY.

  2. Add your resume:
     Place your resume at 'job_agent\data\resume.pdf' or 'job_agent\data\resume.txt'.

  3. Run the interactive onboarding wizard:
     uv run autoapply setup

  4. Run system diagnostics:
     uv run autoapply doctor

  5. Test autonomous application in safe dry-run mode:
     uv run autoapply auto --dry-run

========================================================================
"@ -ForegroundColor Green
