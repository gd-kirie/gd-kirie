# @gd-kirie/ipc

Thin browser-side IPC transport for Kirie WebView pages.

The package is imported by web content running inside a Kirie WebView. Native platforms continue to provide the low
level bridge on `globalThis`, and this package only wraps that bridge with a small typed module API.

## API

```ts
import { onTextReceived, sendText } from "@gd-kirie/ipc";

sendText(JSON.stringify({
  type: "web_ready",
}));

const unsubscribe = onTextReceived((message) => {
  console.log(message);
});

unsubscribe();
```

The package selects native transports from `window.kirie.platform`.
Native backends inject this property before page scripts run.
On Web, the first API call discovers the iframe port and sets the platform property.

Android exposes three channels backed by CBOR packets and AndroidX WebKit
ArrayBuffer messages. iOS exposes the same lane API over WKWebView script
messages, carrying each CBOR packet as base64 inside the platform string
message:

- `sendText()` / `onTextReceived()` for CBOR text strings
- `sendBinary()` / `onBinaryReceived()` for CBOR byte strings
- `sendData()` / `onDataReceived()` for CBOR-encoded structured data through `cborg`

The structured data subset is limited to `null`, booleans, numbers, strings,
arrays, and objects with string keys. JSON message shapes are a caller or
adapter convention and should be sent with `sendText()` when needed.

## Web iframe transport

On Web exports, the package discovers its same-origin parent.
The first API call sets `window.kirie.platform` to `{ os: "web", backend: "iframe" }`.
These values extend `KiriePlatformOs` and `KiriePlatformBackend`.
Each receive function returns an unsubscribe function that removes its message listener.
After the iframe document loads, the host transfers one end of a browser
`MessageChannel`. The iframe reports readiness through that port. Readiness
does not depend on lane subscriptions, so
a text-only adapter such as Eventa does not need empty binary or data handlers.
Subscribe only to the lanes the page consumes:

```ts
import { onTextReceived, sendText } from "@gd-kirie/ipc";

const stopText = onTextReceived(sendText);

window.addEventListener("pagehide", () => {
  stopText();
}, { once: true });
```

Web sends text strings, binary ArrayBuffers, and data values through the
transferred `MessagePort` and
[structured clone](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).
It does not serialize payloads as JSON or CBOR.
Binary API arguments and callbacks still use `Uint8Array`.
The transport copies the selected byte range and keeps the sender's buffer intact.
Data accepts only the documented cross-platform subset.
It rejects custom prototypes, cycles, non-finite numbers, unsafe integers, and nesting beyond 64 container levels.

The host uses an exact target origin when it transfers the port. The iframe
accepts that port only from its same-origin parent. Later lane traffic stays on
the private port, so Kirie does not implement another window-message router or
channel registry. Cross-origin content and opaque origins are unsupported.

`createIframeTransport(window, { origin })` exposes the transport explicitly.
`KirieIframeConfig` and `KirieTransport` describe its configuration and API.
The factory receives the port from its parent; it does not create or own an iframe.

## Pointer input forwarding

> [!IMPORTANT]
> Kirie WebViews normally fill their native host above Godot. CSS transparency
> does not pass native hit tests through to Godot, so visible Godot controls
> behind the WebView cannot be clicked without pointer forwarding. Most Kirie
> pages should import `@gd-kirie/ipc/pointer-input/auto`.

Enable both sides; the browser entry registers on import:

```gdscript
$KirieNode.pointer_input_forwarding_enabled = true
```

```ts
import "@gd-kirie/ipc/pointer-input/auto";
```

### Custom event orchestration

For custom targets or lifetimes, use the explicit entry instead:

```ts
import {
  createPointerEventsHandler,
  phaseFromPointerEvent,
  sendPointerEvent,
} from "@gd-kirie/ipc/pointer-input";
```

`createPointerEventsHandler()` returns `capture`, `bubble`, and `cancel` handlers;
the caller owns their registration and removal.

`pointerdown` bubbling decides ownership: `event.stopPropagation()` keeps the
sequence in the WebView; otherwise its move, up, and cancel events are forwarded
to Godot.

Forwarding uses Godot's
[`Input.parse_input_event()`](https://docs.godotengine.org/en/stable/classes/class_input.html#class-input-method-parse-input-event)
API; forwarded mouse and touch events retain their destination
[`window_id`](https://docs.godotengine.org/en/stable/classes/class_inputeventfromwindow.html#class-inputeventfromwindow-property-window-id).
