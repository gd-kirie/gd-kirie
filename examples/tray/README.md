# tray

A complete interactive example for the Kirie Tray plugin. The control panel
creates and destroys the tray, replaces its icon, sets or clears its tooltip,
and changes its visibility. The tree editor covers plain items, check items,
submenus, separators, enabled state, checked state, and complete menu
replacement. Activating an item in the system tray marks the matching editor
row as the last clicked item.

On macOS, the example uses a monochrome template image so the menu bar can
tint it for the current appearance. It uses the regular color icon on other
platforms because they reject `iconAsTemplate: true`.

Rows can be added, deleted, moved within their level, indented into a preceding
submenu, or moved out one level. Changing a row type to a submenu enables child
items. Check-item activations update their checked state in the editor and
replace the native menu.

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
