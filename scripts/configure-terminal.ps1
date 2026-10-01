[CmdletBinding()]
param([switch]$CurrentPowerShell, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$settingsPath = Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json'
if (-not (Test-Path -LiteralPath $settingsPath)) { Write-Host 'Windows Terminal no encontrado; Gaona-HUB funciona sin glow.'; return }
$stateDirectory = Join-Path $env:LOCALAPPDATA 'Gaona-HUB'
$statePath = Join-Path $stateDirectory 'terminal-state.json'
$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
$guid = '{4380d8b2-4c68-4e69-bdfd-f9263fe4f8ad}'
if ($Uninstall) {
    $settings.profiles.list = @($settings.profiles.list | Where-Object { $_.guid -ne $guid })
    if (Test-Path -LiteralPath $statePath) {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        foreach ($saved in $state.profiles) {
            $profile = $settings.profiles.list | Where-Object { $_.guid -eq $saved.guid }
            if ($profile) {
                if ($saved.hadShader) { $profile | Add-Member -NotePropertyName 'experimental.pixelShaderPath' -NotePropertyValue $saved.shader -Force }
                else { $profile.PSObject.Properties.Remove('experimental.pixelShaderPath') }
            }
        }
        Remove-Item -LiteralPath $statePath
    }
} else {
    $root = Split-Path -Parent $PSScriptRoot
    $shader = Join-Path $root 'assets\gaona-glow.hlsl'
    if (-not (Test-Path -LiteralPath $shader)) { throw 'No se encuentra el shader Gaona-HUB.' }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $cli = Join-Path $root 'bin\codex-hub.js'
    $profile = [pscustomobject]@{ guid=$guid; name='Gaona-HUB'; hidden=$false; commandline="`"$node`" `"$cli`" --color"; startingDirectory=$env:USERPROFILE; background='#06090c'; 'experimental.pixelShaderPath'=$shader }
    $settings.profiles.list = @($settings.profiles.list | Where-Object { $_.guid -ne $guid }) + @($profile)
    if ($CurrentPowerShell) {
        $savedProfiles = @(if (Test-Path -LiteralPath $statePath) { (Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json).profiles })
        foreach ($entry in $settings.profiles.list) {
            if ($entry.source -eq 'Windows.Terminal.PowershellCore' -or $entry.guid -eq '{61c54bbd-c2c6-5271-96e7-009a87ff44bf}') {
                if (-not ($savedProfiles | Where-Object { $_.guid -eq $entry.guid })) {
                    $savedProfiles += [pscustomobject]@{guid=$entry.guid; hadShader=($null -ne $entry.PSObject.Properties['experimental.pixelShaderPath']); shader=$entry.'experimental.pixelShaderPath'}
                }
                $entry | Add-Member -NotePropertyName 'experimental.pixelShaderPath' -NotePropertyValue $shader -Force
            }
        }
        New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
        [IO.File]::WriteAllText($statePath, (@{profiles=$savedProfiles} | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
    }
}
[IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))
Write-Host 'Gaona-HUB: perfil Windows Terminal y glow configurados.' -ForegroundColor Cyan
