using System.Diagnostics;
using System.Runtime.Loader;
using System.Xml.Linq;

namespace GdKirie.EventaAdapter.Tests;

public sealed class KirieClientBridgePackagingTests(
    KirieClientBridgePackagingTests.PackedAdapterFixture fixture)
    : IClassFixture<KirieClientBridgePackagingTests.PackedAdapterFixture>
{
    [Fact]
    public async Task ConsumerWithoutKirieClient_BuildsCleanlyWithoutBridgeTypes()
    {
        var projectDir = fixture.CreateScenarioDirectory("without-kirie-client");
        WriteFile(
            Path.Combine(projectDir, "ConsumerWithoutKirieClient.csproj"),
            $$"""
            <Project Sdk="Microsoft.NET.Sdk">
              <PropertyGroup>
                <TargetFramework>net10.0</TargetFramework>
                <ImplicitUsings>enable</ImplicitUsings>
                <Nullable>enable</Nullable>
                <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
              </PropertyGroup>
              <ItemGroup>
                <PackageReference Include="GdKirie.EventaAdapter" Version="{{PackedAdapterFixture.TestPackageVersion}}" />
              </ItemGroup>
            </Project>
            """);
        WriteFile(
            Path.Combine(projectDir, "ConsumerProbe.cs"),
            """
            using GdKirie.EventaAdapter;

            namespace ConsumerWithoutKirieClient;

            public static class ConsumerProbe
            {
                public static KirieEventaContextHandle Create(IKirieTextTransport transport)
                {
                    return KirieEventa.CreateContext(transport, new KirieEventaJsonRegistry());
                }
            }
            """);

        await fixture.RunDotnetAsync(
            ["build", Path.Combine(projectDir, "ConsumerWithoutKirieClient.csproj"), "-c", "Release"],
            TestContext.Current.CancellationToken);

        var assemblyPath = Path.Combine(projectDir, "bin", "Release", "net10.0", "ConsumerWithoutKirieClient.dll");
        AssertBridgeTypesAbsent(assemblyPath);
    }

    [Fact]
    public async Task ConsumerWithKirieClient_CompilesAndRunsCreateEventaContext()
    {
        var projectDir = fixture.CreateScenarioDirectory("with-kirie-client");
        WriteFile(
            Path.Combine(projectDir, "ConsumerWithKirieClient.csproj"),
            $$"""
            <Project Sdk="Microsoft.NET.Sdk">
              <PropertyGroup>
                <OutputType>Exe</OutputType>
                <TargetFramework>net10.0</TargetFramework>
                <ImplicitUsings>enable</ImplicitUsings>
                <Nullable>disable</Nullable>
                <GenerateDocumentationFile>true</GenerateDocumentationFile>
                <NoWarn>$(NoWarn);CS1591</NoWarn>
                <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
              </PropertyGroup>
              <ItemGroup>
                <PackageReference Include="GdKirie.EventaAdapter" Version="{{PackedAdapterFixture.TestPackageVersion}}" />
              </ItemGroup>
            </Project>
            """);
        WriteKirieClientStub(Path.Combine(projectDir, "addons", "kirie", "csharp", "KirieClient.cs"));
        WriteFile(
            Path.Combine(projectDir, "Program.cs"),
            """
            using System;
            using System.Text.Json.Serialization;
            using Eventa;
            using GdKirie.EventaAdapter;

            var ping = new EventDefinition<PingPayload>("bridge:ping");
            var registry = new KirieEventaJsonRegistry()
                .RegisterEvent(ping, BridgeJsonContext.Default.PingPayload);
            var client = new KirieClient();
            using var handle = client.CreateEventaContext(registry);

            PingPayload received = null;
            using var subscription = handle.Context.Subscribe(ping, envelope => received = envelope.Body);

            client.SimulateInbound("{\"type\":\"bridge:ping\",\"payload\":{\"body\":{\"value\":\"ok\"}}}");
            if (received?.Value != "ok")
            {
                throw new InvalidOperationException("Inbound KirieClient bridge dispatch failed.");
            }

            handle.Context.Emit(ping, new PingPayload("outbound"));
            if (client.LastSentMessage is null || !client.LastSentMessage.Contains("outbound", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Outbound KirieClient bridge send failed.");
            }

            internal sealed record PingPayload(string Value);

            [JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
            [JsonSerializable(typeof(PingPayload))]
            internal sealed partial class BridgeJsonContext : JsonSerializerContext;
            """);

        await fixture.RunDotnetAsync(
            ["run", "--project", Path.Combine(projectDir, "ConsumerWithKirieClient.csproj"), "-c", "Release"],
            TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task TransitiveConsumer_AppliesBridgePerProjectWithoutExcludeAssets()
    {
        var rootDir = fixture.CreateScenarioDirectory("transitive-consumer");
        var middleLibDir = Path.Combine(rootDir, "MiddleLib");
        var appDir = Path.Combine(rootDir, "App");

        WriteFile(
            Path.Combine(middleLibDir, "MiddleLib.csproj"),
            $$"""
            <Project Sdk="Microsoft.NET.Sdk">
              <PropertyGroup>
                <TargetFramework>net10.0</TargetFramework>
                <ImplicitUsings>enable</ImplicitUsings>
                <Nullable>enable</Nullable>
                <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
              </PropertyGroup>
              <ItemGroup>
                <PackageReference Include="GdKirie.EventaAdapter" Version="{{PackedAdapterFixture.TestPackageVersion}}" />
              </ItemGroup>
            </Project>
            """);
        WriteFile(
            Path.Combine(middleLibDir, "MiddleFeature.cs"),
            """
            using GdKirie.EventaAdapter;

            namespace MiddleLib;

            public static class MiddleFeature
            {
                public static KirieEventaJsonRegistry CreateRegistry() => new();
            }
            """);

        await fixture.RunDotnetAsync(
            [
                "pack",
                Path.Combine(middleLibDir, "MiddleLib.csproj"),
                "-c",
                "Release",
                "-o",
                fixture.FeedDirectory,
                $"-p:PackageVersion={PackedAdapterFixture.TestPackageVersion}",
            ],
            TestContext.Current.CancellationToken);
        AssertBridgeTypesAbsent(Path.Combine(middleLibDir, "bin", "Release", "net10.0", "MiddleLib.dll"));

        WriteFile(
            Path.Combine(appDir, "App.csproj"),
            $$"""
            <Project Sdk="Microsoft.NET.Sdk">
              <PropertyGroup>
                <TargetFramework>net10.0</TargetFramework>
                <ImplicitUsings>enable</ImplicitUsings>
                <Nullable>enable</Nullable>
                <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
              </PropertyGroup>
              <ItemGroup>
                <PackageReference Include="MiddleLib" Version="{{PackedAdapterFixture.TestPackageVersion}}" />
              </ItemGroup>
            </Project>
            """);
        WriteKirieClientStub(Path.Combine(appDir, "addons", "kirie", "csharp", "KirieClient.cs"));
        WriteFile(
            Path.Combine(appDir, "AppBootstrap.cs"),
            """
            using GdKirie.EventaAdapter;
            using MiddleLib;

            namespace App;

            public static class AppBootstrap
            {
                public static KirieEventaContextHandle Attach(global::KirieClient client)
                {
                    return client.CreateEventaContext(MiddleFeature.CreateRegistry());
                }
            }
            """);

        await fixture.RunDotnetAsync(
            ["build", Path.Combine(appDir, "App.csproj"), "-c", "Release"],
            TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task ExplicitDisableProperty_SkipsBridgeEvenWhenKirieClientExists()
    {
        var projectDir = fixture.CreateScenarioDirectory("explicit-disable");
        WriteFile(
            Path.Combine(projectDir, "ExplicitDisable.csproj"),
            $$"""
            <Project Sdk="Microsoft.NET.Sdk">
              <PropertyGroup>
                <TargetFramework>net10.0</TargetFramework>
                <ImplicitUsings>enable</ImplicitUsings>
                <Nullable>enable</Nullable>
                <EnableKirieClientEventaBridge>false</EnableKirieClientEventaBridge>
                <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
              </PropertyGroup>
              <ItemGroup>
                <Compile Remove="addons/**/*.cs" />
                <PackageReference Include="GdKirie.EventaAdapter" Version="{{PackedAdapterFixture.TestPackageVersion}}" />
              </ItemGroup>
            </Project>
            """);
        WriteKirieClientStub(Path.Combine(projectDir, "addons", "kirie", "csharp", "KirieClient.cs"));
        WriteFile(
            Path.Combine(projectDir, "DisabledProbe.cs"),
            """
            using GdKirie.EventaAdapter;

            namespace ExplicitDisable;

            public static class DisabledProbe
            {
                public static KirieEventaJsonRegistry CreateRegistry() => new();
            }
            """);

        await fixture.RunDotnetAsync(
            ["build", Path.Combine(projectDir, "ExplicitDisable.csproj"), "-c", "Release"],
            TestContext.Current.CancellationToken);

        AssertBridgeTypesAbsent(Path.Combine(projectDir, "bin", "Release", "net10.0", "ExplicitDisable.dll"));
    }

    private static void AssertBridgeTypesAbsent(string assemblyPath)
    {
        Assert.True(File.Exists(assemblyPath));
        var loadContext = new AssemblyLoadContext(name: null, isCollectible: true);
        try
        {
            var assembly = loadContext.LoadFromAssemblyPath(assemblyPath);
            Assert.Null(assembly.GetType("GdKirie.EventaAdapter.KirieClientTextTransport"));
            Assert.Null(assembly.GetType("GdKirie.EventaAdapter.KirieClientEventaExtensions"));
        }
        finally
        {
            loadContext.Unload();
        }
    }

    private static void WriteKirieClientStub(string path)
    {
        WriteFile(
            path,
            """
            #nullable enable
            using System;

            public partial class KirieClient
            {
                public event Action<string>? TextReceived;

                public string? LastSentMessage { get; private set; }

                public void SendText(string message)
                {
                    LastSentMessage = message;
                }

                public void SimulateInbound(string message)
                {
                    TextReceived?.Invoke(message);
                }
            }
            """);
    }

    private static void WriteFile(string path, string content)
    {
        var directory = Path.GetDirectoryName(path);
        if (directory is not null)
        {
            Directory.CreateDirectory(directory);
        }

        File.WriteAllText(path, content);
    }

    public sealed class PackedAdapterFixture : IAsyncLifetime
    {
        public const string TestPackageVersion = "0.0.0-packtest";

        private readonly string _rootDirectory = Path.Combine(
            Path.GetTempPath(),
            $"gdkirie-eventa-pack-{Guid.NewGuid():N}");
        private readonly string _feedDirectory;
        private readonly string _packagesDirectory;
        private readonly string _nugetConfigPath;
        private readonly string _dotnetExecutable;

        public string FeedDirectory => _feedDirectory;

        public PackedAdapterFixture()
        {
            _feedDirectory = Path.Combine(_rootDirectory, "feed");
            _packagesDirectory = Path.Combine(_rootDirectory, "packages");
            _nugetConfigPath = Path.Combine(_rootDirectory, "NuGet.Config");
            _dotnetExecutable = ResolveDotnetExecutable();
        }

        public async ValueTask InitializeAsync()
        {
            Directory.CreateDirectory(_feedDirectory);
            Directory.CreateDirectory(_packagesDirectory);
            WriteNuGetConfig(_nugetConfigPath, _feedDirectory, ResolveGlobalPackagesDirectory());

            var adapterCsproj = Path.Combine(
                ResolveRepositoryRoot(),
                "packages",
                "GdKirie.EventaAdapter",
                "GdKirie.EventaAdapter.csproj");
            await RunDotnetRawAsync(
                [
                    "pack",
                    adapterCsproj,
                    "-c",
                    "Release",
                    "-o",
                    _feedDirectory,
                    $"-p:PackageVersion={TestPackageVersion}",
                    "--nologo",
                ],
                CancellationToken.None);
        }

        public ValueTask DisposeAsync()
        {
            if (Directory.Exists(_rootDirectory))
            {
                Directory.Delete(_rootDirectory, recursive: true);
            }

            return ValueTask.CompletedTask;
        }

        public string CreateScenarioDirectory(string name)
        {
            var path = Path.Combine(_rootDirectory, "scenarios", name);
            Directory.CreateDirectory(path);
            return path;
        }

        public Task RunDotnetAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken)
        {
            List<string> fullArguments =
            [
                ..arguments,
                "--nologo",
                $"-p:RestoreConfigFile={_nugetConfigPath}",
                $"-p:RestorePackagesPath={_packagesDirectory}",
            ];
            return RunDotnetRawAsync(fullArguments, cancellationToken);
        }

        private async Task RunDotnetRawAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken)
        {
            var startInfo = new ProcessStartInfo(_dotnetExecutable)
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                WorkingDirectory = _rootDirectory,
            };
            startInfo.Environment["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1";
            startInfo.Environment["DOTNET_NOLOGO"] = "1";
            foreach (var argument in arguments)
            {
                startInfo.ArgumentList.Add(argument);
            }

            using var process = Process.Start(startInfo)
                ?? throw new InvalidOperationException("Failed to start dotnet CLI process.");
            var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);
            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            if (process.ExitCode != 0)
            {
                throw new Xunit.Sdk.XunitException(
                    $"dotnet {string.Join(' ', arguments)} failed with exit code {process.ExitCode}.{Environment.NewLine}STDOUT:{Environment.NewLine}{stdout}{Environment.NewLine}STDERR:{Environment.NewLine}{stderr}");
            }
        }

        private static void WriteNuGetConfig(string configPath, string feedDirectory, string globalPackagesDirectory)
        {
            var document = new XDocument(
                new XElement(
                    "configuration",
                    new XElement(
                        "packageSources",
                        new XElement("clear"),
                        new XElement("add", new XAttribute("key", "local-feed"), new XAttribute("value", feedDirectory)),
                        new XElement("add", new XAttribute("key", "global-cache"), new XAttribute("value", globalPackagesDirectory)))));
            document.Save(configPath);
        }

        private static string ResolveGlobalPackagesDirectory()
        {
            if (Environment.GetEnvironmentVariable("NUGET_PACKAGES") is { Length: > 0 } configuredPath
                && Directory.Exists(configuredPath))
            {
                return configuredPath;
            }

            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".nuget",
                "packages");
        }

        private static string ResolveDotnetExecutable()
        {
            if (Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") is { Length: > 0 } hostPath
                && File.Exists(hostPath))
            {
                return hostPath;
            }

            return "dotnet";
        }

        private static string ResolveRepositoryRoot()
        {
            var current = new DirectoryInfo(AppContext.BaseDirectory);
            while (current is not null)
            {
                var candidate = Path.Combine(
                    current.FullName,
                    "packages",
                    "GdKirie.EventaAdapter",
                    "GdKirie.EventaAdapter.csproj");
                if (File.Exists(candidate))
                {
                    return current.FullName;
                }

                current = current.Parent;
            }

            throw new InvalidOperationException(
                "Could not locate repository root containing packages/GdKirie.EventaAdapter/GdKirie.EventaAdapter.csproj.");
        }
    }
}
