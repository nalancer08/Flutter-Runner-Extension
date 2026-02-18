# Flutter Runner Extension

Extension para VS Code/Cursor enfocada en ejecutar Flutter con perfiles simples.

## Caracteristicas

- Detecta si el workspace es un proyecto Flutter (`pubspec.yaml` con `flutter:`).
- Boton `Run` en la barra superior del editor.
- Perfiles de ejecucion configurables con:
  - `dartEntrypoint` (por defecto siempre `lib/main.dart`)
  - `flavor` (opcional)
- Un solo boton de perfil para seleccionar, crear, editar y eliminar perfiles.
- Crear/editar perfil en un formulario unico (todos los campos a la vez).
- Logs de `flutter run` en el `OutputChannel`.
- Soporte de hot reload:
  - Manual con comando `Flutter Runner: Hot Reload`
  - Automatico al guardar archivos `.dart` (configurable)
- Si ya hay una app corriendo, `Run` vuelve a ejecutar como **hot restart** (rapido, toma cambios recientes).
- `Stop` se mantiene como accion separada.
- Boton/comando `Open DevTools` para abrir los DevTools en una pestana interna (sin navegador externo) cuando `flutter run` publica la URL.

## Comandos

- `Flutter Runner: Run`
- `Flutter Runner: Stop Run`
- `Flutter Runner: Select Run Profile`
- `Flutter Runner: Hot Reload`
- `Flutter Runner: Open DevTools`

## Configuracion

Configura en `settings.json`:

```json
{
  "flutterRunner.activeProfile": "dev",
  "flutterRunner.profiles": [
    {
      "name": "dev",
      "dartEntrypoint": "lib/main_dev.dart",
      "flavor": "dev"
    },
    {
      "name": "prod",
      "dartEntrypoint": "lib/main_prod.dart",
      "flavor": "prod"
    }
  ]
}
```

Comportamiento de `run`:

- Siempre usa `-t <dartEntrypoint>`.
- Si el perfil tiene `flavor`, agrega `--flavor <flavor>`.
- Si el perfil no define entrypoint, usa `lib/main.dart`.

Hot reload al guardar:

```json
{
  "flutterRunner.hotReloadOnSave": true
}
```

## Desarrollo local

```bash
npm install
npm run build
```

Presiona `F5` para abrir una Extension Development Host.
