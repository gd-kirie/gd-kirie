# GdKirie.Tray

`GdKirie.Tray` is the Godot host for the optional `@gd-kirie/tray` plugin. It
borrows the application's Eventa context and delegates native behavior to
[`tray-icon`](https://github.com/tauri-apps/tray-icon).

```csharp
var registry = GdKirieTray.Register(new KirieEventaJsonRegistry());
var eventa = kirie.CreateEventaContext(registry);
var tray = GdKirieTray.Attach(eventa.Context, GetWindow());
```

Call `Register` before creating the Eventa context. Call `Attach` on Godot's
main thread after the host window enters the scene tree. `Attach` registers
handlers but does not create the Tray; the browser calls `create`. Disposing
the returned host removes its handlers and the process Tray.

The host loads `res://` textures as RGBA pixels, forwards menu JSON and scalar
values to a private Rust dynamic library, and emits activated menu IDs. It does
not expose a second C# Tray API.

macOS supports `iconAsTemplate`. Linux uses the KSNI backend and requires a
StatusNotifierItem host. Source checkouts must run `mise run build:tray-native`
before starting the example or packing NuGet. Published native libraries use
the standard `runtimes/<rid>/native/` layout.
