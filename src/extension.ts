import * as vscode from "vscode";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

type RunProfile = {
  name: string;
  dartEntrypoint?: string;
  flavor?: string;
  [key: string]: unknown;
};

const FLUTTER_CONTEXT_KEY = "flutterRunner.isFlutterProject";
const HAS_SELECTED_DEVICE_CONTEXT_KEY = "flutterRunner.hasSelectedDevice";
const IS_RUNNING_CONTEXT_KEY = "flutterRunner.isRunning";

let output: vscode.OutputChannel;
let runProcess: ChildProcessWithoutNullStreams | undefined;
let runButton: vscode.StatusBarItem;
let stopButton: vscode.StatusBarItem;
let profileButton: vscode.StatusBarItem;
let selectedDeviceId: string | undefined;
let extensionCtx: vscode.ExtensionContext;
let hotReloadDebounceTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  extensionCtx = context;
  output = vscode.window.createOutputChannel("Flutter Runner");

  runButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 200);
  runButton.command = "flutterRunner.run";
  runButton.text = "$(play)";
  runButton.tooltip = "Run Flutter app with active profile";

  stopButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 199);
  stopButton.command = "flutterRunner.stopRun";
  stopButton.text = "$(debug-stop)";
  stopButton.tooltip = "Stop current Flutter run";

  profileButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 198);
  profileButton.command = "flutterRunner.selectProfile";

  context.subscriptions.push(
    output,
    runButton,
    stopButton,
    profileButton,
    vscode.commands.registerCommand("flutterRunner.run", () => runFlutter(context)),
    vscode.commands.registerCommand("flutterRunner.stopRun", () => stopRun(context)),
    vscode.commands.registerCommand("flutterRunner.hotReload", () => triggerHotReload("manual")),
    vscode.commands.registerCommand("flutterRunner.selectProfile", () => selectProfile(context)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("flutterRunner.activeProfile") ||
        event.affectsConfiguration("flutterRunner.profiles") ||
        event.affectsConfiguration("dart.flutterDeviceId")
      ) {
        void updateStatusBar(context);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void updateStatusBar(context);
    }),
    vscode.window.onDidChangeWindowState(() => {
      void updateStatusBar(context);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      void handleDocumentSaved(doc);
    }),
    new vscode.Disposable(() => {
      clearInterval(deviceRefreshInterval);
      if (hotReloadDebounceTimer) {
        clearTimeout(hotReloadDebounceTimer);
      }
    })
  );

  const deviceRefreshInterval = setInterval(() => {
    void updateStatusBar(context);
  }, 4000);

  void updateStatusBar(context);
}

export function deactivate(): void {
  void stopRun();
}

async function runFlutter(context: vscode.ExtensionContext): Promise<void> {
  if (runProcess) {
    await triggerHotRestart("manual");
    return;
  }

  const folder = getWorkspaceFolderPath();
  if (!folder) {
    void vscode.window.showErrorMessage("Open a workspace folder first.");
    return;
  }

  const flutterProject = await isFlutterProject(folder);
  if (!flutterProject) {
    void vscode.window.showErrorMessage(
      "This is not a Flutter project. Expected a pubspec.yaml with Flutter dependency."
    );
    return;
  }

  const profile = getActiveProfile() ?? getProfiles()[0];
  if (!profile) {
    void vscode.window.showErrorMessage(
      "No Flutter Runner profiles configured. Add at least one profile in settings."
    );
    return;
  }

  const deviceId = await resolveSelectedDeviceId();
  if (!deviceId) {
    runButton.text = "$(circle-slash)";
    runButton.command = undefined;
    runButton.tooltip = "Select a Flutter device in the toolbar first";
    await vscode.commands.executeCommand("setContext", HAS_SELECTED_DEVICE_CONTEXT_KEY, false);
    const selection = await vscode.window.showWarningMessage(
      "No Flutter device selected. Select one from the Flutter/Dart device toolbar first.",
      "Open Flutter: Select Device"
    );
    if (selection === "Open Flutter: Select Device") {
      await vscode.commands.executeCommand("flutter.selectDevice");
    }
    return;
  }

  const entrypoint = (profile.dartEntrypoint || "").trim() || "lib/main.dart";
  const flavor = (profile.flavor || "").trim();
  const args = ["run"];

  args.push("-t", entrypoint);
  args.push("-d", deviceId);
  if (flavor.length > 0) {
    args.push("--flavor", flavor);
  }

  output.show(true);
  output.appendLine("");
  output.appendLine("=== Flutter Runner ===");
  output.appendLine(`Profile: ${profile.name}`);
  output.appendLine(`Device: ${deviceId}`);
  output.appendLine(`Entrypoint: ${entrypoint}`);
  output.appendLine(`Flavor: ${flavor || "none"}`);
  output.appendLine(`Command: flutter ${args.join(" ")}`);
  output.appendLine("");

  runProcess = spawn("flutter", args, {
    cwd: folder,
    shell: false
  });

  await setRunningState(context, true);
  await updateStatusBar(context);

  runProcess.stdout.on("data", (chunk: Buffer) => output.append(chunk.toString()));
  runProcess.stderr.on("data", (chunk: Buffer) => output.append(chunk.toString()));

  runProcess.on("error", (error) => {
    output.appendLine(`\n[error] ${error.message}`);
    void stopRun(context);
    void vscode.window.showErrorMessage(
      "Could not start Flutter. Make sure `flutter` is installed and in PATH."
    );
  });

  runProcess.on("close", (code) => {
    output.appendLine(`\n[exit] flutter run finished with code ${code ?? "unknown"}`);
    void stopRun(context);
  });
}

