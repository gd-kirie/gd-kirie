# `@gd-kirie/tray`

`@gd-kirie/tray` is the browser client and plugin descriptor for Kirie's
optional [`tray-icon`](https://github.com/tauri-apps/tray-icon) integration. It
uses the application's existing Eventa context.

Add the plugin to `kirie.config.ts`, then run
`pnpm kirie doctor --fix plugin:tray`:

```ts
import tray from "@gd-kirie/tray/plugin";
import { defineKirieConfig } from "kirie";
import core from "kirie/plugin/core";

export default defineKirieConfig({
  plugins: [core, tray],
});
```

Create the browser client only on a desktop Kirie host:

```ts
import type { TrayMenuItem } from "@gd-kirie/tray";
import { createContext } from "@gd-kirie/ipc-eventa";
import { createTrayClient, trayMenuItemActivated } from "@gd-kirie/tray";

const os = window.kirie?.platform.os;
if (os === "macos" || os === "windows" || os === "linux") {
  const eventa = createContext();
  const tray = createTrayClient(eventa.context);
  const menu: TrayMenuItem[] = [
    { type: "item", id: "show", text: "Show Kirie" },
    { type: "check", id: "enabled", text: "Enabled", checked: true },
    { type: "separator" },
    {
      type: "submenu",
      text: "More",
      children: [{ type: "item", id: "quit", text: "Quit" }],
    },
  ];

  eventa.context.on(trayMenuItemActivated, ({ body: id }) => console.log(id));

  await tray.create({
    icon: os === "macos" ? "res://tray-template.svg" : "res://icon.svg",
    iconAsTemplate: os === "macos",
  });
  await tray.setMenu(menu);
  await tray.setTooltip("Kirie");
  await tray.setVisible(true);
}
```

The client exposes `create`, `setIcon`, `setMenu`, `setTooltip`, `setVisible`,
and `destroy`. Call `create` before the setters; calling it again replaces the
current Tray. `setMenu` replaces the complete menu. `setTooltip(null)` clears
the tooltip, and `destroy` is idempotent.

Plain and check items should use unique, non-empty IDs. Activation events carry
that ID directly. The application owns check state and should update it before
the next complete menu replacement. Template icons are macOS-only. Linux uses
the KSNI backend and requires a StatusNotifierItem host.

The Tray survives browser reloads and is released when the .NET host exits.
See [`examples/tray`](../../examples/tray/README.md) for every operation and
menu type.
