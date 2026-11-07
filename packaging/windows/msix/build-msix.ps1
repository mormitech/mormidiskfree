# Builds the MSIX package for the Microsoft Store from build\bin\mormidiskfree.exe:
#   pwsh packaging\windows\msix\build-msix.ps1 -Version 0.8.2
# Writes dist\mormidiskfree-<version>-windows-x64.msix. The package is not signed: the Store signs it on upload. To
# install it locally, sign it with a certificate whose subject matches -Publisher (the CI test step shows how).
param(
  [Parameter(Mandatory)] [string] $Version,
  [string] $IdentityName = 'Mormitech.mormiDiskFree',
  [string] $Publisher = 'CN=Mormitech',
  [string] $PublisherDisplayName = 'Mormitech'
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$here = $PSScriptRoot

# makeappx and makepri come with the Windows SDK; take the newest x64 copy.
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64\makeappx.exe" |
  Sort-Object { [version]$_.Directory.Parent.Name } | Select-Object -Last 1
if (-not $sdk) { throw 'makeappx.exe not found: install the Windows SDK' }
$bin = $sdk.Directory.FullName
Write-Host "Windows SDK tools: $bin"

# The Store wants four parts and a last part of 0.
$parts = $Version.Split('.')
if ($parts.Count -ne 3) { throw "version $Version should have three parts" }
$msixVersion = "$Version.0"

$stage = Join-Path ([IO.Path]::GetTempPath()) "mormidiskfree-msix-$([guid]::NewGuid())"
New-Item -ItemType Directory $stage | Out-Null
try {
  Copy-Item (Join-Path $root 'build\bin\mormidiskfree.exe') $stage
  Copy-Item (Join-Path $root 'LICENSE') $stage
  Copy-Item (Join-Path $here 'Assets') (Join-Path $stage 'Assets') -Recurse

  $esc = { param($s) [Security.SecurityElement]::Escape($s) }
  $manifest = (Get-Content (Join-Path $here 'AppxManifest.xml') -Raw).
    Replace('__IDENTITY_NAME__', (& $esc $IdentityName)).
    Replace('__PUBLISHER_DISPLAY_NAME__', (& $esc $PublisherDisplayName)).
    Replace('__PUBLISHER__', (& $esc $Publisher)).
    Replace('__VERSION__', $msixVersion)
  Set-Content (Join-Path $stage 'AppxManifest.xml') $manifest -Encoding utf8

  # resources.pri lets Windows pick the right icon size (scale-200, targetsize-*) for the Start menu and taskbar.
  $priconfig = Join-Path ([IO.Path]::GetTempPath()) "priconfig-$([guid]::NewGuid()).xml"
  & "$bin\makepri.exe" createconfig /cf $priconfig /dq en-US /pv 10.0.0 /o
  if ($LASTEXITCODE -ne 0) { throw "makepri createconfig failed with $LASTEXITCODE" }
  & "$bin\makepri.exe" new /pr $stage /cf $priconfig /mn (Join-Path $stage 'AppxManifest.xml') /of (Join-Path $stage 'resources.pri') /o
  if ($LASTEXITCODE -ne 0) { throw "makepri new failed with $LASTEXITCODE" }
  Remove-Item $priconfig

  $dist = Join-Path $root 'dist'
  New-Item -ItemType Directory $dist -Force | Out-Null
  $out = Join-Path $dist "mormidiskfree-$Version-windows-x64.msix"
  & "$bin\makeappx.exe" pack /d $stage /p $out /o
  if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed with $LASTEXITCODE" }
  Write-Host "built $out ($msixVersion, $IdentityName, $Publisher)"
}
finally {
  Remove-Item $stage -Recurse -Force
}
