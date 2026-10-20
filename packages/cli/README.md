# Kirie CLI

The `kirie` command coordinates Vite, Godot, and optional .NET builds for a
Kirie project.

Common commands:

```sh
pnpm kirie build
pnpm kirie dev desktop
pnpm kirie dev android
pnpm kirie dev ios
pnpm kirie dev web
pnpm kirie export web
pnpm kirie doctor
```

For simulator runs, `kirie run ios` and `kirie dev ios` select the device with
`--device` or `SIMULATOR_ID`, defaulting to an already booted simulator. Before installation,
the CLI waits up to four minutes for `simctl bootstatus -b` to boot the device
and report readiness. It streams Godot logs through process exit using
[`--log-file`](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html)
with the app's `tmp/kirie.log` path.

`kirie dev web` exports the Godot Web host once, starts the Vite development
server, and prints its URL. C# projects require the experimental .NET
Web templates:

```sh
pnpm kirie doctor --fix web
```

Godot 4.7.2 does not officially support .NET Web export. The templates are an
experimental preview built from upstream Draft PR #106125. The fixer installs
the templates and .NET workload. It does not install another Godot editor or
write machine-local template paths to the project.

The templates use WebAssembly threads, so the page must be cross-origin
isolated. `kirie dev web` sends `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`; serve exported output with the
same headers.
