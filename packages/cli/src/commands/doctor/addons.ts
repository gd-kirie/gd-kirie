import type { DownloadListenerHandle, DownloadSnapshot } from "takanawa-node";
import type { KirieGodotAddonDependency } from "../../plugin/index.ts";
import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

const PROGRESS_BAR_WIDTH = 24;

export interface AddonCheckResult {
  installed: boolean;
  message: string;
  valid: boolean;
}

export interface DownloadProgressOutput {
  columns?: number;
  isTTY?: boolean;
  write: (text: string) => unknown;
}

export interface InstallAddonOptions {
  addon: KirieGodotAddonDependency;
  download?: (options: DownloadFileOptions) => Promise<void>;
  extractArchive?: (archivePath: string, outputDir: string) => Promise<void>;
  output?: DownloadProgressOutput;
  projectDir: string;
}

interface DownloadFileOptions {
  expectedSha256?: string;
  output: DownloadProgressOutput;
  outputPath: string;
  url: string;
}

export async function checkGodotAddon(
  projectDir: string,
  addon: KirieGodotAddonDependency,
): Promise<AddonCheckResult> {
  const installDir = resolveAddonInstallPath(projectDir, addon.path);
  const installation = statSync(installDir, { throwIfNoEntry: false });
  if (!installation) {
    return { installed: false, message: "not installed", valid: false };
  }

  const source = addon.source;
  const versionMatches =
    !addon.version || source.type === "remote" ||
    await readAddonVersion(installDir) === addon.version;
  const checksumMatches =
    source.type !== "remote" ||
    await readAddonChecksum(projectDir, addon.id) === source.sha256;
  if (
    installation.isDirectory() &&
    versionMatches &&
    checksumMatches
  ) {
    return {
      installed: true,
      message: `${addon.version ?? "installed"} at ${installDir}`,
      valid: true,
    };
  }

  return {
    installed: true,
    message: `installation at ${installDir} does not match ${addon.version ?? addon.id}`,
    valid: false,
  };
}

export async function installGodotAddon(options: InstallAddonOptions): Promise<void> {
  const addon = options.addon;
  const projectDir = path.resolve(options.projectDir);
  assertGodotProject(projectDir);

  const current = await checkGodotAddon(projectDir, addon);
  if (current.installed && current.valid) {
    console.log(`${addon.id} is already installed: ${current.message}`);
    return;
  }

  const installDir = resolveAddonInstallPath(projectDir, addon.path);
  await fs.mkdir(path.dirname(installDir), { recursive: true });
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kirie-addon-"));
  const archivePath = path.join(temporaryRoot, "addon.zip");
  const extractDir = path.join(temporaryRoot, "extract");
  let extractedAddon: string;
  let stagingRoot: string | undefined;

  try {
    if (addon.source.type === "bundled") {
      extractedAddon = fileURLToPath(addon.source.url);
    } else {
      console.log(`Downloading ${addon.id} ${addon.version ?? ""} from ${addon.source.url}`);
      await (options.download ?? downloadFile)({
        expectedSha256: addon.source.sha256,
        output: options.output ?? process.stderr,
        outputPath: archivePath,
        url: addon.source.url,
      });

      await fs.mkdir(extractDir);
      await (options.extractArchive ?? extractZip)(archivePath, extractDir);
      extractedAddon = resolveProjectPath(extractDir, addon.source.archivePath);
    }

    const installation = await fs.stat(extractedAddon);
    if (!installation.isDirectory()) {
      throw new Error(`${addon.id} source is not a directory`);
    }

    if (addon.version && addon.source.type === "bundled") {
      const version = await readAddonVersion(extractedAddon);
      if (version !== addon.version) {
        throw new Error(
          `${addon.id} version ${version ?? "missing"} does not match ${addon.version}`,
        );
      }
    }

    stagingRoot = await fs.mkdtemp(path.join(path.dirname(projectDir), ".kirie-addon-stage-"));
    const stagedAddon = path.join(stagingRoot, "addon");
    await fs.cp(extractedAddon, stagedAddon, { recursive: true });
    const previousAddon = path.join(stagingRoot, "previous");
    if (current.installed) {
      await renameAddon(installDir, previousAddon);
    }
    let installed = false;
    try {
      await renameAddon(stagedAddon, installDir);
      installed = true;
    } finally {
      if (!installed && current.installed) {
        await renameAddon(previousAddon, installDir);
      }
    }
    if (addon.source.type === "remote") {
      const checksumPath = resolveAddonChecksumPath(projectDir, addon.id);
      await fs.mkdir(path.dirname(checksumPath), { recursive: true });
      await fs.writeFile(checksumPath, `${addon.source.sha256}\n`);
    }
  } finally {
    await Promise.all([
      fs.rm(temporaryRoot, { force: true, recursive: true }),
      stagingRoot ? fs.rm(stagingRoot, { force: true, recursive: true }) : Promise.resolve(),
    ]);
  }

  console.log(`Installed ${addon.id} ${addon.version ?? ""} at ${installDir}`);
}

