import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runBuild, runBuildDotnet, runBuildWeb } from "./build.ts";
import { createBasicKirieCliProjectTracker, installKirieConfigFixture } from "./test-project.ts";

const projects = createBasicKirieCliProjectTracker("kirie-cli-build-");

afterEach(async () => {
  await projects.cleanup();
});

describe("runBuildWeb", () => {
  it("builds the Vite web output into src-web/dist", async () => {
    const project = await projects.copy();

    await runBuildWeb({ cwd: project });

    await expect(fs.access(path.join(project, "src-web", "dist", "index.html"))).resolves.toBe(
      undefined,
    );
  });

  it("rejects Kirie-owned Vite build options", async () => {
    const project = await projects.copy();
    await installKirieConfigFixture(project, "build-owned-out-dir.kirie.config.ts");

    // TODO: Revisit whether `build.outDir` should be configurable once the
    // packaged resource layout is settled.
    await expect(runBuildWeb({ cwd: project })).rejects.toThrow(
      "web.vite.build.outDir is owned by Kirie",
    );
  });

  it("loads kirie.config.ts with Vite build command context", async () => {
    const project = await projects.copy();
    await installKirieConfigFixture(project, "build-context.kirie.config.ts");

    await runBuildWeb({ cwd: project });

    const assets = await fs.readdir(path.join(project, "src-web", "dist", "assets"));

    expect(assets.some((asset) => asset.endsWith(".js.map"))).toBe(true);
  });
});

describe("runBuild", () => {
  it("skips dotnet when dotnet reports no project or solution", async () => {
    const project = await projects.copy();

    await runBuild({ cwd: project });

    await expect(fs.access(path.join(project, "src-web", "dist", "index.html"))).resolves.toBe(
      undefined,
    );
  });
});

describe("runBuildDotnet", () => {
  it("builds a discovered .NET project", async () => {
    const project = await projects.copy();
    await fs.writeFile(
      path.join(project, "Example.csproj"),
      `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>
</Project>
`,
    );

    await runBuildDotnet({ cwd: project });

    await expect(fs.access(path.join(project, "bin", "Debug", "net10.0"))).resolves.toBe(undefined);
  });

  it("fails when dotnet reports no project or solution", async () => {
    const project = await projects.copy();

    await expect(runBuildDotnet({ cwd: project })).rejects.toThrow("dotnet build failed");
  });
});
