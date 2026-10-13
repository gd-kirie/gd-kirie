import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

interface NativeTarget {
  fileName: string;
  rid: string;
}

const nativeTargets: Record<string, NativeTarget> = {
  "darwin-arm64": {
    fileName: "libkirie_tray_native.dylib",
    rid: "osx-arm64",
  },
  "darwin-x64": {
    fileName: "libkirie_tray_native.dylib",
    rid: "osx-x64",
  },
  "linux-arm64": {
    fileName: "libkirie_tray_native.so",
    rid: "linux-arm64",
  },
  "linux-x64": {
    fileName: "libkirie_tray_native.so",
    rid: "linux-x64",
  },
  "win32-arm64": {
    fileName: "kirie_tray_native.dll",
    rid: "win-arm64",
  },
  "win32-x64": {
    fileName: "kirie_tray_native.dll",
    rid: "win-x64",
  },
};

const rootDir = process.cwd();
const nativeDir = path.join(rootDir, "packages/GdKirie.Tray/native");

const target = nativeTargets[`${process.platform}-${process.arch}`];
if (!target) {
  throw new Error(`Unsupported tray native build host: ${process.platform}-${process.arch}`);
}

execFileSync(
  "cargo",
  [
    "build",
    "--manifest-path",
    path.join(nativeDir, "Cargo.toml"),
    "--target-dir",
    path.join(nativeDir, "target"),
    "--locked",
    "--release",
  ],
  { cwd: rootDir, stdio: "inherit" },
);

const source = path.join(nativeDir, "target/release", target.fileName);
const destinationDir = path.join(nativeDir, "artifacts", target.rid);
const destination = path.join(destinationDir, target.fileName);

mkdirSync(destinationDir, { recursive: true });
copyFileSync(source, destination);

console.log(`Built Tray GDExtension: ${path.relative(rootDir, destination)}`);
