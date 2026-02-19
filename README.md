# Flutter Runner

`Flutter Runner` is a Visual Studio Code/Cursor extension that streamlines running Flutter applications with reusable run profiles, quick toolbar actions, and integrated workflow support for hot reload, hot restart, and DevTools access.

## Key Capabilities

- Detects Flutter app/package workspaces (including Flutter Web/custom package setups) from `pubspec.yaml`.
- Adds contextual editor toolbar actions for:
  - Run
  - Stop
  - Hot Reload
  - Open DevTools
  - Select Profile
- Supports configurable run profiles with:
  - `name` (required)
  - `dartEntrypoint` (defaults to `lib/main.dart`)
  - `flavor` (optional)
- Provides profile management in one place (create, select, edit, delete).
- Streams `flutter run` logs to the `Flutter Runner` output channel.
- Supports manual hot reload and one-click hot restart when a run is already active.
- Supports automatic hot reload on Dart file save (configurable).
- Opens Flutter DevTools inside the editor when a DevTools URL is detected.

## Commands

- `Flutter Runner: Run`
- `Flutter Runner: Stop Run`
- `Flutter Runner: Select Run Profile`
- `Flutter Runner: Hot Reload`
- `Flutter Runner: Open DevTools`

## Configuration

Configure the extension in your workspace `settings.json`:

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
  ],
  "flutterRunner.hotReloadOnSave": true
}
```

### Run Behavior

When `Flutter Runner: Run` is executed:

- The extension always passes `-t <dartEntrypoint>`.
- If `flavor` is set, it also passes `--flavor <flavor>`.
- If no entrypoint is configured, `lib/main.dart` is used.

If a Flutter run is already active, the same Run action triggers **hot restart**.

## How to Use

1. Open a Flutter workspace.
2. Ensure a Flutter device is selected (via Flutter/Dart device selector).
3. Open the profile selector (`Flutter Runner: Select Run Profile`) and choose or create a profile.
4. Start the app using `Flutter Runner: Run` or the Run toolbar button.
5. Use the toolbar commands during execution:
   - `Stop` to terminate the process
   - `Hot Reload` to apply code changes quickly
   - `Run` (while active) to trigger hot restart
   - `Open DevTools` to inspect runtime performance and state

## Requirements

- Flutter SDK installed and available in your `PATH`.
- A valid Flutter project in the current workspace.
- A selected target device.

## Local Development

```bash
npm install
npm run build
```

Press `F5` to launch an Extension Development Host.

## Troubleshooting

- **No Run button is shown**: verify the workspace is a Flutter project.
- **Run is unavailable**: select a Flutter device first.
- **DevTools does not open**: wait until `flutter run` logs print the DevTools URL.
