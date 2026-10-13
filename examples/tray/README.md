# tray

A desktop example for the Kirie Tray plugin. It demonstrates the Tray lifecycle,
an editable native menu, and menu activation events.

Run these setup commands from the repository root:

```sh
mise x -- pnpm install
mise run build:tray-native
mise run build:packages
mise x -- pnpm -C examples/tray exec kirie doctor --fix plugin:core
mise x -- pnpm -C examples/tray exec kirie doctor --fix plugin:tray
mise x -- pnpm -C examples/tray exec kirie build dotnet
```

Start the Kirie-managed Vite server and Godot project together:

```sh
mise x -- pnpm -C examples/tray run dev
```

The Tray plugin installs its GDExtension at `addons/kirie_tray`. The local
native build supplies the library for the current host. Published npm packages
include all six desktop libraries. Godot loads and exports the native library.
