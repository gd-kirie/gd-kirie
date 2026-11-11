import { type CommandContext, type CommandDef, defineCommand, type ParsedArgs } from "citty";

import packageJson from "../../package.json" with { type: "json" };
import { runBuild, runBuildDotnet, runBuildWeb } from "./build.ts";
import { assertConfiguredTarget, loadKirieConfig } from "./config.ts";
import { type DevTarget, runDev } from "./dev.ts";
import { type DoctorTarget, runDoctor } from "./doctor/index.ts";
import { runExport } from "./export.ts";
import { runInit } from "./init.ts";
import { exportIosApp } from "./ios.ts";
import {
  isIosSimulatorDevice,
  runAndroid,
  runAutoTarget,
  runDesktop,
  runIos,
} from "./run.ts";

const exportArgs = {
  build: { description: "Build local inputs before export.", type: "boolean" },
  output: { alias: "o", description: "Export output path.", type: "string" },
  project: { description: "Godot project directory.", type: "string" },
  preset: { description: "Godot export preset name.", type: "string" },
  release: { description: "Use Godot release export mode.", type: "boolean" },
} as const;

const projectArgs = {
  project: { description: "Godot project directory.", type: "string" },
} as const;

const doctorArgs = {
  ...projectArgs,
  target: {
    description: "Optional target: desktop, ios, android, web, or plugin:<id>.",
    required: false,
    type: "positional",
  },
  fix: { description: "Apply supported repairs.", type: "boolean" },
} as const;

const initArgs = {
  target: { description: "Target project directory.", type: "positional" },
  template: { description: "Template folder name.", type: "positional" },
  overwrite: { description: "Replace an existing target directory.", type: "boolean" },
} as const;

const devServerArgs = {
  "clear-screen": { description: "Allow Vite to clear the terminal.", type: "boolean" },
  "force": { description: "Force Vite dependency pre-bundling.", type: "boolean" },
  "host": { description: "Vite dev server host override.", type: "string" },
  "log-level": { description: "Vite log level: info, warn, error, or silent.", type: "string" },
  "mode": { description: "Vite mode.", type: "string" },
  "no-clear-screen": { description: "Prevent Vite from clearing the terminal.", type: "boolean" },
  "port": { description: "Vite dev server port override.", type: "string" },
  "strict-port": {
    description: "Fail if the requested Vite port is unavailable.",
    type: "boolean",
  },
} as const;

const mobileDeviceArgs = {
  device: { description: "Target device or simulator selector.", type: "string" },
} as const;

const iosExportArgs = {
  ...exportArgs,
  ...mobileDeviceArgs,
} as const;

const androidLaunchArgs = {
  ...mobileDeviceArgs,
  "clear-data": { description: "Clear Android app data before launch.", type: "boolean" },
  "clear-logcat": { description: "Clear Android logcat before launch.", type: "boolean" },
  "force-stop": { description: "Force-stop the Android app before launch.", type: "boolean" },
} as const;

const androidRunArgs = {
  ...projectArgs,
  ...androidLaunchArgs,
  "launch-option": { description: "Launch option as key=value.", type: "string" },
  "no-logcat": { description: "Do not attach Android logcat after launch.", type: "boolean" },
  "skip-install": { description: "Launch an already-installed Android export.", type: "boolean" },
} as const;

const desktopRunArgs = {
  ...projectArgs,
  godot: { description: "Godot executable override.", type: "string" },
} as const;

const devArgs = {
  ...projectArgs,
  ...devServerArgs,
  godot: { description: "Godot executable override.", type: "string" },
} as const;

const androidDevArgs = {
  ...devArgs,
  ...androidLaunchArgs,
} as const;

const iosSimulatorLaunchArgs = {
  ...mobileDeviceArgs,
  "terminate-existing": {
    description: "Terminate the iOS simulator app before launch.",
    type: "boolean",
  },
} as const;

const iosRunArgs = {
  ...projectArgs,
  ...iosSimulatorLaunchArgs,
  "app": { description: "iOS .app path to install before launch.", type: "string" },
  "launch-option": { description: "Launch option as key=value.", type: "string" },
} as const;

const iosDevArgs = {
  ...devArgs,
  ...iosSimulatorLaunchArgs,
  app: { description: "iOS simulator .app output path.", type: "string" },
} as const;

