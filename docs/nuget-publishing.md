# NuGet Publishing

This lane publishes
[`GdKirie.EventaAdapter`](../packages/GdKirie.EventaAdapter/README.md) and
[`GdKirie.Platform`](../packages/GdKirie.Platform/README.md), and
[`GdKirie.Notifications`](../packages/GdKirie.Notifications/README.md), and
[`GdKirie.Tray`](../packages/GdKirie.Tray/README.md). It is separate from addon
zip publishing and JavaScript/TypeScript npm publishing.

All four packages target `net10.0` because the upstream Eventa .NET package
targets `net10.0`. Projects targeting `net8.0` or `net9.0` should expect
restore or build failures when referencing the adapter. .NET 8 LTS reaches end
of support on 2026-11-10, so Kirie does not add a compatibility layer that
copies Eventa protocol logic around the upstream target framework.

## Local Validation

Restore, build, test, and pack the .NET workspace:

```sh
mise x -- dotnet restore GdKirie.slnx
mise x -- dotnet build GdKirie.slnx --configuration Release
mise x -- dotnet test --solution GdKirie.slnx --configuration Release --no-build
mise x -- dotnet pack GdKirie.slnx \
  --configuration Release \
  --no-build \
  --disable-build-servers \
  -m:1 \
  --output artifacts/nuget
```

Solution-level packing includes every project with `IsPackable=true` and skips
the test project. Publish the resulting packages together with:

```sh
mise x -- dotnet nuget push "artifacts/nuget/*.nupkg" \
  --api-key "${NUGET_API_KEY}" \
  --source https://api.nuget.org/v3/index.json \
  --skip-duplicate
```

`GdKirie.Tray` contains only the managed Eventa host. The `@gd-kirie/tray` npm
package supplies its native GDExtension through `addons/kirie_tray`. Native
builds and packaging belong to the [npm release flow](npm-publishing.md).

The Eventa adapter includes a NuGet `contentFiles` source bridge that connects the
addon-shipped `KirieClient.cs` to the adapter without placing Eventa source in
`addons/kirie`.

The repository `global.json` opts `dotnet test` into
Microsoft.Testing.Platform, which is required for this xUnit v3 test project on
.NET 10 SDKs.

## GitHub Actions Publishing

The `Publish NuGet Packages` workflow builds, tests, and publishes all four
managed packages for pushed `v*` tags. It checks that the tagged commit is on
`main`. It uses NuGet Trusted Publishing
to exchange a GitHub Actions OIDC token for a short-lived NuGet API key; do not
configure a long-lived NuGet API key for this workflow.

A manual `workflow_dispatch` run also publishes its selected ref without the
tag ancestry check.

Create a Trusted Publishing policy on NuGet.org for the user or organization
that owns all four packages. Configure the GitHub repository identity as:

- Repository owner: `moeru-ai`
- Repository: `godot-kirie`
- Workflow file: `nuget-release.yml`
- Environment: empty

The policy applies to every package owned by the selected NuGet policy owner.
Choose that owner deliberately, then configure a repository Actions variable
named `NUGET_USER` with the NuGet profile username used by the login action, not
an email address. The workflow rejects a missing username before requesting an
OIDC credential.

## References

- [NuGet Trusted Publishing](https://learn.microsoft.com/nuget/nuget-org/trusted-publishing)
- [NuGet OIDC login action](https://github.com/NuGet/login)
- [NuGet `dotnet nuget push`](https://learn.microsoft.com/dotnet/core/tools/dotnet-nuget-push)
- [Tray npm and GDExtension distribution](npm-publishing.md#tray-native-libraries)
