#!/usr/bin/env node

import type { KirieTestTarget } from "./index.ts";

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execa } from "execa";

const EVENT_PREFIX = "VIDOT ";
const STAGING_DIRECTORY_NAME = "kirie_vitest_generated";

interface ParsedLaunch {
  args: string[];
  projectPath: string;
  target: KirieTestTarget;
}

interface ProjectPackage {
  name: string;
}

interface StagedLaunch {
  args: string[];
  filePaths: Map<string, string>;
  stagingPath: string;
}

async function main(): Promise<void> {
  const launch = parseLaunch(process.argv.slice(2));
  await runLaunch(launch);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function runLaunch(launch: ParsedLaunch): Promise<void> {
  if (launch.target === "desktop") {
    const godotArgs = process.env.GODOT ? ["--godot", process.env.GODOT] : [];
    await runKirie(
      [
        "run",
        "desktop",
        "--project",
        launch.projectPath,
        ...godotArgs,
        "--",
        "--headless",
        ...launch.args,
      ],
    );
    return;
  }

  const staged = await stageLaunch(launch.projectPath, launch.args);
  try {
    if (launch.target === "android") {
      await runAndroid(launch.projectPath, staged);
      return;
    }

    await runIos(launch.projectPath, staged);
  } finally {
    await fs.rm(staged.stagingPath, { force: true, recursive: true });
  }
}

async function runAndroid(projectPath: string, staged: StagedLaunch): Promise<void> {
  await runKirie(
    [
      "export",
      "android",
      "--project",
      projectPath,
      "--no-build",
      "--",
      `--kirie-android-extra-args=${staged.args.join(" ")}`,
    ],
  );
  await runKirie(
    [
      "run",
      "android",
      "--project",
      projectPath,
      "--force-stop",
      "--clear-data",
      "--clear-logcat",
    ],
    staged.filePaths,
    true,
  );
}

async function runIos(projectPath: string, staged: StagedLaunch): Promise<void> {
  const device = process.env.IOS_DEVICE_ID;
  const deviceArgs = device ? ["--device", device] : [];
  const appPath = device ? "dist/kirie/ios/device_debug.app" : "dist/kirie/ios/debug.app";

  await runKirie(
    ["export", "ios", "--project", projectPath, "--no-build", ...deviceArgs],
  );
  await runKirie(
    [
      "run",
      "ios",
      "--project",
      projectPath,
      "--app",
      appPath,
      "--terminate-existing",
      ...deviceArgs,
      "--",
      ...staged.args,
    ],
    staged.filePaths,
    true,
  );
}

async function runKirie(
  args: string[],
  filePaths: ReadonlyMap<string, string> = new Map(),
  stopAfterRunFinish = false,
): Promise<void> {
  const child = execa("kirie", args, {
    reject: false,
    stderr: "inherit",
    stdout: "pipe",
  });
  let runFinished = false;

  for await (const rawLine of child.iterable()) {
    const line = `${rawLine}`;
    const eventOffset = line.indexOf(EVENT_PREFIX);
    if (eventOffset < 0) {
      process.stdout.write(`${line}\n`);
      continue;
    }

    const event = JSON.parse(line.slice(eventOffset + EVENT_PREFIX.length)) as {
      file?: string;
      type?: string;
    };
    if (event.file && filePaths.has(event.file)) {
      event.file = filePaths.get(event.file);
    }
    process.stdout.write(`${EVENT_PREFIX}${JSON.stringify(event)}\n`);

    if (event.type === "run_finish") {
      runFinished = true;
      if (stopAfterRunFinish) {
        child.kill("SIGTERM");
      }
    }
  }

  const result = await child;
  if (result.exitCode !== 0 && !runFinished) {
    throw new Error(`Kirie exited with code ${result.exitCode ?? 1}.`);
  }
}

async function stageLaunch(projectPath: string, args: string[]): Promise<StagedLaunch> {
  const stagingPath = path.join(projectPath, STAGING_DIRECTORY_NAME);
  await fs.rm(stagingPath, { force: true, recursive: true });
  await fs.mkdir(stagingPath, { recursive: true });

  const projectPackage = JSON.parse(
    await fs.readFile(path.join(projectPath, "package.json"), "utf8"),
  ) as ProjectPackage;
  const projectModulePrefix = `res://tstogd_modules/${projectPackage.name}/`;

  const stagedArgs = [...args];
  const filePaths = new Map<string, string>();
  const runnerIndex = stagedArgs.indexOf("--script");
  if (runnerIndex < 0 || !stagedArgs[runnerIndex + 1]) {
    throw new Error("ViDot did not provide a runner script.");
  }

  const runnerPath = path.join(stagingPath, "runner.gd");
  await fs.copyFile(stagedArgs[runnerIndex + 1], runnerPath);
  stagedArgs[runnerIndex + 1] = resourcePath(projectPath, runnerPath);

  let testIndex = 0;
  for (let index = 0; index < stagedArgs.length; index++) {
    const argument = stagedArgs[index];
    if (!argument.startsWith("--vidot-test=")) {
      continue;
    }

    const sourcePath = argument.slice("--vidot-test=".length);
    const stagedPath = path.join(stagingPath, `test-${testIndex}.gd`);
    const stagedResourcePath = resourcePath(projectPath, stagedPath);
    const source = await fs.readFile(sourcePath, "utf8");
    await fs.writeFile(stagedPath, source.replaceAll(projectModulePrefix, "res://"));
    stagedArgs[index] = `--vidot-test=${stagedResourcePath}`;
    filePaths.set(stagedResourcePath, path.resolve(sourcePath));
    testIndex++;
  }

  return { args: stagedArgs, filePaths, stagingPath };
}

function parseLaunch(args: string[]): ParsedLaunch {
  const targetArgument = args.shift();
  let target = "";
  if (targetArgument?.startsWith("--kirie-target=")) {
    target = targetArgument.slice("--kirie-target=".length);
  }

  if (target !== "android" && target !== "desktop" && target !== "ios") {
    throw new Error(`Unknown Kirie test target: ${target || "missing"}`);
  }

  const projectIndex = args.indexOf("--path");
  const projectPath = projectIndex >= 0 ? args[projectIndex + 1] : undefined;
  if (!projectPath) {
    throw new Error("ViDot did not provide a Godot project path.");
  }
  args.splice(projectIndex, 2);

  return { args, projectPath: path.resolve(projectPath), target };
}

function resourcePath(projectPath: string, filePath: string): string {
  return `res://${path.relative(projectPath, filePath).split(path.sep).join("/")}`;
}
