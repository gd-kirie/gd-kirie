---
status: "accepted"
date: 2026-10-12
decision-makers: "Doji"
consulted: "Codex"
informed: "Kirie contributors"
---

# Load Tray through a GDExtension

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
- Acceptance testing must include an installed and exported downstream application.

## Implementation Plan

- **Native boundary**: Replace the C ABI in `packages/GdKirie.Tray/native/src/lib.rs` with the registered native class.
- **Managed host**: Replace `packages/GdKirie.Tray/src/TrayNative.cs` and update host cleanup in `GdKirieTrayHost.cs`.
- **NuGet package**: Remove native assets from `packages/GdKirie.Tray/GdKirie.Tray.csproj`.
- **Plugin distribution**: Add the bundled addon to `packages/tray/src/plugin.ts` and package staging to `packages/tray`.
- **Build tasks**: Update `scripts/build-tray-native.ts` and `mise.toml` for addon staging and managed NuGet packaging.
- **Release workflows**: Move the native build matrix from `nuget-release.yml` to `npm-publish.yml`.
- **Consumer regression**: Add `tests/tray-consumer` and `scripts/test-tray-consumer.ts` with the `test:tray-consumer` task.
- **Documentation**: Update the package READMEs, Tray example, architecture, and release instructions.

### Verification

- [x] Run Rust tests and lint, TypeScript checks, and the .NET build and tests.
- [x] Install packed npm and NuGet packages into a separate Godot project without repository project references.
- [x] Exercise tray creation, menu updates, error propagation, destruction, and recreation through the Eventa host.
- [ ] Export that project and run the exported application with its installed GDExtension.
- [x] Check that release packaging requires the six real desktop libraries.

## Rejected Alternatives

- Extending the P/Invoke search path retains native distribution outside Godot's addon and export paths.
- A downstream copy step requires each application to repair Kirie's package layout.
- A remote archive adds release checksum coordination that the existing bundled addon mechanism does not require.

## More Information

On 2026-10-12, builds, lint, and unit tests passed. The installed consumer
installed the addon and checked its NuGet reference, but its first headless editor import
crashed during shutdown. This blocks the automated consumer and export checks.

A separate minimal probe reproduced the crash with Godot 4.7.2 and godot-rust
0.5.5 targeting API 4.7. An empty extension exited normally. An extension with
only an empty `RefCounted` class exited with code 134. The probe contained no
Tray implementation or C# host. The implementation contains no dependency patch
or compatibility workaround.

The same empty class also crashed with API 4.6 on Godot 4.7.2. Changing the
API target does not correct this error. A separate cold import succeeded after
the probe registered the addon path in `.godot/extension_list.cfg` before startup.
The installer does not apply this workaround.

On 2026-10-13, AIRI installed local npm and NuGet archives without repository
project references. Its C# build passed with no warnings or errors. The normal
graphical editor discovered the extension and exited normally. Godot wrote the
extension cache through its own discovery process. AIRI then ran with its Vite
renderer and loaded the Tray extension without `DllNotFoundException`. The
development process exited with code 0. Godot reported two `ObjectDB` instances
at exit; their ownership has not been isolated from the application's CEF host.

Native menu activation and exported application acceptance remain unverified.
The graphical result does not resolve the first headless import crash.

### 2026-10-13 Ablation Experiment

The installed consumer now invokes the installed Kirie executable directly and
lets Godot perform its graphical `--build-solutions` startup before running the
project. This removes a second package-manager resolution and avoids the cold
headless import path that crashes before Tray behavior can run.

The packed npm and NuGet packages installed into a temporary project with no
repository project references. Godot loaded the extension, and the consumer
completed Tray creation, menu assignment, native error propagation, destruction,
and recreation through Eventa. The installed project printed
`[Tray consumer] PASS`.

The export then stopped because the local Godot installation has no
`godot_macos_debug.arm64` export template. Exported-application and native menu
activation acceptance remain incomplete.

The experiment retained the managed `TrayNative` boundary, native panic-to-error
conversion, addon staging script, six-platform release matrix, and final asset
check. Each owns a distinct resource, compatibility, packaging, or release
constraint. The Rust callback-style Tray accessor and pure managed forwarding
methods were removed because the GDExtension instance already owns those
responsibilities directly.

## References

- [Godot GDExtension library selection and export](https://docs.godotengine.org/en/stable/engine_details/engine_api/gdextension/gdextension_file.html)
- [godot-rust 0.5.5 manifest](https://github.com/godot-rust/gdext/blob/v0.5.5/godot/Cargo.toml)
- [godot-rust compatibility](https://godot-rust.github.io/book/toolchain/compatibility.html)
- [godot-rust extension registration](https://godot-rust.github.io/book/intro/hello-world.html#extension_listcfg)
- [Godot RefCounted lifecycle](https://docs.godotengine.org/en/stable/classes/class_refcounted.html)
- [Tray plugin installation](0010-introduce-kirie-plugins-and-the-core-plugin.md)
- [Installed consumer test](../platform-integration-tests.md#installed-tray-consumer)