async function stopRun(context: vscode.ExtensionContext = extensionCtx): Promise<void> {
  if (runProcess) {
    runProcess.kill("SIGTERM");
    runProcess = undefined;
  }

  await setRunningState(context, false);
  await updateStatusBar(context);
}

async function selectProfile(context: vscode.ExtensionContext): Promise<void> {
  const profiles = getProfiles();
  if (!profiles.length) {
    const created = await showProfileForm(context, undefined);
    if (!created) {
      return;
    }
    await saveProfiles([created]);
    await setActiveProfile(created.name, context);
    return;
  }

  const activeName = vscode.workspace
    .getConfiguration("flutterRunner")
    .get<string>("activeProfile", "default");

  const selected = await vscode.window.showQuickPick<{
    label: string;
    description?: string;
    action: "select" | "create" | "edit" | "delete";
    profile?: RunProfile;
  }>(
    [
      ...profiles.map((profile) => ({
        label: profile.name,
        description: `${(profile.dartEntrypoint || "").trim() || "lib/main.dart"} | flavor: ${
          (profile.flavor || "").trim() || "none"
        }${profile.name === activeName ? " | active" : ""}`,
        action: "select" as const,
        profile
      })),
      {
        label: "$(add) Add new profile",
        description: "Create a profile with all fields in one form",
        action: "create" as const
      },
      {
        label: "$(edit) Edit profile",
        description: "Edit a profile in a single form",
        action: "edit" as const
      },
      {
        label: "$(trash) Delete profile",
        description: "Remove a profile",
        action: "delete" as const
      }
    ],
    {
      title: "Flutter Runner Profiles",
      matchOnDescription: true,
      placeHolder: "Choose active profile or manage profiles"
    }
  );

  if (!selected) {
    return;
  }

  if (selected.action === "select" && selected.profile) {
    await setActiveProfile(selected.profile.name, context);
    return;
  }

  if (selected.action === "create") {
    const created = await showProfileForm(context, undefined);
    if (!created) {
      return;
    }
    const current = getProfiles();
    if (current.some((item) => item.name === created.name)) {
      void vscode.window.showErrorMessage(`Profile "${created.name}" already exists.`);
      return;
    }
    await saveProfiles([...current, created]);
    await setActiveProfile(created.name, context);
    return;
  }

  if (selected.action === "edit") {
    const target = await pickProfile("Select profile to edit");
    if (!target) {
      return;
    }
    const updated = await showProfileForm(context, target);
    if (!updated) {
      return;
    }
    const profilesAfterEdit = getProfiles().map((item) => {
      if (item.name !== target.name) {
        return item;
      }
      return updated;
    });
    if (
      updated.name !== target.name &&
      profilesAfterEdit.filter((item) => item.name === updated.name).length > 1
    ) {
      void vscode.window.showErrorMessage(`Profile "${updated.name}" already exists.`);
      return;
    }
    await saveProfiles(profilesAfterEdit);
    const active = vscode.workspace
      .getConfiguration("flutterRunner")
      .get<string>("activeProfile", "default");
    if (active === target.name) {
      await setActiveProfile(updated.name, context);
    } else {
      await updateStatusBar(context);
      void vscode.window.showInformationMessage(`Profile "${updated.name}" updated.`);
    }
    return;
  }

  if (selected.action === "delete") {
    const target = await pickProfile("Select profile to delete");
    if (!target) {
      return;
    }
    await deleteProfile(context, target);
  }
}

