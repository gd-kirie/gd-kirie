# Addon Release

GitHub Release addon publishing is handled by the `Addon Release` workflow.
This flow is separate from npm publishing, which is only for browser-side
workspace packages such as `@gd-kirie/ipc` and `@gd-kirie/ipc-eventa`.

It is also separate from the Maven Central and NuGet publishing lanes.
Keep addon zip packaging focused on `addons/kirie`; desktop Godot CEF artifacts
are outside the default Kirie addon zip.

## Intended Artifact

The downloadable addon should be produced as a build artifact, not by using
GitHub's source archive directly.

The public zip should unpack to a standard Godot addon layout:

```text
addons/kirie/
```

The public addon should include release native artifacts:

- `addons/kirie/ios/Kirie.debug.xcframework`
- `addons/kirie/ios/Kirie.release.xcframework`

The iOS debug xcframework is included because Godot's
debug iOS export template needs a plugin binary built with matching Godot debug
template flags. In Godot's official iOS plugin build model this corresponds to
the `release_debug` target, so Kirie's debug artifact is built from the
`ReleaseDebug` Xcode configuration rather than from a full `Debug`
configuration.

The iOS artifacts live under `addons/kirie/ios` instead of
`res://ios/plugins` because Kirie publishes one standard addon tree for all
platforms. The addon export plugin injects the selected xcframework and native
initialization code through Godot's `EditorExportPlugin` Apple embedded platform
hooks, so users do not need a separate project-local `.gdip` shim.

## User Install Flow

For CLI installation, see [README.md](../README.md#installation).

For manual installation, download `kirie-addon.zip` from a GitHub Release
asset, not the repository source archive.

The zip is rooted at:

```text
addons/kirie/
```

To install it, extract the zip into the root of a Godot project so the final
layout is:

```text
res://addons/kirie/
```

If the project already has an `addons` directory, merge the extracted `addons`
directory into the project root. Do not extract the zip inside the existing
`addons` directory, because that would create `addons/addons/kirie`.

After copying the files, enable Kirie from Godot's Project Settings Plugins tab.

## Local Pack Flow

Build native release artifacts and pack the public addon zip:

```sh
mise run build:addon-pack
```

The pack task regenerates addon GDScript from
`packages/kirie/src-godot` before staging. The generated `.gd` files are
ignored by Git and shipped to Godot users in the addon zip; the TypeScript
source stays in the repository.

The task stages a clean addon tree at:

```text
dist/addons/kirie/
```

and writes:

```text
dist/kirie-addon.zip
```

The zip is rooted so it unpacks into `addons/kirie`.

To check an already staged addon tree without rebuilding native artifacts:

```sh
mise run check:addon-pack
```

## GitHub Actions Flow

The `Addon Release` workflow has three intended modes:

- Manual default: run `workflow_dispatch` with `upload_release` disabled. The
  workflow builds `dist/kirie-addon.zip` and uploads it as a GitHub Actions
  artifact.
- Manual release upload: run `workflow_dispatch` with `upload_release` enabled
  and a `v*` `tag`. The workflow checks out that tag, builds the addon zip, and
  uploads it to the matching GitHub Release.
- Tag push: push a `v*` tag. The workflow builds the addon zip from that tag and
  uploads it to the matching GitHub Release.

## References

- [GitHub Actions `workflow_dispatch` documentation](https://docs.github.com/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)
- [GitHub Releases documentation](https://docs.github.com/repositories/releasing-projects-on-github/about-releases)
- [Godot installing plugins documentation](https://docs.godotengine.org/en/4.7/tutorials/plugins/editor/installing_plugins.html)
- [Godot iOS plugin documentation](https://docs.godotengine.org/en/stable/tutorials/platform/ios/ios_plugin.html)
- [Godot iOS plugins repository](https://github.com/godot-sdk-integrations/godot-ios-plugins)
- [Godot `EditorExportPlugin` documentation](https://docs.godotengine.org/en/stable/classes/class_editorexportplugin.html)
- [`moeru-ai/airi` release workflow](https://github.com/moeru-ai/airi/blob/main/.github/workflows/release-tamagotchi.yml)
- [`dsh0416/godot-cef` build workflow](https://github.com/dsh0416/godot-cef/blob/main/.github/workflows/build.yml)
