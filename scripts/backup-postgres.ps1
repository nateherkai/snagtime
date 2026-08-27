[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$PgDumpPath,
  [Parameter(Mandatory)][string]$DatabaseUrlSecret,
  [Parameter(Mandatory)][string]$EncryptionKeySecret,
  [Parameter(Mandatory)][string]$EncryptedTempDirectory,
  [Parameter(Mandatory)][string]$OutputDirectory,
  [switch]$AllowInsecureLocalTest
)
$ErrorActionPreference = 'Stop'
foreach ($path in @($PgDumpPath,$DatabaseUrlSecret,$EncryptionKeySecret,$EncryptedTempDirectory,$OutputDirectory)) { if (-not [IO.Path]::IsPathFullyQualified($path)) { throw 'All backup paths must be absolute.' } }
$dump = (Resolve-Path -LiteralPath $PgDumpPath).Path; $tempRoot = (Resolve-Path -LiteralPath $EncryptedTempDirectory).Path; $outputRoot = (Resolve-Path -LiteralPath $OutputDirectory).Path
if ($tempRoot -eq $outputRoot) { throw 'Encrypted temporary and retained backup directories must be distinct.' }
$keyText = (Get-Content -Raw -LiteralPath (Resolve-Path -LiteralPath $EncryptionKeySecret)).Trim(); $key = [Convert]::FromBase64String($keyText); if ($key.Length -ne 32) { throw 'Backup key must be exactly 32 bytes encoded as base64.' }
$databaseUrl=(Get-Content -Raw -LiteralPath (Resolve-Path -LiteralPath $DatabaseUrlSecret)).Trim(); if ($databaseUrl -notmatch '^postgres(ql)?://') { throw 'PostgreSQL URL required.' }; $uri=[Uri]$databaseUrl; $credentials=$uri.UserInfo.Split(':',2)
$env:PGHOST=$uri.Host; $env:PGPORT=if($uri.Port -gt 0){[string]$uri.Port}else{'5432'}; $env:PGDATABASE=$uri.AbsolutePath.TrimStart('/'); $env:PGUSER=[Uri]::UnescapeDataString($credentials[0]); $env:PGPASSWORD=if($credentials.Count -gt 1){[Uri]::UnescapeDataString($credentials[1])}else{''}
$query=@{}; foreach($part in $uri.Query.TrimStart('?').Split('&',[StringSplitOptions]::RemoveEmptyEntries)){ $pair=$part.Split('=',2); $query[[Uri]::UnescapeDataString($pair[0])] = if($pair.Count -gt 1){[Uri]::UnescapeDataString($pair[1])}else{''} }
if($query.sslmode -eq 'verify-full') { $env:PGSSLMODE='verify-full'; if(-not $query.sslrootcert -or -not [IO.Path]::IsPathFullyQualified($query.sslrootcert) -or -not (Test-Path -LiteralPath $query.sslrootcert -PathType Leaf)){throw 'verify-full requires an existing absolute sslrootcert.'}; $env:PGSSLROOTCERT=(Resolve-Path -LiteralPath $query.sslrootcert).Path; foreach($item in @(@('sslcert','PGSSLCERT'),@('sslkey','PGSSLKEY'))){if($query[$item[0]]){if(-not [IO.Path]::IsPathFullyQualified($query[$item[0]]) -or -not (Test-Path -LiteralPath $query[$item[0]] -PathType Leaf)){throw "$($item[0]) must be an existing absolute path."};Set-Item -Path "Env:$($item[1])" -Value (Resolve-Path -LiteralPath $query[$item[0]]).Path}} }
elseif($AllowInsecureLocalTest -and $query.sslmode -eq 'disable' -and $uri.Host -in @('127.0.0.1','localhost')) { $env:PGSSLMODE='disable' } else { throw 'Backup requires sslmode=verify-full; only explicit loopback tests may disable TLS.' }
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'); $plain = Join-Path $tempRoot "tempocove-$stamp.dump"; $target = Join-Path $outputRoot "tempocove-$stamp.dump.aesgcm"
try {
  & $dump --format=custom --no-owner --no-acl --file=$plain; if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }
  $bytes = [IO.File]::ReadAllBytes($plain); if ($bytes.Length -gt 1073741824) { throw 'Backup exceeds the bounded 1 GiB encryption contract.' }
  $nonce = [Security.Cryptography.RandomNumberGenerator]::GetBytes(12); $tag = New-Object byte[] 16; $cipher = New-Object byte[] $bytes.Length
  $aes = [Security.Cryptography.AesGcm]::new($key,16); try { $aes.Encrypt($nonce,$bytes,$cipher,$tag,[Text.Encoding]::UTF8.GetBytes('TempoCove-PG18-Backup-v1')) } finally { $aes.Dispose() }
  $header = [Text.Encoding]::ASCII.GetBytes('TCOVE-PG18-AESGCM-1'); [IO.File]::WriteAllBytes($target, $header + $nonce + $tag + $cipher)
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash; [pscustomobject]@{ path=$target; sha256=$hash; createdAt=$stamp; encrypted=$true } | ConvertTo-Json -Compress
} finally { Remove-Item -LiteralPath $plain -Force -ErrorAction SilentlyContinue; foreach($name in 'PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','PGSSLCERT','PGSSLKEY'){Remove-Item "Env:$name" -ErrorAction SilentlyContinue} }
