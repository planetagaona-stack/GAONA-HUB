# Safe package-manager cleanup after legacy terminal processes release ConPTY.
$ErrorActionPreference = 'Stop'
$legacy = @(Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'node_modules[\\/]+codex-hub-terminal[\\/]' })
foreach ($entry in $legacy) {
    $running = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
    if ($running) { $running.WaitForExit() }
}
$npm = Join-Path (Split-Path -Parent (Get-Command node.exe).Source) 'npm.cmd'
& $npm uninstall -g codex-hub-terminal
if ($LASTEXITCODE -ne 0) { throw 'No se pudo desinstalar el paquete anterior.' }
