# Sólo lee el título de la consola compartida con el proceso observado.
# El canal se antepone por console-title.js; el PID llega después del arranque.
$ErrorActionPreference = 'Stop'
$channel = [IO.Pipes.NamedPipeClientStream]::new('.', $titlePipe, [IO.Pipes.PipeDirection]::InOut)
$channel.Connect(5000)
$writer = [IO.StreamWriter]::new($channel, [Text.UTF8Encoding]::new($false))
$writer.AutoFlush = $true
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class GaonaConsoleTitle {
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool AttachConsole(uint processId);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool FreeConsole();
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern uint GetConsoleTitle(StringBuilder title, uint size);
}
'@
[GaonaConsoleTitle]::FreeConsole() | Out-Null
$writer.WriteLine('{"ready":true}')
$reader = [IO.StreamReader]::new($channel, [Text.Encoding]::UTF8)
$request = $reader.ReadLine() | ConvertFrom-Json
$targetProcess = [uint32]$request.pid
if ($targetProcess -lt 1) { throw 'PID de Codex inválido.' }
$deadline = [DateTime]::UtcNow.AddSeconds(5)
while (-not [GaonaConsoleTitle]::AttachConsole($targetProcess)) {
    if ([DateTime]::UtcNow -ge $deadline) { throw 'No se pudo observar el título de Codex.' }
    Start-Sleep -Milliseconds 50
}
try {
    $lastTitle = $null
    while (Get-Process -Id $targetProcess -ErrorAction SilentlyContinue) {
        $buffer = [Text.StringBuilder]::new(2048)
        [GaonaConsoleTitle]::GetConsoleTitle($buffer, 2048) | Out-Null
        $title = $buffer.ToString()
        if ($title -ne $lastTitle) {
            $writer.WriteLine((ConvertTo-Json -InputObject @{ title = $title } -Compress))
            $writer.Flush()
            $lastTitle = $title
        }
        Start-Sleep -Milliseconds 400
    }
} finally {
    [GaonaConsoleTitle]::FreeConsole() | Out-Null
    $writer.Dispose()
    $reader.Dispose()
    $channel.Dispose()
}
