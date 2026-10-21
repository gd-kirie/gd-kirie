import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebDevHostUrl, resolveAndroidReverseWebUrl, runDev } from "./dev.ts";
import { createKirieDevLaunchOptions, runIosSimulator } from "./run.ts";
import {
  createCliProjectTracker,
  installGodotCefFixture,
  installKirieConfigFixture,
  installProjectFixture,
} from "./test-project.ts";

const FAKE_GODOT_INVOCATIONS_FILE = "godot-invocations.json";
const FAKE_ADB_INVOCATIONS_FILE = "adb-invocations.json";
const FAKE_XCRUN_INVOCATIONS_FILE = "xcrun-invocations.json";
const cliPath = fileURLToPath(import.meta.resolve("../cli.ts"));
const projects = createCliProjectTracker("kirie-cli-dev-");

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
  vi.unstubAllEnvs();
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

  it("exports and serves the Godot Web host beside the Vite app", async () => {
    const project = await projects.copy();
    let hostUrl = "";

    await installProjectFixture(project, "fake-godot.js");
    await installKirieConfigFixture(project, "dev-fake-godot.kirie.config.ts");

    await runDev({
      cwd: project,
      target: "web",
      waitForWebExit: async (url) => {
        hostUrl = url;
        const response = await fetch(url);
        expect(response.status).toBe(200);
        expect(response.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
        expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      },
    });

    const [exportRun] = await readFakeGodotInvocations(project, 1);
    expect(exportRun.argv.slice(0, 5)).toEqual([
      "--headless",
      "--path",
      project,
      "--export-debug",
      "Web",
    ]);
    expect(hostUrl).toContain("/@fs/");
    expect(hostUrl).toContain("kirie-dev=1");
    expect(new URL(hostUrl).searchParams.get("kirie-web-url")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/$/,
    );
  });

  it("creates a same-origin Godot Web host URL", () => {
    const url = createWebDevHostUrl(
      "http://127.0.0.1:5173/",
      "/workspace/dist/kirie/web/index.html",
    );

    expect(url).toBe(
      "http://127.0.0.1:5173/@fs/workspace/dist/kirie/web/index.html?kirie-dev=1&kirie-web-url=http%3A%2F%2F127.0.0.1%3A5173%2F",
    );
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

  it.each([
    { simulatorId: "selected-simulator", expectedId: "selected-simulator" },
    { simulatorId: undefined, expectedId: "environment-simulator" },
  ])("boots and installs on $expectedId before launching with dev options", async ({ simulatorId, expectedId }) => {
    const project = await projects.copy();
    await installKirieConfigFixture(project, "dev-log-silent.kirie.config.ts");
    await installFakeXcrun(project);
    vi.stubEnv("PATH", `${path.join(project, "fake-bin")}${path.delimiter}${process.env.PATH ?? ""}`);
    vi.stubEnv("SIMULATOR_ID", "environment-simulator");

    await runIosSimulator({
      appPath: "test.app",
      bundleId: "org.gd-kirie.cli-test",
      cwd: project,
      launchOptions: createKirieDevLaunchOptions("http://127.0.0.1:5173/"),
      simulatorId,
      terminateExisting: true,
    });

    const [bootRun, installRun, , launchRun] = await readFakeXcrunInvocations(project);

    expect(bootRun?.argv).toEqual(["simctl", "bootstatus", expectedId, "-b"]);
    expect(installRun?.argv).toEqual([
      "simctl",
      "install",
      expectedId,
      path.join(project, "test.app"),
    ]);
    expect(launchRun?.argv).toEqual([
      "simctl",
      "launch",
      "--console",
      "--terminate-running-process",
      expectedId,
      "org.gd-kirie.cli-test",
      "--log-file",
      path.join(project, "simulator-data", "tmp", "kirie.log"),
      "--kirie-dev=1",
      "--kirie-web-url=http://127.0.0.1:5173/",
    ]);
  });

  it("stops before installing or launching when simulator boot fails", async () => {
    const project = await projects.copy();
    await installKirieConfigFixture(project, "dev-log-silent.kirie.config.ts");
    await installFakeXcrun(project);
    vi.stubEnv("PATH", `${path.join(project, "fake-bin")}${path.delimiter}${process.env.PATH ?? ""}`);
    vi.stubEnv("FAKE_XCRUN_FAIL_BOOT", "1");

    await expect(runIosSimulator({
      appPath: "test.app",
      bundleId: "org.gd-kirie.cli-test",
      cwd: project,
      simulatorId: "failed-simulator",
    })).rejects.toThrow("bootstatus");

    const invocations = await readFakeXcrunInvocations(project);
    expect(invocations.map((invocation) => invocation.argv)).toEqual([
      ["simctl", "bootstatus", "failed-simulator", "-b"],
    ]);
  });

  it("forwards simulator output from startup through process exit", async () => {
    const project = await projects.copy();
    await installKirieConfigFixture(project, "dev-log-silent.kirie.config.ts");
    await installFakeXcrun(project);

    const child = execa(process.execPath, [
      cliPath,
      "run",
      "ios",
      "--project",
      project,
      "--device",
      "booted",
    ], {
      env: {
        FAKE_XCRUN_WAIT_FOR_READER: "1",
        PATH: `${path.join(project, "fake-bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      reject: false,
      timeout: 5000,
    });

    const lines: string[] = [];
    try {
      for await (const line of child.iterable()) {
        lines.push(line);
        if (lines.length === 1) {
          expect(child.exitCode).toBeNull();
          await fs.writeFile(path.join(project, "reader-ready"), "");
        }
      }

      expect((await child).exitCode).toBe(0);
    } finally {
      child.kill("SIGTERM");
      await child;
    }

    expect(lines).toEqual([
      "VIDOT {\"type\":\"file_collected\",\"name\":\"启动\"}",
      "VIDOT {\"type\":\"run_finish\"}",
    ]);
  });

  it("reports simulator launch failures", async () => {
    const project = await projects.copy();
    await installKirieConfigFixture(project, "dev-log-silent.kirie.config.ts");
    await installFakeXcrun(project);

    const result = await execa(process.execPath, [
      cliPath,
      "run",
      "ios",
      "--project",
      project,
      "--device",
      "booted",
    ], {
      env: {
        FAKE_XCRUN_FAIL_LAUNCH: "1",
        PATH: `${path.join(project, "fake-bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      reject: false,
      timeout: 5000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("simulator launch failed");
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
  expectedLength: number = 2,
): Promise<GodotInvocation[]> {
  const invocationsFile = path.join(project, FAKE_GODOT_INVOCATIONS_FILE);
  const invocations = JSON.parse(await fs.readFile(invocationsFile, "utf8")) as GodotInvocation[];

  expect(invocations).toHaveLength(expectedLength);
  return invocations;
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
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const file = "${FAKE_XCRUN_INVOCATIONS_FILE}";
const argv = process.argv.slice(2);

appendFileSync(file, JSON.stringify({ argv, cwd: process.cwd() }) + "\\n");

if (argv[1] === "bootstatus" && process.env.FAKE_XCRUN_FAIL_BOOT) {
  process.stderr.write("simulator boot failed\\n");
  process.exit(8);
}

if (argv[1] === "get_app_container") {
  const container = resolve("simulator-data");
  mkdirSync(join(container, "tmp"), { recursive: true });
  writeFileSync(join(container, "tmp", "kirie.log"), "previous run\\n");
  process.stdout.write(container);
}

if (argv[1] === "launch" && argv.includes("--log-file")) {
  if (process.env.FAKE_XCRUN_FAIL_LAUNCH) {
    process.stderr.write("simulator launch failed\\n");
    process.exit(7);
  }

  const logPath = argv[argv.indexOf("--log-file") + 1];
  appendFileSync(logPath, 'VIDOT {"type":"file_collected","name":"启动"}\\n');
  while (process.env.FAKE_XCRUN_WAIT_FOR_READER && !existsSync("reader-ready")) {
    await delay(10);
  }

  appendFileSync(logPath, 'VIDOT {"type":"run_finish"}\\n');
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
