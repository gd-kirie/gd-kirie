import { existsSync, readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { normalizeGradleModuleName, readExportPresetValue } from "@gd-kirie/build";
import { execa } from "execa";

import {
  assertConfiguredTarget,
  loadKirieConfig,
  type ResolvedKirieConfig,
  resolveSingleOrExplicitTarget,
} from "./config.ts";
import { resolveExportOutputPath } from "./export.ts";

export interface KirieDevLaunchOptions {
  "kirie-dev": "1";
  "kirie-web-url": string;
}

export type LaunchOptions = KirieDevLaunchOptions | Record<string, string>;

export function createKirieDevLaunchOptions(webUrl: string): KirieDevLaunchOptions {
  return {
    "kirie-dev": "1",
    "kirie-web-url": webUrl,
  };
}

export interface RunAndroidOptions {
  apkPath?: string;
  attachLogcat?: boolean;
  clearData?: boolean;
  clearLogcat?: boolean;
  config?: ResolvedKirieConfig;
  cwd?: string;
  device?: string;
  forceStop?: boolean;
  launchOptions?: LaunchOptions;
  packageName?: string;
  preset?: string;
  skipInstall?: boolean;
}

export interface RunDesktopOptions {
  config?: ResolvedKirieConfig;
  cwd?: string;
  godotArgs?: string[];
  godotCommand?: string;
}

export interface RunIosSimulatorOptions {
  appArgs?: string[];
  appPath?: string;
  bundleId?: string;
  config?: ResolvedKirieConfig;
  cwd?: string;
  launchOptions?: LaunchOptions;
  simulatorId?: string;
  terminateExisting?: boolean;
}

export interface RunIosDeviceOptions {
  appArgs?: string[];
  appPath?: string;
  bundleId?: string;
  config?: ResolvedKirieConfig;
  cwd?: string;
  device?: string;
  launchOptions?: LaunchOptions;
  terminateExisting?: boolean;
}

export type RunIosOptions = RunIosSimulatorOptions & RunIosDeviceOptions;

export interface RunAutoOptions {
  appArgs?: string[];
  appPath?: string;
  attachLogcat?: boolean;
  clearData?: boolean;
  clearLogcat?: boolean;
  cwd?: string;
  device?: string;
  forceStop?: boolean;
  godotArgs?: string[];
  godotCommand?: string;
  launchOptions?: LaunchOptions;
  skipInstall?: boolean;
  terminateExisting?: boolean;
}

const androidDeviceWaitTimeoutMs = 10_000;
const simulatorLookupTimeoutMs = 30_000;

export async function runAutoTarget(options: RunAutoOptions = {}): Promise<void> {
  const config = await loadKirieConfig({
    command: "build",
    cwd: options.cwd,
  });
  const target = resolveSingleOrExplicitTarget(config, undefined, "run", [
    "desktop",
    "ios",
    "android",
  ]);

  if (target === "desktop") {
    await runDesktop({
      config,
      cwd: options.cwd,
      godotArgs: options.godotArgs,
      godotCommand: options.godotCommand,
    });
    return;
  }

  if (target === "android") {
    await runAndroid({
      attachLogcat: options.attachLogcat,
      clearData: options.clearData,
      clearLogcat: options.clearLogcat,
      config,
      cwd: options.cwd,
      device: options.device,
      forceStop: options.forceStop,
      launchOptions: options.launchOptions,
      skipInstall: options.skipInstall,
    });
    return;
  }

  await runIos({
    appArgs: options.appArgs,
    appPath: options.appPath,
    config,
    cwd: options.cwd,
    device: options.device,
    launchOptions: options.launchOptions,
    terminateExisting: options.terminateExisting,
  });
}

export async function runDesktop(options: RunDesktopOptions = {}): Promise<void> {
  const config =
    options.config ??
    (await loadKirieConfig({
      command: "build",
      cwd: options.cwd,
    }));
  assertConfiguredTarget(config, "desktop", "kirie run");

  await execa(
    options.godotCommand ?? config.godot.command,
    [
      ...config.godot.args,
      "--path",
      config.godot.project,
      ...(options.godotArgs ?? []),
    ],
    {
      cwd: config.godot.project,
      stdio: "inherit",
    },
  );
}

export async function runAndroid(options: RunAndroidOptions = {}): Promise<void> {
  const config =
    options.config ??
    (await loadKirieConfig({
      command: "build",
      cwd: options.cwd,
    }));
  const androidTarget = assertConfiguredTarget(config, "android", "kirie run");
  if (androidTarget.host === "native" && !androidTarget.project) {
    throw new Error(
      "kirie run android requires targets.android.project when host is \"native\" " +
      "(or run kirie export android to build the embed artifact).",
    );
  }

  const adbArgs = options.device
    ? ["-s", options.device]
    : [];
  const preset = options.preset ?? androidTarget.preset ?? "Android";
  const apkPath = options.apkPath
    ? path.resolve(config.cwd, options.apkPath)
    : resolveExportOutputPath({
        configCwd: config.cwd,
        mode: "debug",
        platform: "android",
        preset,
      });

  let packageName: string | undefined = options.packageName;
  let activityComponent: string | undefined;

  if (androidTarget.host === "godot") {
    packageName ??= readAndroidPackageName(config.godot.project, preset);
    activityComponent = `${packageName}/com.godot.game.GodotAppLauncher`;
  } else {
    const apkMeta = await inspectApkLaunchMetadata(apkPath, config.cwd);
    packageName ??=
      apkMeta.packageName ??
      (androidTarget.project
        ? readGradleApplicationId(
            path.resolve(config.cwd, androidTarget.project),
            androidTarget.module,
          )
        : undefined);
    activityComponent = apkMeta.activityComponent;
  }

  await execa("adb", [...adbArgs, "wait-for-device"], {
    cwd: config.cwd,
    stdio: "inherit",
    timeout: androidDeviceWaitTimeoutMs,
  });

  if (!options.skipInstall) {
    await execa(
      "adb",
      [
        ...adbArgs,
        "install",
        "-r",
        apkPath,
      ],
      {
        cwd: config.cwd,
        stdio: "inherit",
      },
    );
  }

  if (!packageName) {
    throw new Error(
      `Unable to determine Android package name from ${apkPath}. ` +
      "Ensure Android SDK build-tools (aapt2 / apkanalyzer) is installed or declare applicationId in Gradle.",
    );
  }

  if (!activityComponent) {
    activityComponent = await resolveInstalledAndroidLauncherActivity({
      adbArgs,
      cwd: config.cwd,
      packageName,
    });
  }

  if (options.clearLogcat) {
    await execa("adb", [...adbArgs, "logcat", "-c"], {
      cwd: config.cwd,
      stdio: "inherit",
    });
  }

  if (options.forceStop) {
    await execa("adb", [
      ...adbArgs,
      "shell",
      "am",
      "force-stop",
      packageName,
    ], {
      cwd: config.cwd,
      reject: false,
      stderr: "ignore",
      stdout: "ignore",
    });
  }

  if (options.clearData) {
    await execa("adb", [
      ...adbArgs,
      "shell",
      "pm",
      "clear",
      packageName,
    ], {
      cwd: config.cwd,
      stderr: "inherit",
      stdout: "ignore",
    });
  }

  await execa(
    "adb",
    [
      ...adbArgs,
      "shell",
      "am",
      "start",
      "-n",
      activityComponent,
      ...androidLaunchOptionArgs(options.launchOptions),
    ],
    {
      cwd: config.cwd,
      stderr: "inherit",
      stdout: "ignore",
    },
  );

  if (options.attachLogcat === false) {
    return;
  }

  const pid = await waitForAndroidPackagePid({
    adbArgs,
    cwd: config.cwd,
    packageName,
  });
  await attachAndroidLogcat({
    adbArgs,
    cwd: config.cwd,
    packageName,
    pid,
  });
}

export async function runIosSimulator(options: RunIosSimulatorOptions = {}): Promise<void> {
  const config =
    options.config ??
    (await loadKirieConfig({
      command: "build",
      cwd: options.cwd,
    }));
  const iosTarget = assertConfiguredTarget(config, "ios", "kirie run");
  if (iosTarget.host === "native" && !iosTarget.project && !options.appPath) {
    throw new Error(
      "kirie run ios requires targets.ios.project when host is \"native\" " +
      "(or run kirie export ios to build the embed artifact).",
    );
  }

  const simulatorId = options.simulatorId ?? process.env.SIMULATOR_ID ?? "booted";
  const defaultNativeAppPath = path.resolve(config.cwd, "dist", "kirie", "ios", "debug.app");
  const effectiveAppPath =
    options.appPath ??
    (iosTarget.host === "native" && existsSync(defaultNativeAppPath)
      ? defaultNativeAppPath
      : undefined);

  const bundleId =
    options.bundleId ??
    (effectiveAppPath
      ? await readIosAppBundleId(path.resolve(config.cwd, effectiveAppPath))
      : iosTarget.host === "godot"
        ? readIosBundleId(config.godot.project, iosTarget.preset)
        : undefined);

  if (!bundleId) {
    throw new Error(
      "Unable to resolve iOS CFBundleIdentifier for native host app. " +
      "Run kirie export ios first or pass --app <path-to-app.app>.",
    );
  }

  await execa("xcrun", [
    "simctl",
    "bootstatus",
    simulatorId,
    "-b",
  ], {
    cwd: config.cwd,
    stdio: "inherit",
  });

  if (effectiveAppPath) {
    await execa(
      "xcrun",
      [
        "simctl",
        "install",
        simulatorId,
        path.resolve(config.cwd, effectiveAppPath),
      ],
      {
        cwd: config.cwd,
        stdio: "inherit",
      },
    );
  }

  const { stdout: containerPath } = await execa(
    "xcrun",
    [
      "simctl",
      "get_app_container",
      simulatorId,
      bundleId,
      "data",
    ],
    { cwd: config.cwd },
  );
  const logPath = path.join(containerPath, "tmp", "kirie.log");
  await using log = await fs.open(logPath, "w+");
  const launchArgs = [
    "simctl",
    "launch",
    "--console",
    ...(options.terminateExisting
      ? ["--terminate-running-process"]
      : []),
    simulatorId,
    bundleId,
    "--log-file",
    logPath,
    ...iosLaunchOptionArgs(options.launchOptions),
    ...(options.appArgs ?? []),
  ];
  const launch = execa("xcrun", launchArgs, {
    cwd: config.cwd,
    reject: false,
    stdio: "inherit",
  });
  let exited = false;
  const completion = launch.then((result) => {
    exited = true;
    return result;
  });

  try {
    while (true) {
      // Drain once more after exit, including output written during the last read.
      const exitedBeforeRead = exited;
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await log.read(buffer);
      if (bytesRead > 0) {
        process.stdout.write(buffer.subarray(0, bytesRead));
        continue;
      }

      if (exitedBeforeRead) {
        break;
      }

      await delay(50);
    }
  } finally {
    launch.kill("SIGTERM");
    await completion;
  }

  const result = await completion;
  if (result.failed) {
    throw result;
  }
}

export async function runIos(options: RunIosOptions = {}): Promise<void> {
  if (!options.device || (await isIosSimulatorDevice(options.device, options.cwd))) {
    return runIosSimulator({
      appArgs: options.appArgs,
      appPath: options.appPath,
      bundleId: options.bundleId,
      config: options.config,
      cwd: options.cwd,
      launchOptions: options.launchOptions,
      simulatorId: options.device,
      terminateExisting: options.terminateExisting,
    });
  }

  return runIosDevice(options);
}

export async function runIosDevice(options: RunIosDeviceOptions = {}): Promise<void> {
  const config =
    options.config ??
    (await loadKirieConfig({
      command: "build",
      cwd: options.cwd,
    }));
  const iosTarget = assertConfiguredTarget(config, "ios", "kirie run");
  if (iosTarget.host === "native" && !iosTarget.project && !options.appPath) {
    throw new Error(
      "kirie run ios requires targets.ios.project when host is \"native\" " +
      "(or run kirie export ios to build the embed artifact).",
    );
  }

  const device = options.device ?? process.env.IOS_DEVICE_ID;
  if (!device) {
    throw new Error("iOS physical-device runs require --device <UDID>.");
  }

  const defaultNativeAppPath = path.resolve(
    config.cwd,
    "dist",
    "kirie",
    "ios",
    "device_debug.app",
  );
  const effectiveAppPath =
    options.appPath ??
    (iosTarget.host === "native" && existsSync(defaultNativeAppPath)
      ? defaultNativeAppPath
      : undefined);

  const bundleId =
    options.bundleId ??
    (effectiveAppPath
      ? await readIosAppBundleId(path.resolve(config.cwd, effectiveAppPath))
      : iosTarget.host === "godot"
        ? readIosBundleId(config.godot.project, iosTarget.preset)
        : undefined);

  if (!bundleId) {
    throw new Error(
      "Unable to resolve iOS CFBundleIdentifier for native host app. " +
      "Run kirie export ios --device <UDID> first or pass --app <path-to-app.app>.",
    );
  }

  if (effectiveAppPath) {
    await execa(
      "xcrun",
      [
        "devicectl",
        "device",
        "install",
        "app",
        "--device",
        device,
        path.resolve(config.cwd, effectiveAppPath),
      ],
      {
        cwd: config.cwd,
        stdio: "inherit",
      },
    );
  }

  const launchArgs = [
    "devicectl",
    "device",
    "process",
    "launch",
    "--device",
    device,
  ];
  if (options.terminateExisting) {
    launchArgs.push("--terminate-existing");
  }
  launchArgs.push(
    "--console",
    bundleId,
    ...iosLaunchOptionArgs(options.launchOptions),
    ...(options.appArgs ?? []),
  );

  await execa("xcrun", launchArgs, {
    cwd: config.cwd,
    stdio: "inherit",
  });
}

export async function isIosSimulatorDevice(device: string, cwd?: string): Promise<boolean> {
  if (device === "booted") {
    return true;
  }

  const result = await execa("xcrun", ["simctl", "list", "devices", "--json"], {
    cwd,
    timeout: simulatorLookupTimeoutMs,
  });
  const devices = JSON.parse(result.stdout) as {
    devices?: Record<string, Array<{ udid?: string }>>;
  };
  return Object.values(devices.devices ?? {}).some((runtimeDevices) =>
    runtimeDevices.some((simulator) => simulator.udid === device),
  );
}

function readAndroidPackageName(projectDir: string, preset = "Android"): string {
  const packageName = readExportPresetValue({
    optionName: "package/unique_name",
    presetName: preset,
    projectDir,
  });

  if (typeof packageName === "string") {
    return packageName;
  }

  throw new Error("Android export preset option package/unique_name must be a string.");
}

function readIosBundleId(projectDir: string, preset = "iOS"): string {
  const bundleId = readExportPresetValue({
    optionName: "application/bundle_identifier",
    presetName: preset,
    projectDir,
  });

  if (typeof bundleId === "string") {
    return bundleId;
  }

  throw new Error("iOS export preset option application/bundle_identifier must be a string.");
}

function androidLaunchOptionArgs(launchOptions: LaunchOptions | undefined): string[] {
  if (!launchOptions) {
    return [];
  }

  return Object.entries(launchOptions).flatMap(([key, value]) => ["--es", key, value]);
}

async function inspectApkLaunchMetadata(
  apkPath: string,
  cwd: string,
): Promise<{ activityComponent?: string; packageName?: string }> {
  if (!existsSync(apkPath)) {
    return {};
  }

  const aapt2Candidates = findAndroidSdkBinaryCandidates("aapt2", "build-tools");
  for (const aapt2 of aapt2Candidates) {
    const result = await execa(aapt2, ["dump", "badging", apkPath], {
      cwd,
      reject: false,
      stderr: "ignore",
    });
    if (result.exitCode === 0 && result.stdout) {
      const parsed = parseAaptBadgingOutput(result.stdout);
      if (parsed.packageName) {
        return parsed;
      }
    }
  }

  const apkanalyzerCandidates = findAndroidSdkBinaryCandidates("apkanalyzer", "cmdline-tools");
  for (const apkanalyzer of apkanalyzerCandidates) {
    const appIdResult = await execa(
      apkanalyzer,
      ["manifest", "application-id", apkPath],
      { cwd, reject: false, stderr: "ignore" },
    );
    const packageName = appIdResult.exitCode === 0
      ? appIdResult.stdout.trim()
      : "";
    if (!packageName) {
      continue;
    }

    const manifestResult = await execa(
      apkanalyzer,
      ["manifest", "print", apkPath],
      { cwd, reject: false, stderr: "ignore" },
    );
    const launcherActivity = manifestResult.exitCode === 0
      ? parseManifestLauncherActivity(manifestResult.stdout, packageName)
      : undefined;
    return {
      activityComponent: launcherActivity,
      packageName,
    };
  }

  return {};
}

function findAndroidSdkBinaryCandidates(
  toolBaseName: string,
  sdkSubdir: "build-tools" | "cmdline-tools",
): string[] {
  const ext = process.platform === "win32"
    ? toolBaseName === "apkanalyzer"
      ? ".bat"
      : ".exe"
    : "";
  const binaryName = `${toolBaseName}${ext}`;
  const candidates: string[] = [];
  const sdkRoot = process.env.ANDROID_HOME?.trim() || process.env.ANDROID_SDK_ROOT?.trim();

  if (sdkRoot) {
    const parent = path.join(sdkRoot, sdkSubdir);
    if (existsSync(parent)) {
      const subdirs = readdirSync(parent, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
      for (const subdir of subdirs) {
        const candidate = sdkSubdir === "cmdline-tools"
          ? path.join(parent, subdir, "bin", binaryName)
          : path.join(parent, subdir, binaryName);
        if (existsSync(candidate)) {
          candidates.push(candidate);
        }
      }
    }
  }

  candidates.push(binaryName);
  return candidates;
}

export function parseAaptBadgingOutput(output: string): {
  activityComponent?: string;
  packageName?: string;
} {
  const pkgMatch = output.match(/package:\s+name='([^']+)'/);
  const packageName = pkgMatch?.[1];
  const actMatch = output.match(/launchable-activity:\s+name='([^']+)'/);
  const activityName = actMatch?.[1];
  if (!packageName) {
    return {};
  }
  if (!activityName) {
    return { packageName };
  }

  const normalizedActivity = activityName.startsWith(".")
    ? `${packageName}${activityName}`
    : activityName.includes(".")
      ? activityName
      : `${packageName}.${activityName}`;
  return {
    activityComponent: `${packageName}/${normalizedActivity}`,
    packageName,
  };
}