const allDevArgs = {
  ...androidDevArgs,
  ...iosDevArgs,
} as const;

const allRunArgs = {
  ...desktopRunArgs,
  ...androidRunArgs,
  ...iosRunArgs,
} as const;

type DevCommandArgs = Partial<ParsedArgs<typeof allDevArgs>>;

function parseUserArgs(rawArgs: string[]): string[] {
  const separatorIndex = rawArgs.indexOf("--");
  if (separatorIndex < 0) {
    return [];
  }

  return rawArgs.slice(separatorIndex + 1);
}

function firstPositionalBeforeDoubleDash(
  args: { _?: string[] },
  rawArgs: string[],
): string | undefined {
  const separatorIndex = rawArgs.indexOf("--");
  const trailingCount = separatorIndex >= 0
    ? rawArgs.length - separatorIndex - 1
    : 0;
  const allPositionals = args._ ?? [];
  const beforeDashCount = Math.max(0, allPositionals.length - trailingCount);
  return beforeDashCount > 0
    ? allPositionals[0]
    : undefined;
}

function runDesktopExportCommand({
  args,
  rawArgs,
}: CommandContext<typeof exportArgs>): Promise<void> {
  return runExport({
    build: args.build !== false,
    cwd: args.project,
    output: args.output,
    platform: "desktop",
    preset: args.preset,
    release: args.release,
    userArgs: parseUserArgs(rawArgs),
  });
}

function runAndroidExportCommand({
  args,
  rawArgs,
}: CommandContext<typeof exportArgs>): Promise<void> {
  return runExport({
    build: args.build !== false,
    cwd: args.project,
    output: args.output,
    platform: "android",
    preset: args.preset,
    release: args.release,
    userArgs: parseUserArgs(rawArgs),
  });
}

function runWebExportCommand({ args, rawArgs }: CommandContext<typeof exportArgs>): Promise<void> {
  return runExport({
    build: args.build !== false,
    cwd: args.project,
    output: args.output,
    platform: "web",
    preset: args.preset,
    release: args.release,
    userArgs: parseUserArgs(rawArgs),
  });
}

async function runIosExportCommand({
  args,
  rawArgs,
}: CommandContext<typeof iosExportArgs>): Promise<void> {
  const config = await loadKirieConfig({
    command: "build",
    cwd: args.project,
  });
  const iosTarget = assertConfiguredTarget(config, "ios", "kirie export ios");
  const userArgs = parseUserArgs(rawArgs);

  if (iosTarget.host === "native" && !iosTarget.project) {
    await runExport({
      build: args.build !== false,
      config,
      output: args.output,
      platform: "ios",
      preset: args.preset,
      release: args.release,
      userArgs,
    });
    return;
  }

  const targetIsSimulator = !args.device || (await isIosSimulatorDevice(args.device, config.cwd));
  const configuration = args.release ? "release" : "debug";

  await exportIosApp({
    appPath:
      args.output ??
      (targetIsSimulator
        ? `dist/kirie/ios/${configuration}.app`
        : `dist/kirie/ios/device_${configuration}.app`),
    build: args.build !== false,
    config,
    cwd: config.cwd,
    device: args.device,
    preset: args.preset,
    release: args.release,
    target: targetIsSimulator ? "simulator" : "device",
    userArgs,
  });
}

function runDevCommand(target: DevTarget | undefined) {
  return ({ args, rawArgs }: { args: DevCommandArgs; rawArgs: string[] }): Promise<void> => {
    const unknownTarget = target === undefined
      ? firstPositionalBeforeDoubleDash(args, rawArgs)
      : undefined;
    if (unknownTarget) {
      throw new Error(`Unknown dev target: ${unknownTarget}`);
    }

    return runDev({
      appPath: args.app,
      clearData: args["clear-data"],
      clearLogcat: args["clear-logcat"],
      clearScreen: resolveClearScreen(args),
      cwd: args.project,
      device: args.device,
      force: args.force,
      forceStop: args["force-stop"],
      godotArgs: parseUserArgs(rawArgs),
      godotCommand: args.godot,
      host: args.host,
      logLevel: parseLogLevel(args["log-level"]),
      mode: args.mode,
      port: parsePort(args.port),
      strictPort: args["strict-port"],
      target,
      terminateExisting: args["terminate-existing"],
    });
  };
}

