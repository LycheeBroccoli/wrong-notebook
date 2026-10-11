$ErrorActionPreference = 'Stop'
$repoPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$commonDir = (& git -C $repoPath rev-parse --path-format=absolute --git-common-dir).Trim()
if ($LASTEXITCODE -ne 0 -or -not [IO.Path]::IsPathRooted($commonDir)) { throw 'Cannot locate Git metadata.' }
$hookDir = Join-Path $commonDir 'private-hooks'
New-Item -ItemType Directory -Path $hookDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'git-hooks\pre-push') -Destination (Join-Path $hookDir 'pre-push') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'check_push_history.py') -Destination (Join-Path $hookDir 'check_push_history.py') -Force
& git -C $repoPath config core.hooksPath ($hookDir.Replace('\', '/'))
if ($LASTEXITCODE -ne 0) { throw 'Failed to configure history guard.' }
Write-Host 'Private history guard installed in Git metadata; it remains active when switching branches.'
