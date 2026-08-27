[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$IdentityName,

  [Parameter(Mandatory = $true)]
  [string]$Publisher,

  [Parameter(Mandatory = $true)]
  [string]$PublisherDisplayName,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+\.0$')]
  [string]$Version,

  [Parameter(Mandatory = $true)]
  [ValidateSet('x64', 'arm64')]
  [string]$Architecture,

  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-MakeAppx {
  $command = Get-Command MakeAppx.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $candidate = Get-ChildItem -Path $sdkBin -Filter MakeAppx.exe -File -Recurse |
    Where-Object { $_.DirectoryName -match '\\x64$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1

  if (-not $candidate) {
    throw 'MakeAppx.exe was not found. Install the Windows 10 or 11 SDK.'
  }

  return $candidate.FullName
}

function Escape-XmlValue([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw 'MSIX identity values must not be empty.'
  }

  return [System.Security.SecurityElement]::Escape($Value)
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopRoot = Split-Path -Parent $scriptRoot
$manifestTemplate = Join-Path $desktopRoot 'src-tauri\windows\Package.appxmanifest'
$assetSource = Join-Path $desktopRoot 'src-tauri\windows\Assets'
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
$resolvedManifest = (Resolve-Path -LiteralPath $manifestTemplate).Path
$resolvedAssets = (Resolve-Path -LiteralPath $assetSource).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
$makeAppx = Resolve-MakeAppx
$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) "guilda-msix-$([guid]::NewGuid())"
$packageRoot = Join-Path $stagingRoot 'package'
$unpackedRoot = Join-Path $stagingRoot 'verified'

try {
  New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $packageRoot 'Assets') -Force | Out-Null
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

  Copy-Item -LiteralPath $resolvedExecutable -Destination (Join-Path $packageRoot 'Guilda.exe')
  Copy-Item -Path (Join-Path $resolvedAssets '*.png') -Destination (Join-Path $packageRoot 'Assets')

  $manifest = Get-Content -LiteralPath $resolvedManifest -Raw
  $replacements = @{
    '__IDENTITY_NAME__' = Escape-XmlValue $IdentityName
    '__PUBLISHER__' = Escape-XmlValue $Publisher
    '__PUBLISHER_DISPLAY_NAME__' = Escape-XmlValue $PublisherDisplayName
    '__VERSION__' = $Version
    '__ARCHITECTURE__' = $Architecture
  }

  foreach ($entry in $replacements.GetEnumerator()) {
    $manifest = $manifest.Replace($entry.Key, $entry.Value)
  }

  if ($manifest -match '__[A-Z_]+__') {
    throw 'The generated package manifest still contains an unresolved token.'
  }

  Set-Content -LiteralPath (Join-Path $packageRoot 'AppxManifest.xml') -Value $manifest -Encoding utf8

  & $makeAppx pack /d $packageRoot /p $resolvedOutput /o
  if ($LASTEXITCODE -ne 0) {
    throw "MakeAppx pack failed with exit code $LASTEXITCODE."
  }

  & $makeAppx unpack /p $resolvedOutput /d $unpackedRoot /o
  if ($LASTEXITCODE -ne 0) {
    throw "MakeAppx verification unpack failed with exit code $LASTEXITCODE."
  }

  $hash = (Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host "Created $resolvedOutput"
  Write-Host "SHA256 $hash"
} finally {
  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
  }
}