async function readAddonVersion(directory: string): Promise<string | undefined> {
  const pluginPath = path.join(directory, "plugin.cfg");
  if (!existsSync(pluginPath)) {
    return undefined;
  }

  const plugin = await fs.readFile(pluginPath, "utf8");
  return /^\s*version\s*=\s*"([^"]+)"\s*$/m.exec(plugin)?.[1];
}

async function readAddonChecksum(projectDir: string, addonId: string): Promise<string | undefined> {
  const checksumPath = resolveAddonChecksumPath(projectDir, addonId);
  if (!existsSync(checksumPath)) {
    return undefined;
  }

  return (await fs.readFile(checksumPath, "utf8")).trim();
}

function resolveAddonChecksumPath(projectDir: string, addonId: string): string {
  return path.join(projectDir, ".godot", "kirie", `${encodeURIComponent(addonId)}.sha256`);
}

function resolveProjectPath(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolved;
  }

  throw new Error(`Path escapes its root: ${relativePath}`);
}

function resolveAddonInstallPath(projectDir: string, addonPath: string): string {
  const resolved = resolveProjectPath(projectDir, addonPath);
  if (resolved === path.resolve(projectDir)) {
    throw new Error("An addon cannot replace the Godot project root");
  }

  return resolved;
}

function formatDownloadProgress(
  downloadedBytes: number,
  totalBytes: number,
  speed: number,
): string {
  const downloaded = formatBytes(downloadedBytes);
  const speedText = `${formatBytes(speed)}/s`;
  if (totalBytes === 0) {
    return `${downloaded} ${speedText}`;
  }

  const progress = Math.min(downloadedBytes / totalBytes, 1);
  const completeWidth = Math.round(progress * PROGRESS_BAR_WIDTH);
  const bar = `${"=".repeat(completeWidth)}${" ".repeat(PROGRESS_BAR_WIDTH - completeWidth)}`;
  const percent = `${(progress * 100).toFixed(1)}%`.padStart(6);
  return `[${bar}] ${percent} ${speedText} ${downloaded}/${formatBytes(totalBytes)}`;
}

