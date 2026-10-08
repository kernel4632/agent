# 一次性脚本：提交并推送这次改动。用完即删。
$report = 'D:\kernyr\agent\ship.txt'
$lines = @()

$lines += '=== add ==='
$lines += (git add -A 2>&1 | Out-String)
$lines += '=== staged ==='
$lines += (git diff --cached --name-status 2>&1 | Out-String)
$lines += '=== commit ==='
$lines += (git commit -F msg.txt 2>&1 | Out-String)
$lines += '=== push ==='
$lines += (git push 2>&1 | Out-String)
$lines += '=== local ==='
$lines += (Get-Content .git/refs/heads/main | Out-String)
$lines += '=== remote ==='
$lines += (Get-Content .git/refs/remotes/origin/main | Out-String)

[System.IO.File]::WriteAllLines($report, $lines)