async function deleteProfile(context: vscode.ExtensionContext, profile: RunProfile): Promise<void> {
  const confirmation = await vscode.window.showWarningMessage(
    `Delete profile "${profile.name}"?`,
    { modal: true },
    "Delete"
  );
  if (confirmation !== "Delete") {
    return;
  }

  const remaining = getProfiles().filter((item) => item.name !== profile.name);
  await saveProfiles(remaining);

  const active = vscode.workspace.getConfiguration("flutterRunner").get<string>("activeProfile", "default");
  if (active === profile.name) {
    const fallback = remaining[0]?.name ?? "default";
    await vscode.workspace
      .getConfiguration()
      .update("flutterRunner.activeProfile", fallback, vscode.ConfigurationTarget.Workspace);
  }

  await updateStatusBar(context);
  void vscode.window.showInformationMessage(`Profile "${profile.name}" deleted.`);
}

async function setActiveProfile(name: string, context: vscode.ExtensionContext): Promise<void> {
  await vscode.workspace
    .getConfiguration()
    .update("flutterRunner.activeProfile", name, vscode.ConfigurationTarget.Workspace);

  await updateStatusBar(context);
  void vscode.window.showInformationMessage(`Active profile: ${name}`);
}

async function saveProfiles(profiles: RunProfile[]): Promise<void> {
  await vscode.workspace
    .getConfiguration()
    .update("flutterRunner.profiles", profiles, vscode.ConfigurationTarget.Workspace);
}

async function updateStatusBar(context: vscode.ExtensionContext): Promise<void> {
  const folder = getWorkspaceFolderPath();
  const flutter = folder ? await isFlutterProject(folder) : false;
  await vscode.commands.executeCommand("setContext", FLUTTER_CONTEXT_KEY, flutter);

  if (!flutter) {
    selectedDeviceId = undefined;
    await vscode.commands.executeCommand("setContext", HAS_SELECTED_DEVICE_CONTEXT_KEY, false);
    runButton.hide();
    stopButton.hide();
    profileButton.hide();
    return;
  }

  runButton.show();
  if (runProcess) {
    stopButton.show();
  } else {
    stopButton.hide();
  }
  profileButton.show();
  selectedDeviceId = await resolveSelectedDeviceId();
  const hasDevice = Boolean(selectedDeviceId);
  await vscode.commands.executeCommand("setContext", HAS_SELECTED_DEVICE_CONTEXT_KEY, hasDevice);
  if (runProcess) {
    runButton.text = "$(debug-restart)";
    runButton.command = "flutterRunner.run";
    runButton.tooltip = "Hot restart running app";
  } else {
    runButton.text = hasDevice ? "$(play)" : "$(circle-slash)";
    runButton.command = hasDevice ? "flutterRunner.run" : undefined;
    runButton.tooltip = hasDevice
      ? `Run Flutter app on ${selectedDeviceId}`
      : "Select a Flutter device in the toolbar first";
  }
  const activeProfile = getActiveProfile();
  const entrypoint = (activeProfile?.dartEntrypoint || "").trim() || "lib/main.dart";
  const flavor = (activeProfile?.flavor || "").trim();

  profileButton.text = `$(symbol-namespace) ${activeProfile?.name ?? "default"}`;
  profileButton.tooltip = `Entrypoint: ${entrypoint}${flavor ? ` | Flavor: ${flavor}` : ""}${
    selectedDeviceId ? ` | Device: ${selectedDeviceId}` : ""
  }`;
}

function getProfiles(): RunProfile[] {
  const config = vscode.workspace.getConfiguration("flutterRunner");
  const profiles = config.get<RunProfile[]>("profiles", []);
  const normalized = profiles
    .filter((profile): profile is RunProfile => Boolean(profile && typeof profile.name === "string"))
    .map((profile) => ({
      ...profile,
      dartEntrypoint: (profile.dartEntrypoint || "").trim() || "lib/main.dart",
      flavor: (profile.flavor || "").trim()
    }));

  if (normalized.length > 0) {
    return normalized;
  }

  return [{ name: "default", dartEntrypoint: "lib/main.dart", flavor: "" }];
}

function getActiveProfile(): RunProfile | undefined {
  const config = vscode.workspace.getConfiguration("flutterRunner");
  const activeName = config.get<string>("activeProfile", "default");
  const profiles = getProfiles();
  return profiles.find((profile) => profile.name === activeName) ?? profiles[0];
}

async function isFlutterProject(folderPath: string): Promise<boolean> {
  const pubspecPath = path.join(folderPath, "pubspec.yaml");
  try {
    const content = await fs.readFile(pubspecPath, "utf8");
    return /\bflutter\s*:/m.test(content);
  } catch {
    return false;
  }
}

