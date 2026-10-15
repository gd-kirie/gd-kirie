# `@gd-kirie/tray`

`@gd-kirie/tray` adds system tray support to desktop Kirie applications. It
uses the application's existing Eventa context.

Add the plugin to `kirie.config.ts`:

```ts
import tray from "@gd-kirie/tray/plugin";
import { defineKirieConfig } from "kirie";
import core from "kirie/plugin/core";

export default defineKirieConfig({
  plugins: [core, tray],
});
```

Install the plugin dependencies:

```sh
pnpm kirie doctor --fix plugin:tray
```

This command installs `addons/kirie_tray` and the `GdKirie.Tray` NuGet host.
The npm package bundles the desktop GDExtension libraries. Godot selects the
library for the current platform and includes it in application exports.
macOS, Windows, and Linux support x64 and Arm64. Linux requires a
StatusNotifierItem host.

See the [`tray` example](https://github.com/gd-kirie/kirie-examples/blob/main/examples/tray/README.md) for a complete setup.
