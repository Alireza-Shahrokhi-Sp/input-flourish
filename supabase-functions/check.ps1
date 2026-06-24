# Type-checks the Supabase Edge Functions with Deno.
# Run from anywhere:  pwsh -File supabase-functions/check.ps1
# Resolves the Deno binary even if PATH hasn't been refreshed since install.

$ErrorActionPreference = "Stop"

function Resolve-Deno {
  $cmd = Get-Command deno -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $wingetPath = Join-Path $env:LOCALAPPDATA `
    "Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe"
  if (Test-Path $wingetPath) { return $wingetPath }
  $found = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages") `
    -Recurse -Filter deno.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.FullName }
  throw "Deno not found. Install with: winget install --id DenoLand.Deno -e"
}

$deno = Resolve-Deno
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Using Deno at: $deno"
Write-Host "Checking functions in: $dir`n"

Push-Location $dir
try {
  & $deno check generate-story/index.ts
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Host "`nAll Edge Functions type-check cleanly." -ForegroundColor Green
}
finally {
  Pop-Location
}
