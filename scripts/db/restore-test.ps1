param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$TargetUri,
  [Parameter(Mandatory = $true)][ValidateSet('yes')][string]$ConfirmIsolatedDeployment
)
$ErrorActionPreference = 'Stop'
function Get-ClusterIdentityHash([string]$Uri) {
  $match = [regex]::Match($Uri, '^mongodb(?:\+srv)?://(?:[^@/]+@)?(?<hosts>[^/?]+)')
  if (-not $match.Success) { throw 'TargetUri is not a valid MongoDB connection string.' }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($match.Groups['hosts'].Value.ToLowerInvariant())
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $digest = $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
  return ([System.BitConverter]::ToString($digest)).Replace('-', '').ToLowerInvariant()
}
$resolvedArchive = [System.IO.Path]::GetFullPath($Archive)
if (-not (Test-Path -LiteralPath $resolvedArchive -PathType Leaf)) { throw 'Archive does not exist.' }
$manifestPath = "$resolvedArchive.manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Backup manifest is missing.' }
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.sourceDatabase -notmatch '^[A-Za-z0-9_-]+$') { throw 'Backup manifest has no valid source database.' }
$sourceDatabase = [string]$manifest.sourceDatabase
if ($manifest.consistency -ne 'replica-set-oplog') { throw 'Backup is not marked as a point-in-time oplog archive.' }
if (-not $manifest.sourceClusterIdentitySha256) { throw 'Backup manifest has no source cluster identity.' }
if ((Get-ClusterIdentityHash $TargetUri) -eq $manifest.sourceClusterIdentitySha256) { throw 'Safety guard: restore target is the source cluster.' }
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedArchive).Hash.ToLowerInvariant()
if ($actualHash -ne $manifest.sha256) { throw 'Backup checksum mismatch.' }
& mongorestore --uri=$TargetUri --archive=$resolvedArchive --gzip --drop --oplogReplay
if ($LASTEXITCODE -ne 0) { throw "mongorestore failed with exit code $LASTEXITCODE" }
$verification = @'
const dbRef = db.getSiblingDB('$sourceDatabase');
const duplicateBills = dbRef.bills.aggregate([{ $group: { _id: '$tableSessionId', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
const orphanPayments = dbRef.payments.aggregate([{ $lookup: { from: 'tablesessions', localField: 'tableSessionId', foreignField: '_id', as: 'session' } }, { $match: { session: { $size: 0 } } }]).toArray();
const requiredIndexes = [
  ['tablesessions', 'one_active_session_per_table'],
  ['orders', 'tableSessionId_1_idempotencyKey_1'],
  ['payments', 'idempotencyKey_1'],
  ['bills', 'tableSessionId_1'],
  ['outboxevents', 'eventId_1']
];
const missingIndexes = requiredIndexes.filter(([collection, name]) => !dbRef.getCollection(collection).getIndexes().some(index => index.name === name)).map(([collection, name]) => `${collection}.${name}`);
const result = { collections: dbRef.getCollectionNames().length, orders: dbRef.orders.countDocuments(), payments: dbRef.payments.countDocuments(), bills: dbRef.bills.countDocuments(), duplicateBills: duplicateBills.length, orphanPayments: orphanPayments.length, missingIndexes };
print(JSON.stringify(result));
if (duplicateBills.length || orphanPayments.length || missingIndexes.length) quit(2);
'@
& mongosh $TargetUri --quiet --eval $verification
if ($LASTEXITCODE -ne 0) { throw "Restore invariant verification failed with exit code $LASTEXITCODE" }
