import { execa } from "execa";

const DOTNET_NO_PROJECT_ERROR = "MSB1003";

export interface BuildDotnetOptions {
  csproj?: string;
  projectDir: string;
  skipMissingProject?: boolean;
}

export async function buildDotnet(options: BuildDotnetOptions): Promise<void> {
  const args = options.csproj
    ? ["build", options.csproj]
    : ["build"];
  const result = await execa("dotnet", args, {
    all: true,
    cwd: options.projectDir,
    reject: false,
  });
  const output = result.all ?? "";

  if (result.exitCode === 0) {
    process.stdout.write(output);
    return;
  }

  if (options.skipMissingProject && output.includes(DOTNET_NO_PROJECT_ERROR)) {
    console.log("No .NET project found; skipping dotnet build.");
    return;
  }

  process.stdout.write(output);
  throw new Error("dotnet build failed.");
}
