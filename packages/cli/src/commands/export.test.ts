import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import { createCliProjectTracker, installProjectFixture } from "./test-project.ts";

const FAKE_GODOT_INVOCATIONS_FILE = "godot-invocations.json";
const cliPath = fileURLToPath(import.meta.resolve("../cli.ts"));
const projects = createCliProjectTracker("kirie-cli-export-");

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