function parseLaunchOptions(rawOption: string | undefined): Record<string, string> | undefined {
  if (!rawOption) {
    return undefined;
  }

  const separatorIndex = rawOption.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error("Launch option must use key=value.");
  }

  return {
    [rawOption.slice(0, separatorIndex)]: rawOption.slice(separatorIndex + 1),
  };
}

function parseLogLevel(
  rawLogLevel: string | undefined,
): "info" | "warn" | "error" | "silent" | undefined {
  if (!rawLogLevel) {
    return undefined;
  }
  if (
    rawLogLevel === "info" ||
    rawLogLevel === "warn" ||
    rawLogLevel === "error" ||
    rawLogLevel === "silent"
  ) {
    return rawLogLevel;
  }

  throw new Error("Vite log level must be info, warn, error, or silent.");
}

function parsePort(rawPort: string | undefined): number | undefined {
  if (!rawPort) {
    return undefined;
  }

  const port = Number(rawPort);
  if (Number.isInteger(port) && port > 0 && port <= 65535) {
    return port;
  }

  throw new Error("Vite port must be an integer from 1 to 65535.");
}

function resolveClearScreen(args: DevCommandArgs): boolean | undefined {
  if (args["no-clear-screen"]) {
    return false;
  }
  if (args["clear-screen"]) {
    return true;
  }

  return undefined;
}

export function parseDoctorTarget(
  rawTarget: string | undefined,
  positionals: string[],
): DoctorTarget | undefined {
  if (positionals.length > 1) {
    throw new Error(`Unexpected doctor argument: ${positionals[1]}`);
  }
  if (!rawTarget) {
    return undefined;
  }
  if (
    rawTarget === "desktop" ||
    rawTarget === "ios" ||
    rawTarget === "android" ||
    rawTarget === "web"
  ) {
    return rawTarget;
  }
  if (rawTarget.startsWith("plugin:") && rawTarget.length > "plugin:".length) {
    return rawTarget as DoctorTarget;
  }
  throw new Error(`Unknown doctor target: ${rawTarget}`);
}

