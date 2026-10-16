---
status: "superseded"
date: 2026-10-12
decision-makers: "Doji"
consulted: "Codex"
informed: "Kirie contributors"
---

# Load Tray through a GDExtension

The API and lifecycle choices are superseded by
[ADR-0016 in kirie-plugins](https://github.com/gd-kirie/kirie-plugins/blob/main/docs/decisions/0016-forward-native-tray-and-menu-objects.md). The GDExtension loader
and distribution choices remain in effect.

## Context

A downstream application installed `GdKirie.Tray` 0.12.0 but could not load its
native library. NuGet put the library under `runtimes/<rid>/native/`. The
P/Invoke resolver searched only the application's assembly directory and raised
`DllNotFoundException`.

The user chose a GDExtension so Godot owns native library discovery and export.
This decision supersedes
[ADR-0013](0013-use-tray-icon-for-the-tray-plugin.md). It retains `tray-icon`,
the independent Tray plugin, and the application's existing Eventa context.

## Decision

Register one Rust `KirieTrayNative` class derived from `RefCounted`. Each instance
owns its native tray. `GdKirie.Tray` creates one instance through `ClassDB` and
calls its methods through Godot. The C# host keeps texture loading and menu event
polling on Godot's main thread. It destroys the tray and releases the native
object when the host exits.

Use `godot` 0.5.5 with its `api-4-7` feature for Godot 4.7.2. Keep `tray-icon`
0.26.1 and the Linux KSNI backend. Remove the C ABI, P/Invoke resolver, and
shared native error state. Native methods return operation errors directly.

Bundle the extension descriptor and six desktop libraries in `@gd-kirie/tray`.
The existing plugin descriptor installs them at `addons/kirie_tray` through
`kirie doctor --fix plugin:tray`. Godot selects the library through the
`.gdextension` platform and architecture tags. The npm release builds macOS,
Windows, and Linux libraries for x64 and Arm64 before package publication.

`GdKirie.Tray` contains only the managed Eventa host. Its public API and the
`kirie:tray:*` browser contracts stay unchanged. The extension does not own IPC,
a WebView, or application lifecycle. This decision does not move other native
Platform capabilities into GDExtension.

## Consequences

- Downstream applications use Godot's native library loading and export paths.
- npm publication requires all six desktop libraries.
- The C# host owns a Godot object and must release it on the main thread.
- Native Tray installation requires the plugin addon as well as the NuGet host.
- Acceptance testing uses the existing Tray example on each desktop platform.

## Implementation Plan

- **Native boundary**: Replace the C ABI in `packages/GdKirie.Tray/native/src/lib.rs` with the registered native class.
- **Managed host**: Replace `packages/GdKirie.Tray/src/TrayNative.cs` and update host cleanup in `GdKirieTrayHost.cs`.
- **NuGet package**: Remove native assets from `packages/GdKirie.Tray/GdKirie.Tray.csproj`.
- **Plugin distribution**: Add the bundled addon to `packages/tray/src/plugin.ts` and package staging to `packages/tray`.
- **Build tasks**: Update `scripts/build-tray-native.ts` and `mise.toml` for addon staging and managed NuGet packaging.
- **Release workflows**: Move the native build matrix from `nuget-release.yml` to `npm-publish.yml`.
- **Documentation**: Update the package READMEs, Tray example, architecture, and release instructions.

### Verification

- [x] Run Rust tests and lint, TypeScript checks, and the .NET build and tests.
- [x] Build and type-check `examples/tray` with the staged GDExtension.
- [ ] Exercise lifecycle, menu updates, and activation through `examples/tray` on supported desktops.
- [x] Check that release packaging requires the six real desktop libraries.

## Rejected Alternatives

- Extending the P/Invoke search path retains native distribution outside Godot's addon and export paths.
- A downstream copy step requires each application to repair Kirie's package layout.
- A remote archive adds release checksum coordination that the existing bundled addon mechanism does not require.

## References

- [Godot GDExtension library selection and export](https://docs.godotengine.org/en/stable/engine_details/engine_api/gdextension/gdextension_file.html)
- [godot-rust 0.5.5 manifest](https://github.com/godot-rust/gdext/blob/v0.5.5/godot/Cargo.toml)
- [godot-rust compatibility](https://godot-rust.github.io/book/toolchain/compatibility.html)
- [godot-rust extension registration](https://godot-rust.github.io/book/intro/hello-world.html#extension_listcfg)
- [Godot RefCounted lifecycle](https://docs.godotengine.org/en/stable/classes/class_refcounted.html)
- [Tray plugin installation](0010-introduce-kirie-plugins-and-the-core-plugin.md)
