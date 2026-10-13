import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import cliPackage from "../packages/cli/package.json" with { type: "json" };
import trayPackage from "../packages/tray/package.json" with { type: "json" };

if (process.platform !== "darwin") {
  throw new Error("The installed Tray consumer export test currently supports macOS only.");
}

const waitMenu = process.argv.slice(2).includes("--wait-menu");
const root = fileURLToPath(new URL("..", import.meta.url));
const testRoot = path.join(root, "dist/tray-consumer");
const project = await fs.mkdtemp(path.join(os.tmpdir(), "kirie-tray-consumer-"));
const feed = path.join(testRoot, "feed");
const packageVersion = `${trayPackage.version}-gdextension-test.${Date.now()}`;

console.log(`Tray consumer project: ${project}`);

try {
  await fs.rm(testRoot, { force: true, recursive: true });
  await fs.mkdir(feed, { recursive: true });
  await fs.cp(path.join(root, "tests/tray-consumer"), project, { recursive: true });

  for (const file of ["TrayConsumer.csproj", "package.json", "kirie.config.ts", "export_presets.cfg", "NuGet.Config"]) {
    const destination = path.join(project, file);
    const source = await fs.readFile(destination, "utf8");
    await fs.writeFile(
      destination,
      source
        .replaceAll("@TEST_VERSION@", packageVersion)
        .replaceAll("@KIRIE_VERSION@", cliPackage.version)
        .replaceAll("@TEST_FEED@", feed)
        .replaceAll("@TEST_TRAY_PACKAGE@", path.join(testRoot, "gd-kirie-tray.tgz"))
        .replaceAll("@ARCHITECTURE@", process.arch === "arm64" ? "arm64" : "x86_64"),
    );
  }

  await execa("pnpm", ["-C", "packages/tray", "run", "build"], { cwd: root, stdio: "inherit", timeout: 60_000 });
  await execa("pnpm", ["-C", "packages/tray", "pack", "--out", path.join(testRoot, "gd-kirie-tray.tgz")], {
    cwd: root,
    stdio: "inherit",
    timeout: 60_000,
  });

  for (const name of ["GdKirie.EventaAdapter", "GdKirie.Tray"]) {
    await execa(
      "dotnet",
      ["pack", `packages/${name}/${name}.csproj`, "--configuration", "Release", `-p:Version=${packageVersion}`, "--output", feed],
      { cwd: root, stdio: "inherit", timeout: 180_000 },
    );
  }

  await execa("pnpm", ["install"], { cwd: project, stdio: "inherit", timeout: 180_000 });
  await fs.writeFile(path.join(project, "node_modules/.gdignore"), "");
  await execa("pnpm", ["exec", "kirie", "doctor", "--fix", "plugin:tray"], {
    cwd: project,
    stdio: "inherit",
    timeout: 180_000,
  });
  await execa("godot", ["--headless", "--path", project, "--import"], {
    stdio: "inherit",
    timeout: 60_000,
  });
  await execa("dotnet", ["build", path.join(project, "TrayConsumer.csproj")], {
    stdio: "inherit",
    timeout: 180_000,
  });
  await runConsumer("godot", ["--path", project], 60_000);

  const app = path.join(testRoot, "TrayConsumer.app");
  await execa("godot", ["--headless", "--path", project, "--export-debug", "macOS", app], {
    stdio: "inherit",
    timeout: 180_000,
  });
  await runConsumer(
    path.join(app, "Contents/MacOS/TrayConsumer"),
    waitMenu ? ["--", "--wait-menu"] : [],
    waitMenu ? 240_000 : 60_000,
  );

  console.log("Installed Tray consumer and exported application passed.");
} finally {
  await fs.rm(project, { force: true, recursive: true });
}

async function runConsumer(command: string, args: string[], timeout: number): Promise<void> {
  const { stdout } = await execa(command, args, {
    stdout: ["pipe", "inherit"],
    stderr: "inherit",
    timeout,
  });

  if (!stdout.includes("[Tray consumer] PASS")) {
    throw new Error("The Tray consumer exited without completing its checks.");
  }
}