function parseManifestLauncherActivity(
  manifestXml: string,
  packageName: string,
): string | undefined {
  const activityBlocks = manifestXml.match(/<activity\b[\s\S]*?<\/activity>/g) ?? [];
  for (const block of activityBlocks) {
    if (
      !block.includes("android.intent.action.MAIN") ||
      !block.includes("android.intent.category.LAUNCHER")
    ) {
      continue;
    }

    const nameMatch = block.match(/android:name="([^"]+)"/);
    const rawName = nameMatch?.[1];
    if (!rawName) {
      continue;
    }

    const normalized = rawName.startsWith(".")
      ? `${packageName}${rawName}`
      : rawName.includes(".")
        ? rawName
        : `${packageName}.${rawName}`;
    return `${packageName}/${normalized}`;
  }

  return undefined;
}

function readGradleApplicationId(projectRoot: string, moduleName?: string): string | undefined {
  const normalizedModule = normalizeGradleModuleName(moduleName);
  const moduleRelativePath = normalizedModule.replace(/^:+/, "").replaceAll(":", path.sep);
  const moduleDir = path.join(projectRoot, moduleRelativePath);

  for (const fileName of ["build.gradle.kts", "build.gradle"]) {
    const filePath = path.join(moduleDir, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, "utf8");
    const match = content.match(/\bapplicationId(?:\s*=\s*|\s+)["']([^"']+)["']/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

async function resolveInstalledAndroidLauncherActivity(options: {
  adbArgs: string[];
  cwd: string;
  packageName: string;
}): Promise<string> {
  const result = await execa(
    "adb",
    [
      ...options.adbArgs,
      "shell",
      "cmd",
      "package",
      "resolve-activity",
      "--brief",
      "-c",
      "android.intent.category.LAUNCHER",
      options.packageName,
    ],
    {
      cwd: options.cwd,
      reject: false,
      stderr: "ignore",
    },
  );

  if (result.exitCode === 0 && result.stdout) {
    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const component = lines.findLast((line) => line.includes("/") && !line.startsWith("priority="));
    if (component) {
      return component;
    }
  }

  throw new Error(
    `Unable to resolve Android launcher Activity for package "${options.packageName}".`,
  );
}

async function attachAndroidLogcat(options: {
  adbArgs: string[];
  cwd: string;
  packageName: string;
  pid: string;
}): Promise<void> {
  const args = [
    ...options.adbArgs,
    "logcat",
    "-v",
    "time",
    `--pid=${options.pid}`,
  ];
  const logcat = execa("adb", args, {
    cwd: options.cwd,
    reject: false,
    stderr: "inherit",
    stdout: "pipe",
  });

  if (!logcat.stdout) {
    throw new Error("adb logcat did not expose stdout");
  }

  logcat.stdout.on("data", (chunk: Buffer | string) => {
    process.stdout.write(chunk);
  });

  let cleanupPromise: Promise<void> | undefined;
  let interruptedSignal: NodeJS.Signals | undefined;
  const cleanupAndroidRun = (signal: NodeJS.Signals): Promise<void> => {
    interruptedSignal = signal;
    logcat.kill("SIGTERM");

    cleanupPromise ??= execa(
      "adb",
      [
        ...options.adbArgs,
        "shell",
        "am",
        "force-stop",
        options.packageName,
      ],
      {
        cwd: options.cwd,
        reject: false,
        stderr: "inherit",
        stdout: "ignore",
      },
    ).then(() => {});

    return cleanupPromise;
  };
  const handleInterrupt = (signal: NodeJS.Signals): void => {
    cleanupAndroidRun(signal).then(() => {
      process.exitCode = signal === "SIGINT"
        ? 130
        : 143;
    });
  };

  process.once("SIGINT", handleInterrupt);
  process.once("SIGTERM", handleInterrupt);

  const result = await logcat;
  process.off("SIGINT", handleInterrupt);
  process.off("SIGTERM", handleInterrupt);

  if (cleanupPromise) {
    await cleanupPromise;
  }
  if (interruptedSignal) {
    process.exitCode = interruptedSignal === "SIGINT"
      ? 130
      : 143;
    return;
  }

  if (result.failed && result.signal !== "SIGTERM" && result.exitCode !== 143) {
    throw new Error(
      result.signal
        ? `adb logcat exited with signal ${result.signal}`
        : `adb logcat exited with code ${result.exitCode ?? "unknown"}`,
    );
  }
}

async function waitForAndroidPackagePid(options: {
  adbArgs: string[];
  cwd: string;
  packageName: string;
  timeoutMs?: number;
}): Promise<string> {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);

  while (Date.now() < deadline) {
    const result = await execa("adb", [
      ...options.adbArgs,
      "shell",
      "pidof",
      options.packageName,
    ], {
      cwd: options.cwd,
      reject: false,
      stderr: "ignore",
    });
    const pid = result.stdout.trim().split(/\s+/).find(Boolean);

    if (pid) {
      return pid;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`Timed out waiting for Android package PID: ${options.packageName}`);
}

function iosLaunchOptionArgs(launchOptions: LaunchOptions | undefined): string[] {
  if (!launchOptions) {
    return [];
  }

  return Object.entries(launchOptions).map(
    ([key, value]) => `--${key.replaceAll("_", "-")}=${value}`,
  );
}

export async function readIosAppBundleId(appPath: string): Promise<string> {
  const plistPath = path.join(appPath, "Info.plist");
  if (existsSync(plistPath)) {
    const raw = await fs.readFile(plistPath);
    if (!raw.subarray(0, 6).equals(Buffer.from("bplist"))) {
      const xml = raw.toString("utf8");
      const match = xml.match(
        /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/,
      );
      const parsedId = match?.[1]?.trim();
      if (parsedId) {
        return parsedId;
      }
    }
  }

  const result = await execa("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    plistPath,
  ]);

  return result.stdout.trim();
}
