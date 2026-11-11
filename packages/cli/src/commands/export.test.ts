import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyViteWebOutput } from "@gd-kirie/build";
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
  it("accepts --project and forwards active plugin + web-dist + user args from the CLI command", async () => {
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
        "--kirie-android-maven-local",
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
        "--kirie-plugins=core,webview",
        `--kirie-web-dist=${path.join(project, "src-web", "dist")}`,
        "--kirie-android-maven-local",
      ],
      cwd: realProject,
      env: {},
    });
    await expect(fs.access(path.join(project, "src-web", "dist"))).rejects.toThrow();
  });

  it("supports kirie export desktop and fails fast on undeclared targets", async () => {
    const project = await projects.copy();
    const outputPath = path.join(project, "dist", "desktop", "MyApp.app");

    await installProjectFixture(project, "fake-godot.js");
    const existingPresets = await fs.readFile(path.join(project, "export_presets.cfg"), "utf8");
    await fs.writeFile(
      path.join(project, "export_presets.cfg"),
      `${existingPresets}\n[preset.2]\n\nname="macOS"\nplatform="macOS"\n\n[preset.2.options]\n`,
    );
    await fs.writeFile(
      path.join(project, "kirie.config.ts"),
      `import core from "kirie/plugin/core";
export default {
  godot: {
    args: ["fake-godot.js"],
    command: process.execPath,
  },
  plugins: [core],
  targets: {
    desktop: { host: "godot" },
  },
};
`,
    );

    await execa(
      process.execPath,
      [
        cliPath,
        "export",
        "desktop",
        "--project",
        project,
        "--no-build",
        "--output",
        outputPath,
      ],
      {
        cwd: path.dirname(project),
        stdio: "inherit",
      },
    );

    const [exportRun] = await readFakeGodotInvocations(project);
    expect(exportRun.argv).toEqual([
      "--headless",
      "--path",
      project,
      "--export-debug",
      "macOS",
      outputPath,
      "--",
      "--kirie-plugins=core",
    ]);

    const undeclared = await execa(
      process.execPath,
      [
        cliPath,
        "export",
        "android",
        "--project",
        project,
        "--no-build",
      ],
      {
        cwd: path.dirname(project),
        reject: false,
      },
    );
    expect(undeclared.exitCode).toBe(1);
    expect(undeclared.stderr).toContain("kirie export cannot target \"android\"");
  });

  it("builds and copies Web content beside the Web export", async () => {
    const project = await projects.copy();
    const outputPath = path.join(project, "dist", "web", "app.html");

    await installProjectFixture(project, "fake-godot.js");
    await installProjectFixture(project, "dev-fake-godot.kirie.config.ts", "kirie.config.ts");

    await execa(
      process.execPath,
      [
        cliPath,
        "export",
        "web",
        "--project",
        project,
        "--output",
        outputPath,
      ],
      {
        cwd: path.dirname(project),
        stdio: "inherit",
      },
    );

    const [exportRun] = await readFakeGodotInvocations(project);
    expect(exportRun.argv).toEqual([
      "--headless",
      "--path",
      project,
      "--export-debug",
      "Web",
      outputPath,
      "--",
      "--kirie-plugins=core,webview",
      `--kirie-web-dist=${path.join(project, "src-web", "dist")}`,
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
      [
        cliPath,
        "export",
        "web",
        "--project",
        project,
        "--no-build",
      ],
      {
        cwd: path.dirname(project),
        reject: false,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Kirie Web export requires");
    expect(result.stderr).toContain("Run kirie build web or remove --no-build");
    await expect(fs.access(path.join(project, FAKE_GODOT_INVOCATIONS_FILE))).rejects.toThrow();
  });

  it("exports self-contained iOS embed artifacts in host: native Artifact mode", async () => {
    const project = await projects.copy();
    const fakeGodotPath = path.join(project, "fake-ios-embed-godot.js");
    await fs.writeFile(
      fakeGodotPath,
      `import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const exportIndex = process.argv.findIndex((arg) => arg.startsWith("--export-"));
const xcodeprojPath = process.argv[exportIndex + 2];
const rawDir = dirname(xcodeprojPath);
mkdirSync(xcodeprojPath, { recursive: true });
mkdirSync(join(rawDir, "MoltenVK.xcframework"), { recursive: true });
mkdirSync(join(rawDir, "libgodot.xcframework", "ios-arm64"), { recursive: true });
writeFileSync(join(rawDir, "libgodot.xcframework", "Info.plist"), "<plist/>");
writeFileSync(join(rawDir, "libgodot.xcframework", "ios-arm64", "libgodot.a"), "LIB");
writeFileSync(join(rawDir, "app.pck"), "PCK");
`,
    );
    await fs.writeFile(
      path.join(project, "kirie.config.ts"),
      `import core from "kirie/plugin/core";
export default {
  godot: {
    args: ["fake-ios-embed-godot.js"],
    command: process.execPath,
  },
  plugins: [core],
  targets: {
    ios: { host: "native" },
  },
};
`,
    );

    await execa(
      process.execPath,
      [
        cliPath,
        "export",
        "ios",
        "--project",
        project,
        "--no-build",
      ],
      {
        cwd: path.dirname(project),
        stdio: "inherit",
      },
    );

    const artifactDir = path.join(project, "dist", "kirie", "ios", "debug");
    const manifest = JSON.parse(
      await fs.readFile(path.join(artifactDir, "embed-manifest.json"), "utf8"),
    ) as { frameworks: string[]; pckFile: string; sources: string[]; xcconfig: string };

    expect(manifest.frameworks).toEqual(["Frameworks/libgodot.xcframework"]);
    expect(manifest.pckFile).toBe("Resources/app.pck");
    expect(manifest.xcconfig).toBe("KirieEmbed.xcconfig");
    expect(manifest.sources).toContain("Sources/KirieHostBridge.mm");
    expect(manifest.sources).toContain("Sources/KirieGodotView.swift");
    await expect(
      fs.access(path.join(artifactDir, "Frameworks", "MoltenVK.xcframework")),
    ).rejects.toThrow();
  });

  it("exports Android host: native Artifact and App modes without touching <godot.project>/android/build", async () => {
    const project = await projects.copy();
    const sourceTemplateRoot = path.join(project, "fake-android-template");
    const sourceZipPath = path.join(project, "fake-android-source.zip");
    const fakeAarStage = path.join(project, "fake-godot-lib-aar-stage");
    await fs.mkdir(path.join(fakeAarStage, "jni", "arm64-v8a"), { recursive: true });
    await fs.writeFile(path.join(fakeAarStage, "jni", "arm64-v8a", "libgodot_android.so"), "SO");
    await fs.mkdir(path.join(sourceTemplateRoot, "libs", "debug"), { recursive: true });
    execFileSync(
      "zip",
      [
        "-rq",
        path.join(sourceTemplateRoot, "libs", "debug", "godot-lib.template_debug.aar"),
        ".",
      ],
      { cwd: fakeAarStage },
    );
    await fs.mkdir(path.join(sourceTemplateRoot, "src", "main"), { recursive: true });
    await fs.writeFile(
      path.join(sourceTemplateRoot, "build.gradle"),
      "plugins {\n    id 'com.android.application'\n}\nandroid {\n    namespace 'com.godot.game'\n    defaultConfig {\n        applicationId 'com.godot.game'\n    }\n}\n",
    );
    await fs.writeFile(
      path.join(sourceTemplateRoot, "src", "main", "AndroidManifest.xml"),
      "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">\n  <application>\n  </application>\n</manifest>\n",
    );
    const fakeGradlew = `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const outDir = join(process.cwd(), "build", "outputs", "aar");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "godot-embed-debug.aar"), "FAKE_AAR");
`;
    await fs.writeFile(path.join(sourceTemplateRoot, "gradlew"), fakeGradlew);
    await fs.chmod(path.join(sourceTemplateRoot, "gradlew"), 0o755);
    execFileSync("zip", ["-rq", sourceZipPath, "."], { cwd: sourceTemplateRoot });

    await fs.writeFile(
      path.join(project, "fake-android-godot.js"),
      `import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
if (process.argv.includes("--version")) {
  console.log("4.7.2.stable");
  process.exit(0);
}
const pckIndex = process.argv.indexOf("--export-pack");
if (pckIndex >= 0) {
  const out = process.argv[pckIndex + 2];
  mkdirSync(dirname(out), { recursive: true });
  const stage = mkdtempSync(join(tmpdir(), "fake-godot-assets-"));
  writeFileSync(join(stage, "project.godot"), "config_version=5\\n");
  execFileSync("zip", ["-rq", out, "."], { cwd: stage });
  rmSync(stage, { force: true, recursive: true });
}
`,
    );

    // 1. Artifact mode (no project)
    await fs.writeFile(
      path.join(project, "kirie.config.ts"),
      `import core from "kirie/plugin/core";
export default {
  godot: {
    args: ["fake-android-godot.js"],
    command: process.execPath,
  },
  plugins: [core],
  targets: {
    android: { host: "native" },
  },
};
`,
    );

    await execa(
      process.execPath,
      [
        cliPath,
        "export",
        "android",
        "--project",
        project,
        "--no-build",
      ],
      {
        cwd: path.dirname(project),
        env: {
          ...process.env,
          KIRIE_ANDROID_SOURCE_ZIP: sourceZipPath,
        },
        stdio: "inherit",
      },
    );

    const artifactDir = path.join(project, "dist", "kirie", "android", "debug");
    await expect(
      fs.readFile(path.join(artifactDir, "godot-embed-debug.aar"), "utf8"),
    ).resolves.toBe("FAKE_AAR");
    await expect(
      fs.access(path.join(artifactDir, "Sources", "KirieGodotFragment.kt")),
    ).resolves.toBe(undefined);
    await expect(fs.access(path.join(project, "android", "build"))).rejects.toThrow();

    // 2. App mode (project set)
    const hostAppDir = path.join(project, "android-host");
    await fs.mkdir(path.join(hostAppDir, "app"), { recursive: true });
    await fs.writeFile(
      path.join(hostAppDir, "gradlew"),
      `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const apkDir = join(process.cwd(), "app", "build", "outputs", "apk", "debug");
mkdirSync(apkDir, { recursive: true });
writeFileSync(join(apkDir, "app-debug.apk"), "NATIVE_HOST_APK");
`,
    );
    await fs.chmod(path.join(hostAppDir, "gradlew"), 0o755);

    await fs.writeFile(
      path.join(project, "kirie.config.ts"),
      `import core from "kirie/plugin/core";
export default {
  godot: {
    args: ["fake-android-godot.js"],
    command: process.execPath,
  },
  plugins: [core],
  targets: {
    android: {
      host: "native",
      module: ":app",
      project: "./android-host",
    },
  },
};
`,
    );

    await execa(
      process.execPath,
      [
        cliPath,
        "export",
        "android",
        "--project",
        project,
        "--no-build",
      ],
      {
        cwd: path.dirname(project),
        env: {
          ...process.env,
          KIRIE_ANDROID_SOURCE_ZIP: sourceZipPath,
        },
        stdio: "inherit",
      },
    );

    await expect(
      fs.readFile(path.join(project, "dist", "kirie", "android", "debug.apk"), "utf8"),
    ).resolves.toBe("NATIVE_HOST_APK");
    await expect(fs.access(path.join(project, "android", "build"))).rejects.toThrow();
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
