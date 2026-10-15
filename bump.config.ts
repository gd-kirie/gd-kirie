import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "bumpp";

export default defineConfig({
  all: true,
  commit: "release: v%s",
  files: [
    "package.json",
    "packages/*/package.json",
    "tests/*/src-web/package.json",
  ],
  execute: (operation) => {
    const releaseVersions = [
      {
        file: "packages/GdKirie.EventaAdapter/GdKirie.EventaAdapter.csproj",
        pattern: /<Version>[^<]+<\/Version>/,
        replacement: `<Version>${operation.state.newVersion}</Version>`,
      },
      {
        file: "packages/GdKirie.Platform/GdKirie.Platform.csproj",
        pattern: /<Version>[^<]+<\/Version>/,
        replacement: `<Version>${operation.state.newVersion}</Version>`,
      },
      {
        file: "packages/kirie/addon/addons/kirie/plugin.cfg",
        pattern: /version="[^"]+"/,
        replacement: `version="${operation.state.newVersion}"`,
      },
      {
        file: "packages/kirie/native/ios/Kirie/project.yml",
        pattern: /MARKETING_VERSION: \S+/,
        replacement: `MARKETING_VERSION: ${operation.state.newVersion}`,
      },
    ];

    for (const { file, pattern, replacement } of releaseVersions) {
      const path = resolve(operation.options.cwd, file);
      const source = readFileSync(path, "utf8");
      const updated = source.replace(pattern, replacement);

      if (updated === source) {
        throw new Error(`Failed to update the release version in ${file}`);
      }

      writeFileSync(path, updated);
    }

    execFileSync("pnpm", ["run", "build:packages"], {
      cwd: operation.options.cwd,
      stdio: "inherit",
    });
    execFileSync("pnpm", ["publish", "-r", "--access", "public", "--no-git-checks", "--dry-run"], {
      cwd: operation.options.cwd,
      stdio: "inherit",
    });
  },
  push: false,
  sign: false,
  tag: "v",
});
