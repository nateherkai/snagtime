param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9._-]{1,64}$')][string]$Profile,
  [string]$ConfigPath = '',
  [string]$OutputPath = '.env.stripe-sandbox.local'
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$target = [IO.Path]::GetFullPath((Join-Path $root $OutputPath))
$allowed = [IO.Path]::GetFullPath((Join-Path $root '.env.stripe-sandbox.local'))
if ($target -ne $allowed) { throw 'Stripe sandbox credentials may be written only to the ignored .env.stripe-sandbox.local file.' }
if (-not (Get-Command stripe -ErrorAction SilentlyContinue)) { throw 'Stripe CLI is required.' }
$profileArguments = @('--project-name', $Profile)
if ($ConfigPath) {
  if (-not [IO.Path]::IsPathFullyQualified($ConfigPath)) { throw 'ConfigPath must be an absolute path.' }
  $canonicalConfig = [IO.Path]::GetFullPath($ConfigPath)
  if (-not (Test-Path -LiteralPath $canonicalConfig -PathType Leaf)) { throw 'ConfigPath must identify an existing Stripe CLI config file.' }
  $profileArguments += @('--config', $canonicalConfig)
}

$config = @(& stripe config --list @profileArguments 2>$null)
if ($LASTEXITCODE -ne 0) { throw 'Stripe CLI profile lookup failed.' }
function Config-Value([string]$Name) {
  $line = $config | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))=" } | Select-Object -First 1
  if (-not $line) { return '' }
  return (($line -split '=', 2)[1]).Trim().Trim('"').Trim("'")
}
$secretKey = Config-Value 'test_mode_api_key'
$publishableKey = Config-Value 'test_mode_pub_key'
$webhookSecret = (& stripe listen @profileArguments --print-secret 2>$null | Select-Object -Last 1).Trim()
if ($LASTEXITCODE -ne 0 -or $secretKey -notmatch '^rkcs_[A-Za-z0-9_]+$' -or $publishableKey -notmatch '^pk_test_[A-Za-z0-9_]+$' -or $webhookSecret -notmatch '^whsec_[A-Za-z0-9_]+$') { throw 'Stripe claimable-sandbox profile is incomplete or has an unexpected credential class.' }

$content = @(
  'PAYMENTS_PROVIDER="stripe"'
  'STRIPE_CLAIMABLE_SANDBOX="true"'
  "STRIPE_SECRET_KEY=`"$secretKey`""
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=`"$publishableKey`""
  "STRIPE_WEBHOOK_SECRET=`"$webhookSecret`""
) -join [Environment]::NewLine
$temporary = "$target.tmp"
[IO.File]::WriteAllText($temporary, $content + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporary -Destination $target -Force
Write-Output 'Ignored Stripe claimable-sandbox environment file created without printing credential values.'
