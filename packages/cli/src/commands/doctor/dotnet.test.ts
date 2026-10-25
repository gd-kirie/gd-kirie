import { describe, expect, it } from "vitest";

import { getDotnetDependencyReference, installDotnetPackage } from "./dotnet.ts";

const dependency = { id: "Example.Package", version: "2.0.0" };

describe("dotnet package doctor support", () => {
  it("reads a centrally managed package version from evaluated MSBuild items", async () => {
    const reference = await getDotnetDependencyReference({
      dependency,
      projectDir: "/project",
      runDotnet: async (args, cwd) => {
        expect(args).toEqual([
          "msbuild",
          "app.csproj",
          "-getProperty:MSBuildProjectDirectory",
          "-getItem:PackageReference,PackageVersion,ProjectReference",
        ]);
        expect(cwd).toBe("/project");
        return JSON.stringify({
          Items: {
            PackageReference: [
              { Identity: "example.package" },
            ],
            PackageVersion: [
              { Identity: "Example.Package", Version: "2.0.0" },
            ],
          },
        });
      },
      csproj: "app.csproj",
    });

    expect(reference).toEqual({ type: "package", version: "2.0.0" });
  });

  it("accepts a matching local project reference", async () => {
    const reference = await getDotnetDependencyReference({
      dependency,
      projectDir: "/project",
      runDotnet: async (args) => {
        if (args.includes("-getProperty:PackageId")) {
          return "Example.Package";
        }

        return JSON.stringify({
          Items: {
            ProjectReference: [
              { Identity: "../Example.Package/Example.Package.csproj" },
            ],
          },
          Properties: {
            MSBuildProjectDirectory: "/project",
          },
        });
      },
    });

    expect(reference).toEqual({
      path: "../Example.Package/Example.Package.csproj",
      type: "project",
    });
  });

  it("delegates package updates to the dotnet CLI", async () => {
    let invocation: { args: string[]; cwd: string } | undefined;

    await installDotnetPackage({
      dependency,
      projectDir: "/project",
      runDotnet: async (args, cwd) => {
        invocation = { args, cwd };
        return "";
      },
      csproj: "app.csproj",
    });

    expect(invocation).toEqual({
      args: [
        "package",
        "add",
        "Example.Package",
        "--version",
        "2.0.0",
        "--project",
        "app.csproj",
      ],
      cwd: "/project",
    });
  });
});
