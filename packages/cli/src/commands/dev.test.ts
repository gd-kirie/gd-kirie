import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import { resolveAndroidReverseWebUrl, runDev } from "./dev.ts";
import { createKirieDevLaunchOptions, runIosSimulator } from "./run.ts";
import {
  createBasicKirieCliProjectTracker,
  installGodotCefFixture,
  installKirieConfigFixture,
  installProjectFixture,
} from "./test-project.ts";

const FAKE_GODOT_INVOCATIONS_FILE = "godot-invocations.json";
const FAKE_ADB_INVOCATIONS_FILE = "adb-invocations.json";
const FAKE_XCRUN_INVOCATIONS_FILE = "xcrun-invocations.json";
const cliPath = fileURLToPath(import.meta.resolve("../cli.ts"));
const projects = createBasicKirieCliProjectTracker("kirie-cli-dev-");

interface AdbInvocation {
  argv: string[];
  cwd: string;
}

interface GodotInvocation {
  argv: string[];
  cwd: string;
  env: { KIRIE_DEV?: string; KIRIE_WEB_URL?: string };
}

interface XcrunInvocation {
  argv: string[];
  cwd: string;
}

afterEach(async () => {
  await projects.cleanup();
});

describe("runDev", () => {
  it("starts Vite and launches Godot with the resolved dev URL", async () => {
    const project = await projects.copy();

    await installProjectFixture(project, "fake-godot.js");
    await installKirieConfigFixture(project, "dev-fake-godot.kirie.config.ts");
    await installGodotCefFixture(project);

    await runDev({
      cwd: project,
      godotArgs: ["--verbose"],
    });

    const realProject = await fs.realpath(project);
    const [prepareRun, devRun] = await readFakeGodotInvocations(project);

    expect(prepareRun).toMatchObject({
      argv: ["--headless", "--path", project, "--import"],
      cwd: realProject,
      env: {},
    });
    expect(devRun).toMatchObject({
      cwd: realProject,
      env: {},
    });
    expect(devRun?.argv.slice(0, 4)).toEqual(["--path", project, "--", "--kirie-dev=1"]);
    expect(devRun?.argv[4]).toMatch(/^--kirie-web-url=http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(devRun?.argv[5]).toBe("--verbose");
  });

  it("creates typed Kirie dev launch options", () => {
    expect(createKirieDevLaunchOptions("http://127.0.0.1:5173/")).toEqual({
      "kirie-dev": "1",
      "kirie-web-url": "http://127.0.0.1:5173/",
    });
  });

  it("maps Android dev URLs to adb-reversed loopback URLs", () => {
    expect(resolveAndroidReverseWebUrl("http://192.168.1.10:5173/nested/?x=1")).toEqual({
      port: 5173,
      url: "http://127.0.0.1:5173/nested/?x=1",
    });
  });

  it("requires Android internet permission for Android dev", async () => {
    const project = await projects.copy();
    const exportPresetsPath = path.join(project, "export_presets.cfg");
    const exportPresets = await fs.readFile(exportPresetsPath, "utf8");

    await installKirieConfigFixture(project, "dev-log-silent.kirie.config.ts");
    await fs.writeFile(
      exportPresetsPath,
      exportPresets.replace("permissions/internet=true", "permissions/internet=false"),
    );

    await expect(
      runDev({
        cwd: project,
        target: "android",
      }),
    ).rejects.toThrow(
      "kirie dev android requires the Android export preset option permissions/internet=true.",
    );
  });

  it("requires project-only iOS export for iOS dev", async () => {
    const project = await projects.copy();
    const exportPresetsPath = path.join(project, "export_presets.cfg");
    const exportPresets = await fs.readFile(exportPresetsPath, "utf8");

    await installKirieConfigFixture(project, "dev-log-silent.kirie.config.ts");
    await fs.writeFile(
      exportPresetsPath,
      exportPresets.replace(
        "application/export_project_only=true",
        "application/export_project_only=false",
      ),
    );

    await expect(
      runDev({
        cwd: project,
        target: "ios",
      }),
    ).rejects.toThrow(
      "kirie dev ios requires the iOS export preset option application/export_project_only=true.",
    );
  });

  it("runs Android dev through adb reverse and loopback launch options", async () => {
    const project = await projects.copy();

    await installProjectFixture(project, "fake-godot.js");
    await installKirieConfigFixture(project, "dev-reject-build-config.kirie.config.ts");
    await installFakeAdb(project);

    const originalPath = process.env.PATH;
    process.env.PATH = `${path.join(project, "fake-bin")}${path.delimiter}${originalPath ?? ""}`;
    try {
      await runDev({
        cwd: project,
        target: "android",
      });
    } finally {
      process.env.PATH = originalPath;
    }

    const adbInvocations = await readFakeAdbInvocations(project);
    const waitForDeviceRun = adbInvocations.findIndex(
      (invocation) => invocation.argv[0] === "wait-for-device",
    );
    const installRun = adbInvocations.findIndex((invocation) => invocation.argv[0] === "install");
    const reverseRun = adbInvocations.find((invocation) => invocation.argv[0] === "reverse");
    const launchRun = adbInvocations.find((invocation) =>
      invocation.argv.some((arg) => arg.endsWith("/com.godot.game.GodotAppLauncher")),
    );

    expect(waitForDeviceRun).toBeLessThan(installRun);
    expect(reverseRun?.argv).toHaveLength(3);
    expect(reverseRun?.argv[1]).toMatch(/^tcp:\d+$/);
    expect(reverseRun?.argv[2]).toBe(reverseRun?.argv[1]);
    expect(launchRun?.argv).toContain("kirie-web-url");
    expect(launchRun?.argv).toContain("kirie-dev");
    expect(launchRun?.argv).toContain("1");
    expect(launchRun?.argv).toContain(`http://127.0.0.1:${reverseRun?.argv[1].slice(4)}/`);
  });

  it("keeps the CLI dev command defaulting to desktop", async () => {
    const project = await projects.copy();

    await installProjectFixture(project, "fake-godot.js");
    await installKirieConfigFixture(project, "dev-fake-godot.kirie.config.ts");
    await installGodotCefFixture(project);

    await execa(process.execPath, [cliPath, "dev", "--project", project], {
      cwd: path.dirname(project),
      stdio: "inherit",
    });

    const [, devRun] = await readFakeGodotInvocations(project);

    expect(devRun?.argv.slice(0, 4)).toEqual(["--path", project, "--", "--kirie-dev=1"]);
  });

  it("launches iOS simulators with console output attached", async () => {
    const project = await projects.copy();

    await installKirieConfigFixture(project, "dev-log-silent.kirie.config.ts");
    await installFakeXcrun(project);

    const originalPath = process.env.PATH;
    process.env.PATH = `${path.join(project, "fake-bin")}${path.delimiter}${originalPath ?? ""}`;
    try {
      await runIosSimulator({
        cwd: project,
        launchOptions: createKirieDevLaunchOptions("http://127.0.0.1:5173/"),
        simulatorId: "booted",
        terminateExisting: true,
      });
    } finally {
      process.env.PATH = originalPath;
    }

    const invocations = await readFakeXcrunInvocations(project);
    const logRun = invocations.find((invocation) => invocation.argv[1] === "spawn");
    const launchRun = invocations.find((invocation) => invocation.argv[1] === "launch");

    expect(logRun?.argv).toEqual([
      "simctl",
      "spawn",
      "booted",
      "log",
      "stream",
      "--style",
      "compact",
      "--level",
      "info",
      "--predicate",
      "subsystem == \"ai.moeru.kirie.examples.basic-kirie-cli\"",
    ]);

    expect(launchRun?.argv.slice(0, 6)).toEqual([
      "simctl",
      "launch",
      "--console",
      "--terminate-running-process",
      "booted",
      "ai.moeru.kirie.examples.basic-kirie-cli",
    ]);
    expect(launchRun?.argv).toContain("--kirie-dev=1");
    expect(launchRun?.argv).toContain("--kirie-web-url=http://127.0.0.1:5173/");
  });

  it("rejects Kirie-owned Vite options", async () => {
    const project = await projects.copy();
    await installKirieConfigFixture(project, "dev-owned-server-port.kirie.config.ts");
    await installGodotCefFixture(project);

    await expect(
      runDev({
        cwd: project,
      }),
    ).rejects.toThrow("web.vite.server.port is owned by Kirie");
  });

  it("fails clearly when src-web/index.html is missing", async () => {
    const project = await projects.copy();
    await fs.rm(path.join(project, "src-web", "index.html"));
    await installKirieConfigFixture(project, "dev-log-silent.kirie.config.ts");
    await installGodotCefFixture(project);

    await expect(
      runDev({
        cwd: project,
      }),
    ).rejects.toThrow(/Kirie dev requires .*index\.html/);
  });

  it("requires Godot CEF before starting desktop dev", async () => {
    const project = await projects.copy();
    await installKirieConfigFixture(project, "dev-log-silent.kirie.config.ts");

    await expect(runDev({ cwd: project })).rejects.toThrow(
      "Run: pnpm kirie doctor --fix plugin:core",
    );

    await expect(fs.stat(path.join(project, FAKE_GODOT_INVOCATIONS_FILE))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

async function readFakeGodotInvocations(
  project: string,
): Promise<[GodotInvocation, GodotInvocation]> {
  const invocationsFile = path.join(project, FAKE_GODOT_INVOCATIONS_FILE);
  const invocations = JSON.parse(await fs.readFile(invocationsFile, "utf8")) as GodotInvocation[];

  expect(invocations).toHaveLength(2);
  return invocations as [GodotInvocation, GodotInvocation];
}

async function installFakeAdb(project: string): Promise<void> {
  const fakeBinDir = path.join(project, "fake-bin");
  const fakeAdbPath = path.join(fakeBinDir, "adb");

  await fs.mkdir(fakeBinDir, { recursive: true });
  await fs.writeFile(
    fakeAdbPath,
    `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const file = "${FAKE_ADB_INVOCATIONS_FILE}";
const invocations = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
const argv = process.argv.slice(2);

invocations.push({ argv, cwd: process.cwd() });
writeFileSync(file, JSON.stringify(invocations));

if (argv.includes("pidof")) {
  process.stdout.write("123\\n");
}
`,
  );
  await fs.chmod(fakeAdbPath, 0o755);
}

async function readFakeAdbInvocations(project: string): Promise<AdbInvocation[]> {
  const invocationsFile = path.join(project, FAKE_ADB_INVOCATIONS_FILE);
  return JSON.parse(await fs.readFile(invocationsFile, "utf8")) as AdbInvocation[];
}

async function installFakeXcrun(project: string): Promise<void> {
  const fakeBinDir = path.join(project, "fake-bin");
  const fakeXcrunPath = path.join(fakeBinDir, "xcrun");

  await fs.mkdir(fakeBinDir, { recursive: true });
  await fs.writeFile(
    fakeXcrunPath,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const file = "${FAKE_XCRUN_INVOCATIONS_FILE}";
const argv = process.argv.slice(2);

appendFileSync(file, JSON.stringify({ argv, cwd: process.cwd() }) + "\\n");

if (argv.includes("stream")) {
  setInterval(() => {}, 1000);
}
`,
  );
  await fs.chmod(fakeXcrunPath, 0o755);
}

async function readFakeXcrunInvocations(project: string): Promise<XcrunInvocation[]> {
  const invocationsFile = path.join(project, FAKE_XCRUN_INVOCATIONS_FILE);
  return (await fs.readFile(invocationsFile, "utf8"))
    .trim()
    .split("\n")
    .map((invocation) => JSON.parse(invocation) as XcrunInvocation);
}
