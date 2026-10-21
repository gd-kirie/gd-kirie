# Configure Vite HMR for Godot Kirie

Kirie applications can load their web interface from two places. Production
builds use files packaged with the Godot project, typically
`res://src-web/dist/index.html`. During development, the same WebView can load
the page from a Vite development server.

That small change of origin gives the embedded page Vite's development client,
CSS hot replacement, and page reloads without rebuilding the Godot application.
The embedded page updates while the Godot process and native Kirie WebView stay
alive.

## The Development Flow

The development path has three participants:

```text
Vite dev server <-- HTTP and HMR WebSocket --> Kirie WebView <-- Kirie IPC --> Godot
```

`kirie dev` starts Vite and waits for it to report the URL on which it is
actually listening. Kirie then launches the target with two logical options,
shown here in their desktop and iOS process-argument form:

```text
--kirie-dev=1
--kirie-web-url=http://127.0.0.1:<port>/
```

The Godot application reads `kirie-web-url` and gives it to the same Kirie
WebView that would otherwise load the packaged page. Kirie does not create a
second development WebView, and the IPC API does not change between development
and production.

## Configure the Vite Project

A conventional Kirie project keeps the Godot project and Vite source together:

```text
kirie.config.ts
package.json
project.godot
src-godot/
src-web/
  index.html
  src/
  dist/
addons/kirie/
```

Kirie defaults the web root to `src-web`, so an empty configuration is enough
for many projects. Vite options that belong to the application can be added
under `web.vite`:

```ts
import { defineKirieConfig } from "kirie";

export default defineKirieConfig({
  web: {
    vite: {
      build: {
        sourcemap: true,
      },
    },
  },
});
```

Kirie owns the Vite values that connect the build to Godot: `root`, `base`,
`server.host`, `server.port`, `server.strictPort`, `server.open`, and
`build.outDir`. Keep plugins, aliases, CSS configuration, `define` values,
proxies, and similar application options in `web.vite`; use `kirie dev` flags
for a one-off host or port change. The CLI does not load a separate
`vite.config.ts`, so shared Vite customization belongs in `kirie.config.ts`.
The default development topology does not require a custom `server.hmr`
configuration.

A package script keeps the development command short:

```json
{
  "scripts": {
    "dev": "kirie dev",
    "build": "kirie build"
  }
}
```

Install `kirie` as a project development dependency. Install `vite` separately
only when application configuration imports Vite types or plugins directly.

```sh
corepack pnpm add -D kirie
```

Start a desktop development session with:

```sh
corepack pnpm dev
```

Kirie starts Vite, prepares the Godot project, and launches Godot as a child
process. A requested port is optional; when it is omitted, Vite may select the
next available port and Kirie passes the resolved URL to Godot.
Desktop projects also need the Godot CEF addon installed so Kirie has a desktop
WebView backend.

```sh
corepack pnpm kirie dev --port 5173 --strict-port
```

## Select the Development URL in Godot

The application still owns navigation. It should prefer `kirie-web-url` when
the launch option is present and fall back to the packaged page otherwise.

The following parent script uses the `GdKirie` service API so it can resolve the
URL before creating the WebView:

```gdscript
extends Control

const PACKAGED_PAGE_URL := "res://src-web/dist/index.html"
const DEV_PAGE_URL_OPTION := "kirie-web-url"

var _kirie := GdKirie.new()


func _ready() -> void:
	_kirie.create_webview({"initial_url": _resolve_page_url()})


func _exit_tree() -> void:
	_kirie.destroy_webview()
	_kirie.free()


func _resolve_page_url() -> String:
	var native_url := _kirie.get_launch_option(DEV_PAGE_URL_OPTION).strip_edges()
	if native_url != "":
		return native_url

	var option_prefix := "--%s=" % DEV_PAGE_URL_OPTION
	for argument in OS.get_cmdline_args() + OS.get_cmdline_user_args():
		if argument.begins_with(option_prefix):
			return argument.trim_prefix(option_prefix).strip_edges()

	return PACKAGED_PAGE_URL
```

The native lookup handles launch options delivered by mobile platforms. The
command-line fallback covers desktop processes launched with Godot user
arguments. The script explicitly destroys its WebView when it leaves the scene
tree.

Keep the packaged URL as the fallback. `kirie build` writes the production Vite
output to `src-web/dist`, allowing the exported application to use the same
page entry without a development server.

## HMR and Page Reloads Have Different Lifecycles

Vite can replace an imported stylesheet without navigating the WebView. The
DOM, JavaScript context, and Kirie IPC subscriptions remain in place during
that CSS update.

An edit without an accepted HMR boundary can cause a full page reload instead.
This commonly includes `index.html` and application entry modules that do not
register `import.meta.hot.accept`. The native WebView and Godot objects remain
alive, but the browser JavaScript context is new.

Initialize the browser-side Kirie transport, event subscriptions, and
application-level readiness message every time the page starts. After a full
reload, Godot should observe a new application readiness message before sending
messages that depend on page handlers. This also makes the production startup
sequence and the development reload sequence exercise the same lifecycle.

## Mobile Development

The URL must be reachable from the WebView, not only from the development
machine's browser.

For Android, `kirie dev android` exports and installs the debug application,
uses `adb reverse` to forward the Vite port, and launches the Activity with a
device-local URL such as `http://127.0.0.1:5173/`. The Android export preset must
enable Internet access:

```text
permissions/internet=true
```

Run the session with a selected emulator or device:

```sh
corepack pnpm kirie dev android --device <selector>
```

For iOS, the current CLI development path targets an iOS Simulator. Its export
preset must use `application/export_project_only=true`, allowing Kirie to build,
install, and launch the simulator application with the resolved Vite URL. The
HTTP development URL needs an App Transport Security exception. Kirie's current
standard export option bundles that plist injection with runtime handling for
invalid TLS certificate challenges. Set the combined development-only option in
the iOS export preset before running the CLI. Web Inspector is independent and
optional:

```text
kirie/debug/allow_tls_bypass=true
kirie/debug/enable_web_inspector=true
```

Plain HTTP needs the ATS exception but does not itself need TLS certificate
bypass. A specialized project can write development-only ATS keys into its iOS
preset and leave `kirie/debug/allow_tls_bypass=false`; the
`examples/swiftui-embedded` prototype does this. When using Kirie's combined
option, keep it limited to development exports and false in production.

```sh
corepack pnpm kirie dev ios --device <simulator-udid>
```

## Verify the Whole Path

A visible update confirms only part of the development path. A useful check
covers both rendering and IPC:

1. Change a stylesheet and confirm that Vite reports an HMR update without
   relaunching the application.
2. Change `index.html` and confirm that Vite reports a page reload.
3. Confirm that the reloaded page emits its readiness message again.
4. Send one message in each direction after the reload.

The last two checks catch lifecycle bugs that a browser-only HMR test misses.
They verify that the new page context reconnected to the existing Kirie and
Godot objects.

## References

- [Vite HMR API](https://vite.dev/guide/api-hmr)
- [Vite features and hot module replacement](https://vite.dev/guide/features.html#hot-module-replacement)
- [Vite server options](https://vite.dev/config/server-options.html)
- [Android Debug Bridge port forwarding](https://developer.android.com/tools/adb#forwardports)
- [Apple: App Transport Security](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity)