function getWorkspaceFolderPath(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

async function execCommand(
  command: string,
  args: string[],
  options?: { showOutput?: boolean; progressTitle?: string; timeoutMs?: number }
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  const runner = async () =>
    new Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>((resolve) => {
      const child = spawn(command, args, { shell: false });
      let stdout = "";
      let stderr = "";
      let done = false;
      const finish = (result: { ok: boolean; stdout: string; stderr: string; code: number | null }) => {
        if (done) {
          return;
        }
        done = true;
        resolve(result);
      };
      const timeoutMs = options?.timeoutMs ?? 0;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              stderr += `\nCommand timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`;
              child.kill("SIGTERM");
              finish({ ok: false, stdout, stderr, code: null });
            }, timeoutMs)
          : undefined;

      const clearTimer = () => {
        if (timer) {
          clearTimeout(timer);
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        if (options?.showOutput) {
          output.append(text);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        if (options?.showOutput) {
          output.append(text);
        }
      });

      child.on("error", (error) => {
        stderr += error.message;
        clearTimer();
        finish({ ok: false, stdout, stderr, code: null });
      });

      child.on("close", (code) => {
        clearTimer();
        finish({ ok: code === 0, stdout, stderr, code });
      });
    });

  if (!options?.progressTitle) {
    return runner();
  }

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: options.progressTitle },
    runner
  );
}

async function resolveSelectedDeviceId(): Promise<string | undefined> {
  try {
    const value = await vscode.commands.executeCommand<unknown>("flutter.getSelectedDeviceId");
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  } catch {
    // Fallbacks below.
  }

  try {
    const value = await vscode.commands.executeCommand<unknown>("dart.getFlutterDeviceId");
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  } catch {
    // Fallbacks below.
  }

  const dartConfig = vscode.workspace.getConfiguration("dart");
  const candidates = [
    dartConfig.get<string>("flutterDeviceId"),
    dartConfig.get<string>("deviceId")
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return undefined;
}

async function setRunningState(context: vscode.ExtensionContext, running: boolean): Promise<void> {
  await vscode.commands.executeCommand("setContext", IS_RUNNING_CONTEXT_KEY, running);
  await context.workspaceState.update(IS_RUNNING_CONTEXT_KEY, running);
}

async function triggerHotReload(trigger: "manual" | "save"): Promise<void> {
  if (!runProcess || runProcess.killed || !runProcess.stdin || runProcess.stdin.destroyed) {
    if (trigger === "manual") {
      void vscode.window.showWarningMessage("No Flutter run is active.");
    }
    return;
  }

  runProcess.stdin.write("r\n");
  output.appendLine(trigger === "manual" ? "[hot-reload] Triggered manually." : "[hot-reload] Triggered on save.");
}

async function triggerHotRestart(trigger: "manual"): Promise<void> {
  if (!runProcess || runProcess.killed || !runProcess.stdin || runProcess.stdin.destroyed) {
    void vscode.window.showWarningMessage("No Flutter run is active.");
    return;
  }

  runProcess.stdin.write("R\n");
  output.appendLine("[hot-restart] Triggered manually.");
  if (trigger === "manual") {
    void vscode.window.setStatusBarMessage("Flutter hot restart triggered", 1500);
  }
}

async function handleDocumentSaved(doc: vscode.TextDocument): Promise<void> {
  if (doc.languageId !== "dart") {
    return;
  }
  if (!runProcess) {
    return;
  }
  if (!isDocumentInWorkspace(doc)) {
    return;
  }

  const autoHotReload = vscode.workspace
    .getConfiguration("flutterRunner")
    .get<boolean>("hotReloadOnSave", true);
  if (!autoHotReload) {
    return;
  }

  if (hotReloadDebounceTimer) {
    clearTimeout(hotReloadDebounceTimer);
  }
  hotReloadDebounceTimer = setTimeout(() => {
    void triggerHotReload("save");
  }, 250);
}

function isDocumentInWorkspace(doc: vscode.TextDocument): boolean {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  return Boolean(folder);
}

async function pickProfile(title: string): Promise<RunProfile | undefined> {
  const profiles = getProfiles();
  if (!profiles.length) {
    void vscode.window.showWarningMessage("No Flutter Runner profiles configured.");
    return undefined;
  }
  const selected = await vscode.window.showQuickPick(
    profiles.map((profile) => ({
      label: profile.name,
      description: `${(profile.dartEntrypoint || "").trim() || "lib/main.dart"} | flavor: ${
        (profile.flavor || "").trim() || "none"
      }`,
      profile
    })),
    { title, matchOnDescription: true }
  );
  return selected?.profile;
}

async function showProfileForm(
  context: vscode.ExtensionContext,
  initialProfile?: RunProfile
): Promise<RunProfile | undefined> {
  const panel = vscode.window.createWebviewPanel(
    "flutterRunnerProfileForm",
    initialProfile ? "Edit Flutter Profile" : "Create Flutter Profile",
    vscode.ViewColumn.Active,
    { enableScripts: true }
  );

  const name = initialProfile?.name ?? "";
  const entrypoint = (initialProfile?.dartEntrypoint || "").trim() || "lib/main.dart";
  const flavor = (initialProfile?.flavor || "").trim();

  panel.webview.html = getProfileFormHtml(panel.webview, {
    name,
    dartEntrypoint: entrypoint,
    flavor
  });

  return new Promise<RunProfile | undefined>((resolve) => {
    let resolved = false;
    const disposeAndResolve = (value: RunProfile | undefined) => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve(value);
      panel.dispose();
    };

    const messageDisposable = panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!message || typeof message !== "object") {
        return;
      }
      const payload = message as {
        type?: string;
        name?: string;
        dartEntrypoint?: string;
        flavor?: string;
      };
      if (payload.type === "cancel") {
        disposeAndResolve(undefined);
        return;
      }
      if (payload.type !== "save") {
        return;
      }

      const normalizedName = (payload.name || "").trim();
      const normalizedEntrypoint = (payload.dartEntrypoint || "").trim() || "lib/main.dart";
      const normalizedFlavor = (payload.flavor || "").trim();

      if (!normalizedName) {
        void vscode.window.showErrorMessage("Profile name is required.");
        return;
      }

      const existingNames = getProfiles().map((item) => item.name);
      const duplicate =
        normalizedName !== initialProfile?.name && existingNames.includes(normalizedName);
      if (duplicate) {
        void vscode.window.showErrorMessage(`Profile "${normalizedName}" already exists.`);
        return;
      }

      disposeAndResolve({
        name: normalizedName,
        dartEntrypoint: normalizedEntrypoint,
        flavor: normalizedFlavor
      });
    });

    const disposeDisposable = panel.onDidDispose(() => {
      if (!resolved) {
        resolved = true;
        resolve(undefined);
      }
      messageDisposable.dispose();
      disposeDisposable.dispose();
    });

    context.subscriptions.push(messageDisposable, disposeDisposable);
  });
}

