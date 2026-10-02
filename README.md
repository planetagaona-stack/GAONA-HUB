# GAONA-HUB · byGaona

[Descargar la última versión publicada para Windows](https://github.com/planetagaona-stack/GAONA-HUB/releases/latest/download/GAONA-HUB-windows.zip) · [Licencia MIT](LICENSE)

**Versión del código: 0.7.0.** La descarga publicada puede ser anterior a esta rama.

Codex oficial arriba y un HUD de métricas en un panel inferior independiente.
El chat conserva su terminal: el HUB no recibe sus teclas, no captura su mouse
y no vuelve a dibujar sus mensajes.

Referencia visual del HUD, con datos de ejemplo:

![Diseño de las métricas de GAONA-HUB](docs/preview.svg)

## Modo nativo

El launcher abre una **ventana nueva de Windows Terminal**, con los dos paneles
creados juntos. Cada ejecución usa un nombre único; no divide otra conversación
si cambias de ventana mientras arranca. El foco inicial queda en Codex.

- Codex hereda directamente la entrada, salida y errores de su panel.
- Ctrl+clic, selección, pegado, rueda y atajos quedan a cargo de Codex y Windows
  Terminal, como al ejecutar el CLI oficial.
- El HUD sólo escribe en su panel inferior. Cerrarlo no termina Codex.
- Al terminar Codex, el HUD se desconecta y termina. El cierre visual del panel
  respeta la configuración existente de Windows Terminal.
- Si Windows Terminal no está disponible, se inicia Codex nativo sin HUD.

El emulador anterior queda únicamente con `--integrated`. Ese modo tiene límites
de historial y mouse; no ofrece el aislamiento del modo normal.

## Instalar

Requiere Windows Terminal, Node.js 20+ y Codex CLI instalado con tu cuenta.
Desde un paquete de esta versión:

```powershell
npm.cmd install -g .\gaona-hub-0.7.0.tgz
gaona-hub.cmd
```

O utiliza el instalador del ZIP:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

El instalador normal instala el paquete. Las modificaciones adicionales requieren
opciones explícitas:

| Opción | Efecto solicitado |
| --- | --- |
| `-IntegrateCodex` | Agrega una función `codex` a perfiles PowerShell, con respaldo. |
| `-AddToUserPath` | Agrega el prefijo npm al PATH persistente si falta. |
| `-ConfigureTerminal` | Crea el perfil visual opcional de Windows Terminal. |
| `-GlowCurrentPowerShell` | Aplica el efecto gráfico a perfiles PowerShell. |

Sin esas opciones, no se escriben perfiles, PATH persistente ni `settings.json`.
La ejecución normal tampoco los modifica. `ExecutionPolicy Bypass` sólo se
aplica al proceso del instalador. No requiere administrador con un prefijo npm
propiedad del usuario.

## Usar

```text
gaona-hub.cmd                          Codex nativo + panel inferior
gaona-hub.cmd -- resume <id>            Reanudar una conversación
gaona-hub.cmd -- resume --last          Reanudar la última conversación
gaona-hub.cmd --project <ruta>          Elegir el directorio inicial
gaona-hub.cmd --title "Mi tarea"        Etiqueta de la ventana nueva
gaona-hub.cmd --plain                   Codex directo, sin HUD
gaona-hub.cmd --integrated              Emulador anterior, compatibilidad
gaona-hub.cmd watch                     Monitor separado manual
gaona-hub.cmd status --json             Métricas locales
gaona-hub.cmd doctor                    Diagnóstico local
```

Los argumentos posteriores a `--` llegan literalmente a Codex. El directorio,
argumentos y entorno viajan al nuevo proceso por un canal local; no se guardan
en archivos temporales ni se imprimen en logs. Las opciones `--ascii`,
`--no-color` y `--color` afectan el HUD. Codex conserva su propia configuración.
No se modifica el ejecutable oficial ni sus permisos.

## Identidad y métricas

El launcher solicita temporalmente un título de Codex con identificador, modelo,
razonamiento y estado. Un auxiliar Windows lo lee mediante `GetConsoleTitle`;
no captura la entrada ni el texto del chat. El título visible queda separado
de esos metadatos.

El identificador se resuelve contra archivos locales de la sesión. Los títulos
truncados sólo se aceptan cuando hay una coincidencia única. **Nunca se elige otra
conversación por ser la más reciente.** El HUD muestra espera cuando falta la
identidad o las métricas. Un chat nuevo sin mensajes puede no haber creado su
archivo de métricas todavía. Mientras tanto, el título permite mostrar modelo,
razonamiento y estado; al comenzar otro chat se descartan las métricas anteriores.

Contexto, cuota, modelo, estado, proyecto y actividad se muestran según los datos
disponibles. El modo pasivo no inspecciona los comandos que escribes ni detecta
visualmente el inicio de una compactación. Esas señales no se inventan; la
animación basada en la pantalla sólo existe en `--integrated`.

El HUD no requiere una clave API ni envía conversaciones a un servicio. Lee
archivos locales. El chequeo de actualizaciones consulta GitHub Releases.

## Actualizaciones

```text
gaona-hub.cmd update --check
gaona-hub.cmd update
```

Se comprueban nuevas versiones estables como máximo una vez al día, verificando
SHA-256. `--no-update` omite el chequeo; `GAONA_HUB_AUTO_UPDATE=0` lo desactiva.
Los checkouts y comandos no interactivos no se actualizan automáticamente.
Las sesiones abiertas conservan la versión que cargaron.

## Verificar y probar el checkout

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run pack:check
node scripts/verify-console-title.js
node scripts/verify-native-controls.js
node scripts/verify-passive-terminal.js
node scripts/preview-native.js
```

Las pruebas cubren identidad, transporte local, argumentos literales y stdio
heredado. ConPTY comprueba enlaces OSC8 e inicio, teclado, redimensionado y cierre
de Codex sin enviar prompts. La prueba del emulador anterior está en
`scripts/verify-terminal.js`.

`preview-native.js` abre una ventana real del checkout sin instalarlo globalmente.
Ctrl+clic, selección y rueda se comprueban físicamente en esa ventana; un test de
metadatos de enlace no equivale a un clic.

## Licencia

Proyecto independiente de la comunidad, sin afiliación con OpenAI. Licencia MIT.
Atribuciones en [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt). El modo de dos
paneles está orientado a Windows Terminal. Otros sistemas conservan Codex directo;
el emulador anterior sigue disponible explícitamente.
