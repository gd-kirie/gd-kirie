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

`kirie run ios` and `kirie dev ios` stream engine logs from the simulator
app's `tmp/kirie.log` file. The CLI passes Godot's `--log-file` option and
reads the file from startup through exit.

For simulator targets, these commands boot the selected simulator if needed and
wait for readiness before installing or launching the app. Startup has a
four-minute timeout. Select a simulator with `--device` or `SIMULATOR_ID`;
without either, the CLI uses an already booted simulator. See
`xcrun simctl help bootstatus` for the readiness command.

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
