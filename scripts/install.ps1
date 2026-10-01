[CmdletBinding()]
param([switch]$Uninstall, [switch]$IntegrateCodex, [switch]$GlowCurrentPowerShell)
$ErrorActionPreference = 'Stop'
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) { throw 'Instala Node.js 20+ desde https://nodejs.org y abre de nuevo PowerShell.' }
$documents = [Environment]::GetFolderPath('MyDocuments')
$profiles = @((Join-Path $documents 'PowerShell\profile.ps1'), (Join-Path $documents 'WindowsPowerShell\profile.ps1'))
$blockPattern = '(?ms)^# BEGIN (?:CODEX HUB|GAONA HUB)\r?\n.*?^# END (?:CODEX HUB|GAONA HUB)\r?\n?'
function Remove-HubProfile {
    foreach ($file in $profiles) {
        if (Test-Path -LiteralPath $file) {
            $content = [IO.File]::ReadAllText($file)
            $clean = [regex]::Replace($content, $blockPattern, '')
            if ($clean -ne $content) {
                Copy-Item -LiteralPath $file -Destination "$file.codex-hub-backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
                [IO.File]::WriteAllText($file, $clean, [Text.UTF8Encoding]::new($false))
            }
        }
    }
}
if ($Uninstall) {
    Remove-HubProfile
    $prefix = (& $npmCommand.Source prefix -g).Trim()
    $terminalScript = Join-Path $prefix 'node_modules\gaona-hub\scripts\configure-terminal.ps1'
    if (Test-Path -LiteralPath $terminalScript) { & $terminalScript -Uninstall }
    & $npmCommand.Source uninstall -g gaona-hub
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo desinstalar Gaona-HUB.' }
    return
}
$bundleRoot = Split-Path -Parent $PSScriptRoot
$package = Get-ChildItem -LiteralPath $bundleRoot -Filter 'gaona-hub-*.tgz' | Select-Object -First 1
$source = if ($package) { $package.FullName } else { $bundleRoot }
$prefix = (& $npmCommand.Source prefix -g).Trim()
$installedRoot = Join-Path $prefix 'node_modules\gaona-hub'
$updatedInPlace = $false
if ($package -and (Test-Path -LiteralPath (Join-Path $installedRoot 'package.json'))) {
    # Unchanged native dependencies can remain loaded while only our JS/assets
    # are upgraded. npm otherwise tries to replace Windows-locked ConPTY DLLs.
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('gaona-hub-update-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporary | Out-Null
    try {
        & tar.exe -xf $package.FullName -C $temporary
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo extraer el paquete.' }
        $payload = Join-Path $temporary 'package'
        $metadata = Get-Content -LiteralPath (Join-Path $payload 'package.json') -Raw | ConvertFrom-Json
        $matching = $true
        foreach ($dependency in $metadata.dependencies.PSObject.Properties) {
            $dependencyFile = Join-Path $installedRoot ("node_modules\" + $dependency.Name + '\package.json')
            if (-not (Test-Path -LiteralPath $dependencyFile)) { $matching = $false; break }
            $actual = Get-Content -LiteralPath $dependencyFile -Raw | ConvertFrom-Json
            if ($actual.version -ne $dependency.Value) { $matching = $false; break }
        }
        if ($matching) {
            Get-ChildItem -LiteralPath $payload | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $installedRoot -Recurse -Force }
            $updatedInPlace = $true
            Write-Host 'Gaona-HUB actualizado conservando las dependencias nativas en uso.'
        }
    } finally {
        $resolvedTemporary = [IO.Path]::GetFullPath($temporary)
        $expectedTemporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\gaona-hub-update-'
        if (-not $resolvedTemporary.StartsWith($expectedTemporaryRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Ruta temporal inesperada.' }
        Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force
    }
}
if (-not $updatedInPlace) {
    & $npmCommand.Source install -g $source
    if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación de Gaona-HUB.' }
}
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $prefix) { [Environment]::SetEnvironmentVariable('Path', "$prefix;$userPath", 'User') }
$env:Path = "$prefix;$env:Path"
if ($IntegrateCodex) {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $cli = Join-Path $prefix 'node_modules\gaona-hub\bin\codex-hub.js'
    $nodeLiteral = $node.Replace("'", "''")
    $cliLiteral = $cli.Replace("'", "''")
    $block = "# BEGIN GAONA HUB`nfunction global:codex {`n    & '$nodeLiteral' '$cliLiteral' run -- @args`n}`n# END GAONA HUB`n"
    foreach ($file in $profiles) {
        $content = if (Test-Path -LiteralPath $file) { [IO.File]::ReadAllText($file) } else { '' }
        if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination "$file.codex-hub-backup-$(Get-Date -Format 'yyyyMMddHHmmss')" }
        New-Item -ItemType Directory -Path (Split-Path -Parent $file) -Force | Out-Null
        $content = [regex]::Replace($content, $blockPattern, '')
        [IO.File]::WriteAllText($file, $content.TrimEnd() + "`n" + $block, [Text.UTF8Encoding]::new($false))
    }
    Write-Host 'Codex integrado en PowerShell: abre una terminal nueva o carga tu perfil.' -ForegroundColor Cyan
}
& (Join-Path $prefix 'gaona-hub.cmd') doctor
& (Join-Path $prefix 'node_modules\gaona-hub\scripts\configure-terminal.ps1') -CurrentPowerShell:$GlowCurrentPowerShell
Write-Host "`nListo. Iniciar: gaona-hub.cmd. Reanudar: gaona-hub.cmd -- resume <id>" -ForegroundColor Cyan
