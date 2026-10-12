import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyViteWebOutput } from "@gd-kirie/build";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import { createBasicKirieCliProjectTracker, installProjectFixture } from "./test-project.ts";

const FAKE_GODOT_INVOCATIONS_FILE = "godot-invocations.json";
const cliPath = fileURLToPath(import.meta.resolve("../cli.ts"));
const projects = createBasicKirieCliProjectTracker("kirie-cli-export-");

afterEach(async () => {
  await projects.cleanup();
});

describe("runExport", () => {
  it("accepts --project and forwards user args from the CLI command", async () => {
    const project = await projects.copy();
    const outputPath = path.join(project, "dist", "android_debug.apk");

    await installProjectFixture(project, "fake-godot.js");
    await installProjectFixture(project, "dev-fake-godot.kirie.config.ts", "kirie.config.ts");

    await execa(
      process.execPath,
      [
        cliPath,
        "export",
        "android",
        "--project",
        project,
        "--no-build",
        "--output",
        outputPath,
        "--",
        "--kirie-android-aar=debug",
      ],
      {
        cwd: path.dirname(project),
        stdio: "inherit",
      },
    );

    const realProject = await fs.realpath(project);
    const [exportRun] = await readFakeGodotInvocations(project);

    expect(exportRun).toEqual({
      argv: [
        "--headless",
        "--path",
        project,
        "--install-android-build-template",
        "--export-debug",
        "Android",
        outputPath,
        "--",
        "--kirie-android-aar=debug",
      ],
      cwd: realProject,
      env: {},
    });
    await expect(fs.access(path.join(project, "src-web", "dist"))).rejects.toThrow();
  });

  it("builds and copies Web content beside the Web export", async () => {
    const project = await projects.copy();
    const outputPath = path.join(project, "dist", "web", "app.html");

    await installProjectFixture(project, "fake-godot.js");
    await installProjectFixture(project, "dev-fake-godot.kirie.config.ts", "kirie.config.ts");

    await execa(
      process.execPath,
      [cliPath, "export", "web", "--project", project, "--output", outputPath],
      { cwd: path.dirname(project), stdio: "inherit" },
    );

    const [exportRun] = await readFakeGodotInvocations(project);
    expect(exportRun.argv).toEqual([
      "--headless",
      "--path",
      project,
      "--export-debug",
      "Web",
      outputPath,
    ]);
    await expect(
      fs.access(path.join(project, "dist", "web", "src-web", "dist", "index.html")),
    ).resolves.toBe(undefined);
  });

  it("rejects a Web export without built web content before starting Godot", async () => {
    const project = await projects.copy();

    await installProjectFixture(project, "fake-godot.js");
    await installProjectFixture(project, "dev-fake-godot.kirie.config.ts", "kirie.config.ts");

    const result = await execa(
      process.execPath,
      [cliPath, "export", "web", "--project", project, "--no-build"],
      { cwd: path.dirname(project), reject: false },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Kirie Web export requires");
    expect(result.stderr).toContain("Run kirie build web or remove --no-build");
    await expect(fs.access(path.join(project, FAKE_GODOT_INVOCATIONS_FILE))).rejects.toThrow();
  });
});

describe("copyViteWebOutput", () => {
  it("rejects an output target that contains the source without deleting the source", async () => {
    const project = await projects.copy();
    const outputDir = path.join(project, "web-export");
    const webRoot = path.join(outputDir, "src-web", "dist", "application");
    const sourceIndex = path.join(webRoot, "dist", "index.html");
    await fs.mkdir(path.dirname(sourceIndex), { recursive: true });
    await fs.writeFile(sourceIndex, "source remains");

    expect(() => copyViteWebOutput({ outputDir, webRoot })).toThrow(
      "source and target directories cannot contain each other",
    );
    await expect(fs.readFile(sourceIndex, "utf8")).resolves.toBe("source remains");
  });
});

async function readFakeGodotInvocations(project: string): Promise<GodotInvocation[]> {
  const invocationsFile = path.join(project, FAKE_GODOT_INVOCATIONS_FILE);
  return JSON.parse(await fs.readFile(invocationsFile, "utf8")) as GodotInvocation[];
}

interface GodotInvocation {
  argv: string[];
  cwd: string;
  env: { KIRIE_DEV?: string; KIRIE_WEB_URL?: string };
}
