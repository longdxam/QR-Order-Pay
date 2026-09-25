param(
  [Parameter(Mandatory = $true)][string]$MongoUri,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_-]+$')][string]$SourceDatabase,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
function Get-ClusterIdentityHash([string]$Uri) {
  $match = [regex]::Match($Uri, '^mongodb(?:\+srv)?://(?:[^@/]+@)?(?<hosts>[^/?]+)')
  if (-not $match.Success) { throw 'MongoUri is not a valid MongoDB connection string.' }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($match.Groups['hosts'].Value.ToLowerInvariant())
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $digest = $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
  return ([System.BitConverter]::ToString($digest)).Replace('-', '').ToLowerInvariant()
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$archive = Join-Path $resolvedOutput "maycafe-$stamp.archive.gz"
& mongodump --uri=$MongoUri --archive=$archive --gzip --oplog
if ($LASTEXITCODE -ne 0) { throw "mongodump failed with exit code $LASTEXITCODE" }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
$manifest = [ordered]@{ createdAtUtc = (Get-Date).ToUniversalTime().ToString('o'); archive = [System.IO.Path]::GetFileName($archive); sourceDatabase = $SourceDatabase; sourceClusterIdentitySha256 = (Get-ClusterIdentityHash $MongoUri); consistency = 'replica-set-oplog'; sha256 = $hash; sizeBytes = (Get-Item -LiteralPath $archive).Length }
$manifest | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath "$archive.manifest.json"
Write-Output $archive
