# Changelog

All notable changes to this project are documented in this file.

## [1.2.0] - 2026-02-18

### Added (1.2.0)

- New `Flutter Runner: Run Web in Tab` command and toolbar/status button when a Web device is selected.

### Changed (1.2.0)

- `Flutter Runner: Run` keeps default behavior and remains the button used for re-run (hot restart) when a run is active.
- Web tab execution now uses an explicit secondary run action instead of extension settings.
- `Run Web in Tab` now opens with native `Simple Browser` in split (`Beside`) mode, preserving the URL bar and avoiding duplicated existing tabs.

### Versioning (1.2.0)

- Bumped extension version to `1.2.0` in `package.json` and `package-lock.json`.

## [1.1.1] - 2026-02-18

### Changed (1.1.1)

- Monorepo behavior improved: when an `apps/` folder exists, the extension now selects the first app inside `apps/` as the default Flutter project.
- Default `main.dart` entrypoint now resolves against that default app (`apps/<first-app>/lib/main.dart`) for run behavior.

### Versioning (1.1.1)

- Bumped extension version to `1.1.1` in `package.json` and `package-lock.json`.

## [1.1.0] - 2026-02-18

### Added (1.1.0)

- New extension icon: Flutter bird with superhero cape and transparent background.
- Release package generated as `flutter-runner-extension-1.1.0.vsix`.

### Changed (1.1.0)

- Improved Flutter workspace detection to support Flutter app/package setups, including Flutter Web and custom package structures.
- Updated user-facing copy to clarify Flutter app/package detection behavior.

### Versioning (1.1.0)

- Bumped extension version to `1.1.0` in `package.json` and `package-lock.json`.
