# `@gd-kirie/notifications`

Kirie notifications expose immediate system notifications over an existing
Eventa context. Configure the package's default Kirie plugin, register and
attach `GdKirie.Notifications` in Godot, then create the browser client:

```ts
import notifications from "@gd-kirie/notifications";
import { defineKirieConfig } from "kirie";
import core from "kirie/plugin/core";

export default defineKirieConfig({ plugins: [core, notifications] });
```

```ts
const notifications = createNotificationsClient(eventa.context);
await notifications.show({ id: "welcome", title: "Kirie", body: "Hello" });
```

Subscribe to `notificationActivated` to receive the caller-owned ID. Desktop
uses the existing macOS and Windows implementations. Android and iOS use
`godot-notification-scheduler` v6.0 installed by running
`kirie doctor --fix plugin:notifications`.

The [mobile plugin](https://github.com/godot-mobile-plugins/godot-notification-scheduler)
is distributed by godot-mobile-plugins under the MIT license.
