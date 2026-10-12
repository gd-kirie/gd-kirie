# basic-platform

A compact desktop example for `@gd-kirie/platform` and `GdKirie.Platform`. It
visualizes display, window, and pointer coordinates. It also exercises window
controls, pointer passthrough, global shortcuts, external URLs, the application
data directory, and Android system Back requests.

The Esc global-shortcut backend is available on macOS and Windows. On Linux,
registration fails visibly and pointer passthrough is left disabled.
Android forwards the system Back button to the exported `backRequested` event.
On Android, set `SceneTree.quit_on_go_back` to `false` to handle Back in the page.

Run these setup commands from the repository root:

```sh
mise x -- pnpm install
mise run build:packages
mise x -- pnpm -C examples/basic-platform exec kirie doctor --fix plugin:core
mise x -- pnpm -C examples/basic-platform exec kirie build dotnet
```

Start the Kirie-managed Vite server and Godot project together:

```sh
mise x -- pnpm -C examples/basic-platform run dev
```

To run the packaged web build, build it through Kirie before starting Godot:

```sh
mise x -- pnpm -C examples/basic-platform run build
mise x -- godot --path examples/basic-platform
```