export const mainCommand: CommandDef = defineCommand({
  meta: {
    description: "Kirie development tools.",
    name: "kirie",
    version: packageJson.version,
  },
  subCommands: {
    build: defineCommand({
      args: projectArgs,
      default: "all",
      meta: { description: "Build local Kirie project inputs.", name: "build" },
      subCommands: {
        all: defineCommand({
          args: projectArgs,
          meta: { hidden: true, name: "all" },
          run: ({ args, rawArgs }) => {
            const unknownTarget = firstPositionalBeforeDoubleDash(args, rawArgs);
            if (unknownTarget) {
              throw new Error(`Unknown build target: ${unknownTarget}`);
            }
            return runBuild({ cwd: args.project });
          },
        }),
        dotnet: defineCommand({
          args: projectArgs,
          meta: { description: "Build the Godot C#/.NET project.", name: "dotnet" },
          run: ({ args }) => runBuildDotnet({ cwd: args.project }),
        }),
        web: defineCommand({
          args: projectArgs,
          meta: { description: "Build the Vite web output.", name: "web" },
          run: ({ args }) => runBuildWeb({ cwd: args.project }),
        }),
      },
    }),
    dev: defineCommand({
      args: allDevArgs,
      default: "auto",
      meta: { description: "Start development runtime for a configured Kirie target.", name: "dev" },
      subCommands: {
        auto: defineCommand({
          args: allDevArgs,
          meta: { hidden: true, name: "auto" },
          run: runDevCommand(undefined),
        }),
        android: defineCommand({
          args: androidDevArgs,
          meta: {
            description: "Export, install, and launch Android for development.",
            name: "android",
          },
          run: runDevCommand("android"),
        }),
        desktop: defineCommand({
          args: devArgs,
          meta: {
            description: "Launch Godot desktop for development.",
            name: "desktop",
          },
          run: runDevCommand("desktop"),
        }),
        ios: defineCommand({
          args: iosDevArgs,
          meta: {
            description: "Export, install, and launch iOS for development.",
            name: "ios",
          },
          run: runDevCommand("ios"),
        }),
        web: defineCommand({
          args: devArgs,
          meta: {
            description: "Export and serve Godot Web with Vite dev.",
            name: "web",
          },
          run: runDevCommand("web"),
        }),
      },
    }),
    doctor: defineCommand({
      args: doctorArgs,
      meta: { description: "Diagnose Kirie project prerequisites.", name: "doctor" },
      run: ({ args }) =>
        runDoctor({
          cwd: args.project,
          fix: args.fix,
          target: parseDoctorTarget(args.target, args._),
        }),
    }),
    init: defineCommand({
      args: initArgs,
      meta: { description: "Initialize a Kirie project from an official template.", name: "init" },
      run: ({ args }) => {
        if (!args.target || !args.template) {
          throw new Error("Kirie init requires a target directory and template folder name.");
        }

        return runInit({
          overwrite: args.overwrite,
          target: args.target,
          template: args.template,
        });
      },
    }),
    export: defineCommand({
      meta: { description: "Export a Kirie project for a configured target.", name: "export" },
      subCommands: {
        android: defineCommand({
          args: exportArgs,
          meta: { description: "Export the Android target.", name: "android" },
          run: runAndroidExportCommand,
        }),
        desktop: defineCommand({
          args: exportArgs,
          meta: { description: "Export the Desktop target.", name: "desktop" },
          run: runDesktopExportCommand,
        }),
        ios: defineCommand({
          args: iosExportArgs,
          meta: { description: "Export the iOS target.", name: "ios" },
          run: runIosExportCommand,
        }),
        web: defineCommand({
          args: exportArgs,
          meta: { description: "Export the Web Godot preset and packaged web content.", name: "web" },
          run: runWebExportCommand,
        }),
      },
    }),
    run: defineCommand({
      args: allRunArgs,
      default: "auto",
      meta: { description: "Launch a Kirie project or exported app.", name: "run" },
      subCommands: {
        auto: defineCommand({
          args: allRunArgs,
          meta: { hidden: true, name: "auto" },
          run: ({ args, rawArgs }) => {
            const unknownTarget = firstPositionalBeforeDoubleDash(args, rawArgs);
            if (unknownTarget) {
              throw new Error(`Unknown run target: ${unknownTarget}`);
            }
            const userArgs = parseUserArgs(rawArgs);
            return runAutoTarget({
              appArgs: userArgs,
              appPath: args.app,
              attachLogcat: !args["no-logcat"],
              clearData: args["clear-data"],
              clearLogcat: args["clear-logcat"],
              cwd: args.project,
              device: args.device,
              forceStop: args["force-stop"],
              godotArgs: userArgs,
              godotCommand: args.godot,
              launchOptions: parseLaunchOptions(args["launch-option"]),
              skipInstall: args["skip-install"],
              terminateExisting: args["terminate-existing"],
            });
          },
        }),
        android: defineCommand({
          args: androidRunArgs,
          meta: { description: "Install and launch an Android export.", name: "android" },
          run: ({ args }) =>
            runAndroid({
              attachLogcat: !args["no-logcat"],
              clearData: args["clear-data"],
              clearLogcat: args["clear-logcat"],
              cwd: args.project,
              device: args.device,
              forceStop: args["force-stop"],
              launchOptions: parseLaunchOptions(args["launch-option"]),
              skipInstall: args["skip-install"],
            }),
        }),
        desktop: defineCommand({
          args: desktopRunArgs,
          meta: { description: "Launch a Kirie project on desktop.", name: "desktop" },
          run: ({ args, rawArgs }) =>
            runDesktop({
              cwd: args.project,
              godotArgs: parseUserArgs(rawArgs),
              godotCommand: args.godot,
            }),
        }),
        ios: defineCommand({
          args: iosRunArgs,
          meta: { description: "Install and launch an iOS export.", name: "ios" },
          run: ({ args, rawArgs }) =>
            runIos({
              appArgs: parseUserArgs(rawArgs),
              appPath: args.app,
              cwd: args.project,
              device: args.device,
              launchOptions: parseLaunchOptions(args["launch-option"]),
              terminateExisting: args["terminate-existing"],
            }),
        }),
      },
    }),
  },
});
