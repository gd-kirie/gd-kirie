# GdKirie.Notifications

Registers Kirie's notification Eventa contracts and attaches them to one
scene-tree owner:

```csharp
var registry = GdKirieNotifications.Register(new KirieEventaJsonRegistry());
var eventa = kirie.CreateEventaContext(registry);
var notifications = GdKirieNotifications.Attach(eventa.Context, GetWindow());
```

Dispose the returned host before its Eventa context. macOS and Windows use the
Kirie desktop implementations. Android and iOS require the
`@gd-kirie/notifications` plugin addon and its pinned upstream native artifacts.
