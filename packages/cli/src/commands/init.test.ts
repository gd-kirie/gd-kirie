import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runInit } from "./init.ts";

let includeIndexHtml = true;

vi.mock("giget", () => ({
  downloadTemplate: vi.fn(async (_source: string, options: { dir: string }) => {
    await fs.writeFile(
      path.join(options.dir, "package.json"),
      "{\"name\":\"template\",\"private\":true}\n",
    );
    await fs.writeFile(path.join(options.dir, "project.godot"), "config_version=5\n");
    if (includeIndexHtml) {
      await fs.mkdir(path.join(options.dir, "src-web"));
      await fs.writeFile(
        path.join(options.dir, "src-web", "index.html"),
        "<title>Template</title>\n",
      );
    }
  }),
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  includeIndexHtml = true;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("runInit", () => {
  it("creates a template project when addon releases are unavailable and directs users to doctor", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "kirie-init-test-"));
    temporaryDirectories.push(cwd);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Addon releases are unavailable")));
    const output = vi.spyOn(console, "log").mockImplementation(() => {});

    await runInit({ cwd, target: "My Kirie App", template: "basic" });

    const project = path.join(cwd, "My Kirie App");
    await expect(fs.readFile(path.join(project, "project.godot"), "utf8")).resolves.toContain(
      "config_version=5",
    );
    const packageJson = JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8"));
    expect(packageJson).toEqual({ name: "my-kirie-app", private: true });
    await expect(
      fs.readFile(path.join(project, "src-web", "index.html"), "utf8"),
    ).resolves.toContain("<title>My Kirie App</title>");
    await expect(fs.stat(path.join(project, "addons", "kirie"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(output).toHaveBeenCalledWith("  pnpm kirie doctor --fix");
  });

  it("initializes WebView-less templates without src-web/index.html", async () => {
    includeIndexHtml = false;
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "kirie-init-test-"));
    temporaryDirectories.push(cwd);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Addon releases are unavailable")));
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runInit({ cwd, target: "Native Host Card", template: "native-host" });

    const project = path.join(cwd, "Native Host Card");
    await expect(fs.readFile(path.join(project, "project.godot"), "utf8")).resolves.toContain(
      "config_version=5",
    );
    await expect(fs.stat(path.join(project, "src-web"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
