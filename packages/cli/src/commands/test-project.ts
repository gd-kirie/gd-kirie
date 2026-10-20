import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliTestFixturesDir = fileURLToPath(import.meta.resolve("../../test-fixtures"));
const kirieAddonDir = fileURLToPath(import.meta.resolve("../../../kirie/addon/addons/kirie"));
const repositoryTmpDir = fileURLToPath(import.meta.resolve("../../../../.tmp"));
const godotCefSha256 = "c302d6dfd34729538c043fab5d6ff3affea7e7f76bb51691bd87381d1fee8e26";

async function copyCliProject(prefix: string): Promise<string> {
  await fs.mkdir(repositoryTmpDir, { recursive: true });
  const project = await fs.mkdtemp(path.join(repositoryTmpDir, prefix));
  await fs.cp(path.join(cliTestFixturesDir, "project"), project, {
    recursive: true,
  });
  await fs.cp(kirieAddonDir, path.join(project, "addons", "kirie"), { recursive: true });

  return project;
}

export function createCliProjectTracker(prefix: string): {
  cleanup: () => Promise<void>;
  copy: () => Promise<string>;
} {
  const projects: string[] = [];

  return {
    async copy() {
      const project = await copyCliProject(prefix);
      projects.push(project);
      return project;
    },
    async cleanup() {
      await Promise.all(
        projects.splice(0).map((project) => fs.rm(project, { force: true, recursive: true })),
      );
    },
  };
}

export async function installKirieConfigFixture(
  project: string,
  fixtureName: string,
): Promise<void> {
  await installProjectFixture(project, fixtureName, "kirie.config.ts");
}

export async function installGodotCefFixture(project: string): Promise<void> {
  const addonDir = path.join(project, "addons", "godot_cef");
  await fs.mkdir(addonDir, { recursive: true });
  await fs.writeFile(path.join(addonDir, "godot_cef.gdextension"), "[configuration]\n");

  const cacheDir = path.join(project, ".godot", "kirie");
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(path.join(cacheDir, "godot-cef.sha256"), `${godotCefSha256}\n`);
}

export async function installProjectFixture(
  project: string,
  fixtureName: string,
  outputName: string = fixtureName,
): Promise<void> {
  await fs.copyFile(path.join(cliTestFixturesDir, fixtureName), path.join(project, outputName));
}
