# notifications

A focused example for `@gd-kirie/notifications` and
`GdKirie.Notifications`. It shows an immediate system notification and reports
the caller-owned ID when the user opens it.

```sh
mise x -- pnpm install
mise run build:packages
mise x -- pnpm -C examples/notifications exec kirie doctor --fix
mise x -- pnpm -C examples/notifications exec kirie build dotnet
mise x -- pnpm -C examples/notifications run dev
```

macOS notifications should be tested from an application installed in
`/Applications` or `~/Applications`. Windows activations are delivered while
the host is alive. Android and iOS request notification permission on first use.

Export the mobile variants after configuring their Godot presets:

```sh
mise x -- pnpm -C examples/notifications exec kirie export android
mise x -- pnpm -C examples/notifications exec kirie export ios
```
