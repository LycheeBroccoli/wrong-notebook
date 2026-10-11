param(
    [Parameter(Mandatory = $true)][string]$Snapshot,
    [string]$SevenZip = 'C:\Program Files\7-Zip\7z.exe'
)
$ErrorActionPreference = 'Stop'
$snapshotPath = (Resolve-Path -LiteralPath $Snapshot).Path
if (-not (Test-Path -LiteralPath $SevenZip -PathType Leaf)) { throw '7-Zip is required.' }
$backupScript = Join-Path $PSScriptRoot 'backup_data.py'
& python $backupScript verify $snapshotPath
if ($LASTEXITCODE -ne 0) { throw 'Snapshot verification failed.' }
$archivePath = $snapshotPath + '.7z'
if (Test-Path -LiteralPath $archivePath) { throw 'Archive already exists; refusing to overwrite.' }
Write-Host 'Enter the backup password at the 7-Zip prompt. It is not passed as a command argument.'
& $SevenZip a '-t7z' '-mhe=on' '-p' $archivePath (Join-Path $snapshotPath '*')
if ($LASTEXITCODE -ne 0) { throw 'Encryption failed; do not upload the resulting file.' }
Write-Host 'Enter the same password again to verify the encrypted archive.'
& $SevenZip t '-p' $archivePath
if ($LASTEXITCODE -ne 0) { throw 'Archive verification failed; do not upload.' }
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($archivePath + '.sha256', $hash + '  ' + [IO.Path]::GetFileName($archivePath) + [Environment]::NewLine)
Write-Host ('Verified encrypted archive: ' + $archivePath)
Write-Host 'Upload only the .7z archive and its .sha256 file to your personal cloud drive.'

