# GdKirie.Tray

`GdKirie.Tray` is the Godot host for the optional `@gd-kirie/tray` plugin. The
plugin installer adds this package to Godot .NET projects.

The native tray runs in the `addons/kirie_tray` GDExtension. The
`@gd-kirie/tray/plugin` descriptor installs that addon through
`kirie doctor --fix plugin:tray`. This NuGet package contains only the managed
host. Godot loads and exports the platform library from the addon.

The host uses the application's Eventa context. See the
[`tray` example](https://github.com/gd-kirie/kirie-examples/blob/main/examples/tray/README.md) for the project setup.
