# tray

A desktop example for the Kirie Tray plugin. It demonstrates the Tray lifecycle,
an editable native menu, and menu activation events.

Run these setup commands from the repository root:

```sh
mise x -- pnpm install
mise run build:packages
mise run build:tray-native
mise x -- pnpm -C examples/tray exec kirie doctor --fix plugin:core
mise x -- pnpm -C examples/tray exec kirie build dotnet
```

Start the Kirie-managed Vite server and Godot project together:

```sh
mise x -- pnpm -C examples/tray run dev
```