function getProfileFormHtml(
  webview: vscode.Webview,
  initial: { name: string; dartEntrypoint: string; flavor: string }
): string {
  const escapedName = escapeHtml(initial.name);
  const escapedEntrypoint = escapeHtml(initial.dartEntrypoint);
  const escapedFlavor = escapeHtml(initial.flavor);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline';" />
    <title>Flutter Profile</title>
    <style>
      body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); }
      .field { margin-bottom: 12px; }
      label { display: block; margin-bottom: 6px; font-weight: 600; }
      input { width: 100%; box-sizing: border-box; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); }
      .actions { display: flex; gap: 8px; margin-top: 18px; }
      button { padding: 8px 12px; cursor: pointer; border: 1px solid transparent; }
      .primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
      .secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
      .hint { font-size: 12px; opacity: 0.8; margin-top: 4px; }
    </style>
  </head>
  <body>
    <h2>Flutter Run Profile</h2>
    <div class="field">
      <label for="name">Profile Name</label>
      <input id="name" value="${escapedName}" placeholder="dev" />
    </div>
    <div class="field">
      <label for="entrypoint">Dart Entrypoint</label>
      <input id="entrypoint" value="${escapedEntrypoint}" placeholder="lib/main.dart" />
      <div class="hint">Default: lib/main.dart</div>
    </div>
    <div class="field">
      <label for="flavor">Flavor (optional)</label>
      <input id="flavor" value="${escapedFlavor}" placeholder="dev" />
    </div>
    <div class="actions">
      <button class="primary" id="save">Save Profile</button>
      <button class="secondary" id="cancel">Cancel</button>
    </div>

    <script>
      const vscode = acquireVsCodeApi();
      document.getElementById('save').addEventListener('click', () => {
        vscode.postMessage({
          type: 'save',
          name: document.getElementById('name').value,
          dartEntrypoint: document.getElementById('entrypoint').value,
          flavor: document.getElementById('flavor').value
        });
      });
      document.getElementById('cancel').addEventListener('click', () => {
        vscode.postMessage({ type: 'cancel' });
      });
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
