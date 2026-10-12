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

See the [`tray` example](../../examples/tray/README.md) for a complete setup.
