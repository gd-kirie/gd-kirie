---
status: "accepted"
date: 2026-10-11
decision-makers: "Doji"
consulted: "Codex"
informed: "Kirie contributors"
---

# Use tray-icon for the Tray plugin

## Context

The Tray plugin maintained separate Godot and AppKit implementations. This
duplicated native behavior and exposed menu features that were not consistently
portable. Kirie should delegate desktop tray behavior to
[`tray-icon`](https://github.com/tauri-apps/tray-icon) while keeping Tray an
optional plugin above the low-level WebView and IPC layers.

`tray-icon` has no C ABI or .NET package. Kirie therefore still needs a narrow
boundary between its existing .NET Eventa host and the Rust library.

This decision supersedes
[ADR-0011](0011-own-macos-status-items-for-template-icons.md) and
[ADR-0012](0012-extract-system-tray-into-a-kirie-plugin.md). It retains the
independent plugin and borrowed Eventa context from ADR-0012.

## Decision

Keep `@gd-kirie/tray` as the browser client and plugin descriptor, and keep
`GdKirie.Tray` as its Godot-facing .NET host. The host:

- registers `kirie:tray:*` on the application's Eventa context;
- loads Godot `res://` textures and converts them to RGBA pixels;
- calls a private Rust dynamic library through P/Invoke;
- passes menu JSON and scalar values without a second C# menu model; and
- emits activated menu IDs back through Eventa.

The private Rust crate lives under `packages/GdKirie.Tray/native`, depends
directly on `tray-icon` 0.26.1, and contains no platform backend abstraction. It
owns one process Tray and exports only the required C ABI operations and error
retrieval.

The browser contract replaces complete Tray state. Remove menu features that
`tray-icon` cannot support consistently instead of emulating them.

Linux uses the `tray-icon` KSNI feature without the default GTK/AppIndicator
backend. The NuGet package ships native libraries for macOS, Windows, and Linux
on x64 and Arm64 under `runtimes/<rid>/native/`.

Do not add a GDExtension, GDScript API, public C# Tray controller, compatibility
wire handlers, or a second IPC owner.

## Consequences

- Kirie no longer owns platform Tray implementations.
- The browser API changes without a compatibility layer.
- Native releases require a six-RID build matrix.
- Menu events are polled on Godot's main thread.
- Linux requires a StatusNotifierItem host.
- Visible behavior still requires desktop acceptance testing.

## Rejected alternatives

- Keeping the Godot and AppKit implementations would retain duplicated native
  behavior.
- A Rust GDExtension would add another Godot object and signal boundary while
  the .NET Eventa host remains necessary.

## References

- [`tray-icon` requirements](https://github.com/tauri-apps/tray-icon/blob/17e3196a15aa6174a21588ac4c5a52e322878479/README.md)
- [`tray-icon` 0.26.1 manifest](https://github.com/tauri-apps/tray-icon/blob/17e3196a15aa6174a21588ac4c5a52e322878479/Cargo.toml)
- [`muda` menu items](https://github.com/tauri-apps/muda/blob/88e0c3658a85668872c621f77d6aad1616f42780/src/items/mod.rs)
- [NuGet native runtime assets](https://learn.microsoft.com/nuget/create-packages/native-files-in-net-packages)
