# GdKirie.EventaAdapter

`GdKirie.EventaAdapter` connects C# projects to `@moeru/eventa` over Kirie text IPC. This package targets `net10.0` only because the upstream `Eventa` package targets `net10.0`. Projects that target `net8.0` or `net9.0` fail during restore or build when they reference this package.

## Usage

1. Create a `KirieEventaJsonRegistry` instance in your Godot C# project.
2. Register each event or unary invoke payload with `System.Text.Json` source-generated metadata.
3. Call `KirieEventa.CreateContext(...)` with an `IKirieTextTransport` implementation.

The NuGet package ships `build` and `buildTransitive` MSBuild targets in `GdKirie.EventaAdapter.targets`. When `addons/kirie/csharp/KirieClient.cs` exists in a direct or transitive consumer project, MSBuild compiles `KirieClientEventaBridge.cs` automatically. That source bridge adds `KirieClientTextTransport` and `KirieClient.CreateEventaContext(...)`. WebView-free projects without `KirieClient.cs` skip the bridge automatically, and setting `EnableKirieClientEventaBridge` to `true` or `false` overrides detection.

Repository projects that use `ProjectReference` instead of the packed NuGet package do not import NuGet MSBuild targets automatically. Add the source bridge item explicitly when the project also includes `KirieClient.cs`:

```xml
<Compile
  Include="../../packages/GdKirie.EventaAdapter/content/KirieClientEventaBridge.cs"
  Link="KirieClientEventaBridge.cs"
  Visible="false" />
```

The adapter serializes Eventa messages as JSON text over the Kirie text IPC lane. Kirie core remains a low-level WebView and IPC bridge without Eventa rules.
