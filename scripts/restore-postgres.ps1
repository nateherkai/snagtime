[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$PgRestorePath,
  [Parameter(Mandatory)][string]$PsqlPath,
  [Parameter(Mandatory)][string]$TargetDatabaseUrlSecret,
  [Parameter(Mandatory)][string]$EncryptionKeySecret,
  [Parameter(Mandatory)][string]$EncryptedTempDirectory,
  [Parameter(Mandatory)][string]$BackupPath,
  [Parameter(Mandatory)][string]$ExpectedSha256,
  [Parameter(Mandatory)][switch]$ConfirmIsolatedEmptyTarget,
  [switch]$AllowInsecureLocalTest
)
$ErrorActionPreference = 'Stop'; if (-not $ConfirmIsolatedEmptyTarget) { throw 'Restore requires explicit isolated-target confirmation.' }
foreach ($path in @($PgRestorePath,$PsqlPath,$TargetDatabaseUrlSecret,$EncryptionKeySecret,$EncryptedTempDirectory,$BackupPath)) { if (-not [IO.Path]::IsPathFullyQualified($path)) { throw 'All restore paths must be absolute.' } }
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $BackupPath).Hash; if ($actual -ne $ExpectedSha256.ToUpperInvariant()) { throw 'Backup digest mismatch.' }
$key = [Convert]::FromBase64String((Get-Content -Raw -LiteralPath $EncryptionKeySecret).Trim()); if ($key.Length -ne 32) { throw 'Restore key must be 32 bytes.' }
$all = [IO.File]::ReadAllBytes($BackupPath); $header = [Text.Encoding]::ASCII.GetString($all,0,19); if ($header -ne 'TCOVE-PG18-AESGCM-1') { throw 'Backup format mismatch.' }
$nonce=$all[19..30]; $tag=$all[31..46]; $cipher=$all[47..($all.Length-1)]; $plain=New-Object byte[] $cipher.Length
$aes=[Security.Cryptography.AesGcm]::new($key,16); try { $aes.Decrypt($nonce,$cipher,$tag,$plain,[Text.Encoding]::UTF8.GetBytes('TempoCove-PG18-Backup-v1')) } finally { $aes.Dispose() }
$tempRoot=(Resolve-Path -LiteralPath $EncryptedTempDirectory).Path; $temp=Join-Path $tempRoot ("restore-"+[Guid]::NewGuid().ToString('N')+'.dump'); [IO.File]::WriteAllBytes($temp,$plain)
$databaseUrl=(Get-Content -Raw -LiteralPath $TargetDatabaseUrlSecret).Trim(); if($databaseUrl -notmatch '^postgres(ql)?://'){throw 'PostgreSQL target URL required.'}; $uri=[Uri]$databaseUrl; $credentials=$uri.UserInfo.Split(':',2)
$env:PGHOST=$uri.Host; $env:PGPORT=if($uri.Port -gt 0){[string]$uri.Port}else{'5432'}; $env:PGDATABASE=$uri.AbsolutePath.TrimStart('/'); $env:PGUSER=[Uri]::UnescapeDataString($credentials[0]); $env:PGPASSWORD=if($credentials.Count -gt 1){[Uri]::UnescapeDataString($credentials[1])}else{''}
$query=@{}; foreach($part in $uri.Query.TrimStart('?').Split('&',[StringSplitOptions]::RemoveEmptyEntries)){ $pair=$part.Split('=',2); $query[[Uri]::UnescapeDataString($pair[0])] = if($pair.Count -gt 1){[Uri]::UnescapeDataString($pair[1])}else{''} }
if($query.sslmode -eq 'verify-full') { $env:PGSSLMODE='verify-full'; if(-not $query.sslrootcert -or -not [IO.Path]::IsPathFullyQualified($query.sslrootcert) -or -not (Test-Path -LiteralPath $query.sslrootcert -PathType Leaf)){throw 'verify-full requires an existing absolute sslrootcert.'}; $env:PGSSLROOTCERT=(Resolve-Path -LiteralPath $query.sslrootcert).Path; foreach($item in @(@('sslcert','PGSSLCERT'),@('sslkey','PGSSLKEY'))){if($query[$item[0]]){if(-not [IO.Path]::IsPathFullyQualified($query[$item[0]]) -or -not (Test-Path -LiteralPath $query[$item[0]] -PathType Leaf)){throw "$($item[0]) must be an existing absolute path."};Set-Item -Path "Env:$($item[1])" -Value (Resolve-Path -LiteralPath $query[$item[0]]).Path}} }
elseif($AllowInsecureLocalTest -and $query.sslmode -eq 'disable' -and $uri.Host -in @('127.0.0.1','localhost')) { $env:PGSSLMODE='disable' } else { throw 'Restore requires sslmode=verify-full; only explicit loopback tests may disable TLS.' }
try {
  & (Resolve-Path -LiteralPath $PgRestorePath) --exit-on-error --no-owner --no-acl --dbname=$env:PGDATABASE $temp; if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed.' }
  $verification = (& (Resolve-Path -LiteralPath $PsqlPath) --no-psqlrc --quiet --tuples-only --set ON_ERROR_STOP=1 --file (Join-Path $PSScriptRoot 'postgres-restore-verify.sql') | Out-String).Trim(); if ($LASTEXITCODE -ne 0) { throw 'Restore verification failed.' }
  [pscustomobject]@{ restoredAt=[DateTime]::UtcNow.ToString('o'); backupSha256=$actual; verificationSha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($verification))); verified=$true } | ConvertTo-Json -Compress
} finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue; foreach($name in 'PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','PGSSLCERT','PGSSLKEY'){Remove-Item "Env:$name" -ErrorAction SilentlyContinue} }
