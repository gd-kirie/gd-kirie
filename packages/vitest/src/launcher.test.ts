import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { kirie } from "./index.ts";
import { parseLaunch, runLaunch, stageLaunch } from "./launcher.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kirie-vitest-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("@gd-kirie/vitest", () => {
  it("parses ViDot launch arguments and validates targets", () => {
    const parsed = parseLaunch([
      "--kirie-target=ios",
      "--path",
      "/tmp/example-project",
      "--script",
      "runner.gd",
    ]);

    expect(parsed).toEqual({
      args: ["--script", "runner.gd"],
      projectPath: path.resolve("/tmp/example-project"),
      target: "ios",
    });

    expect(() => parseLaunch(["--kirie-target=web", "--path", "/tmp/p"])).toThrow(
      "Unknown Kirie test target: web",
    );
    expect(() => parseLaunch(["--kirie-target=desktop"])).toThrow(
      "ViDot did not provide a Godot project path.",
    );
    const pool = kirie({ projectPath: "/tmp/example-project", target: "android" });
    expect(pool).toHaveProperty("name");
  });

  it("stages runner and test GDScript files and invokes explicit kirie target commands", async () => {
    const projectDir = await createTempDir();
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "my-suite", private: true }),
    );
    const runnerSource = path.join(projectDir, "external-runner.gd");
    const testSource = path.join(projectDir, "probe.test.gd");
    await fs.writeFile(runnerSource, "extends SceneTree\n");
    await fs.writeFile(
      testSource,
      "const Probe = preload(\"res://tstogd_modules/my-suite/src/probe.gd\")\n",
    );

    const staged = await stageLaunch(projectDir, [
      "--script",
      runnerSource,
      `--vidot-test=${testSource}`,
    ]);
    expect(staged.args).toEqual([
      "--script",
      "res://kirie_vitest_generated/runner.gd",
      "--vidot-test=res://kirie_vitest_generated/test-0.gd",
    ]);
    await expect(
      fs.readFile(path.join(staged.stagingPath, "test-0.gd"), "utf8"),
    ).resolves.toBe("const Probe = preload(\"res://src/probe.gd\")\n");
    expect(staged.filePaths.get("res://kirie_vitest_generated/test-0.gd")).toBe(testSource);
    await fs.rm(staged.stagingPath, { force: true, recursive: true });

    const fakeKirie = path.join(projectDir, "fake-kirie.mjs");
    const invocationsPath = path.join(projectDir, "kirie-calls.json");
    await fs.writeFile(
      fakeKirie,
      `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const callsFile = ${JSON.stringify(invocationsPath)};
const calls = existsSync(callsFile) ? JSON.parse(readFileSync(callsFile, "utf8")) : [];
calls.push({ argv: process.argv.slice(2), cwd: process.cwd() });
writeFileSync(callsFile, JSON.stringify(calls));
if (process.argv[2] === "run") {
  process.stdout.write('VIDOT {"type":"run_finish","file":"res://kirie_vitest_generated/test-0.gd"}\\n');
}
`,
    );
    await fs.chmod(fakeKirie, 0o755);

    await runLaunch(
      {
        args: ["--script", runnerSource, `--vidot-test=${testSource}`],
        projectPath: projectDir,
        target: "ios",
      },
      { kirieCommand: fakeKirie },
    );

    const calls = JSON.parse(await fs.readFile(invocationsPath, "utf8")) as Array<{
      argv: string[];
      cwd: string;
    }>;
    const realProjectDir = await fs.realpath(projectDir);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      argv: [
        "export",
        "ios",
        "--project",
        projectDir,
        "--no-build",
      ],
      cwd: realProjectDir,
    });
    expect(calls[1]?.argv.slice(0, 7)).toEqual([
      "run",
      "ios",
      "--project",
      projectDir,
      "--app",
      "dist/kirie/ios/debug.app",
      "--terminate-existing",
    ]);
    await expect(fs.access(path.join(projectDir, "kirie_vitest_generated"))).rejects.toThrow();
  });
});