async function downloadFile(options: DownloadFileOptions): Promise<void> {
  // Load the native addon only for the fixer so unsupported hosts can still use other CLI commands.
  const { DownloadTask, TakanawaError, TakanawaStatus } = await import("takanawa-node");
  const task = new DownloadTask({
    hash: options.expectedSha256 ?
        {
          expected: options.expectedSha256,
          kind: "sha256",
        } :
      undefined,
    targetPath: options.outputPath,
    url: options.url,
  });

  let speed = 0;
  let lastProgressLength = 0;
  let progressListener: DownloadListenerHandle | undefined;
  let speedListener: DownloadListenerHandle | undefined;
  let resolveCompletion!: (snapshot: DownloadSnapshot) => void;
  let rejectCompletion!: (error: Error) => void;
  const completion = new Promise<DownloadSnapshot>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  let completed = false;
  try {
    progressListener = await task.addProgressListener((snapshot) => {
      lastProgressLength = writeDownloadProgress(
        options.output,
        Number(snapshot.downloadedBytes),
        Number(snapshot.contentLen),
        speed,
        lastProgressLength,
      );

      if (snapshot.phase === "completed") {
        resolveCompletion(snapshot);
      } else if (snapshot.phase === "failed") {
        const message =
          snapshot.lastErrorCode === TakanawaStatus.HashMismatch ?
            `Addon checksum mismatch: expected ${options.expectedSha256}` :
              (snapshot.lastError ?? "Takanawa download failed");
        rejectCompletion(new TakanawaError(message, snapshot.lastErrorCode));
      }
    });
    speedListener = await task.addSpeedListener((snapshot) => {
      speed = snapshot.bytesPerSecond;
      lastProgressLength = writeDownloadProgress(
        options.output,
        Number(snapshot.receivedBytes),
        Number(snapshot.contentLen),
        speed,
        lastProgressLength,
      );
    });

    await task.start();
    const snapshot = await completion;
    writeDownloadProgress(
      options.output,
      Number(snapshot.downloadedBytes),
      Number(snapshot.contentLen),
      speed,
      lastProgressLength,
      true,
    );
    completed = true;
  } finally {
    if (!completed && options.output.isTTY && lastProgressLength > 0) {
      options.output.write("\n");
    }
    await Promise.all([progressListener?.remove(), speedListener?.remove(), task.close()]);
  }
}

function writeDownloadProgress(
  output: DownloadProgressOutput,
  downloadedBytes: number,
  totalBytes: number,
  speed: number,
  previousLength: number,
  complete: boolean = false,
): number {
  const progress = formatDownloadProgress(downloadedBytes, totalBytes, speed);
  if (!output.isTTY) {
    if (complete) {
      output.write(`Downloaded ${progress}\n`);
    }
    return progress.length;
  }

  const availableWidth = Math.max((output.columns ?? 80) - 1, 1);
  const line = progress.slice(0, availableWidth);
  output.write(
    `\r${line}${" ".repeat(Math.max(previousLength - line.length, 0))}${complete ? "\n" : ""}`,
  );
  return line.length;
}

async function extractZip(archivePath: string, outputDir: string): Promise<void> {
  if (process.platform === "win32") {
    const tarExecutable = path.join(process.env.SystemRoot!, "System32", "tar.exe");
    await execa(tarExecutable, ["-xf", archivePath, "-C", outputDir], { stdio: "inherit" });
    return;
  }

  await execa("unzip", ["-q", archivePath, "-d", outputDir], { stdio: "inherit" });
}

function assertGodotProject(projectDir: string): void {
  const projectStat = statSync(path.join(projectDir, "project.godot"), { throwIfNoEntry: false });
  if (projectStat?.isFile()) {
    return;
  }

  throw new Error(`Godot project not found: ${projectDir}`);
}

function formatBytes(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024);
  return `${mebibytes.toFixed(1)} MiB`;
}

async function renameAddon(source: string, destination: string): Promise<void> {
  // NOTICE:
  // Windows file scanners can hold newly copied native binaries.
  // The lock makes fs.rename fail with EPERM, EACCES, or EBUSY.
  // Context: https://github.com/isaacs/node-graceful-fs/blob/main/polyfills.js
  // Remove this retry only if Node handles transient Windows rename errors.
  const retryStartedAt = Date.now();
  let retryDelay = 0;

  for (;;) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      const canRetry =
        process.platform === "win32" &&
        Date.now() - retryStartedAt < 60_000 &&
        isNodeError(error) &&
        (error.code === "EACCES" || error.code === "EBUSY" || error.code === "EPERM");
      if (!canRetry) {
        throw error;
      }

      retryDelay = Math.min(retryDelay + 10, 100);
      await delay(retryDelay);
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
