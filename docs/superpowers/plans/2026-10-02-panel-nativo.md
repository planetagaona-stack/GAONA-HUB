# Plan de implementación del panel nativo

**Objetivo:** mantener el HUD inferior con Codex dueño de su terminal.

**Arquitectura:** launcher con stdio heredado, monitor de título Windows de sólo
lectura y panel independiente comunicado por canal local. Node.js, Windows
Terminal y renderizador de métricas existente.

- [ ] Probar y construir argumentos del panel sin shell ni interpolación de prompts.
- [ ] Implementar lector Windows del título y probarlo contra ConPTY real.
- [ ] Implementar transporte de snapshots y ciclo de vida del panel.
- [ ] Convertir el arranque normal a nativo; dejar --integrated explícito.
- [ ] Probar fallback, identidad exacta, aislamiento de entrada y cierre.
- [ ] Actualizar ayuda y documentación, ejecutar suite y smoke pertinentes.
- [ ] Revisión de código, commit y PR. Merge/despliegue sujetos a aprobación.

## Hallazgos ya reproducidos

El renderer 0.6.1 descarta OSC8; corregido y probado en esta rama. Eliminar los
atajos del emulador rompe su historial, por lo que esa propuesta fue retirada.
El instalador ejecutaba configure-terminal sin opt-in; corregido en esta rama.
El diseño aprobado evita estas interferencias en el camino normal de arranque.
