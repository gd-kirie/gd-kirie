import type { KirieEventaContext } from "@gd-kirie/ipc-eventa";
import type { InboundEventa } from "@moeru/eventa";
import { defineInboundEventa, defineInvokeEventa, defineInvokes } from "@moeru/eventa";

export type ResizeEdge =
  | "top" |
  "right" |
  "bottom" |
  "left" |
  "top-left" |
  "top-right" |
  "bottom-left" |
  "bottom-right";

export interface HostWindowPointerPosition {
  x: number;
  y: number;
  inside: boolean;
}

export interface PlatformBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HostWindowState {
  focused: boolean;
  minimized: boolean;
  visible: boolean;
}

export interface HostWindowClient {
  getBounds: () => Promise<PlatformBounds>;
  getCurrentDisplayBounds: () => Promise<PlatformBounds>;
  getPointerPosition: () => Promise<HostWindowPointerPosition>;
  setPointerPassthrough: (enabled: boolean) => Promise<void>;
  beginMove: () => Promise<void>;
  beginResize: (edge: ResizeEdge) => Promise<void>;
  setAlwaysOnTop: (enabled: boolean) => Promise<void>;
  centerOnCurrentDisplay: () => Promise<void>;
  getState: () => Promise<HostWindowState>;
}

export interface GlobalShortcut {
  keycode: number;
  shiftPressed: boolean;
  altPressed: boolean;
  ctrlPressed: boolean;
  metaPressed: boolean;
  commandOrControlAutoremap: boolean;
}

export interface GlobalShortcutKeyEvent {
  state: "pressed" | "released";
}

export interface GlobalShortcutsClient {
  register: (
    shortcut: GlobalShortcut,
    onKeyEvent: (event: GlobalShortcutKeyEvent) => void,
  ) => Promise<void>;
  unregister: (shortcut: GlobalShortcut) => Promise<void>;
}

export interface PlatformClient {
  hostWindow: HostWindowClient;
  globalShortcuts: GlobalShortcutsClient;
  openExternalUrl: (url: string) => Promise<void>;
  openApplicationDataDirectory: () => Promise<string>;
}

type EmptyPayload = Record<string, never>;

interface GlobalShortcutStateChanged {
  shortcut: GlobalShortcut;
  state: GlobalShortcutKeyEvent["state"];
}

const events = {
  beginMove: defineInvokeEventa<EmptyPayload, EmptyPayload>(
    "kirie:platform:host-window:begin-move",
  ),
  beginResize: defineInvokeEventa<EmptyPayload, ResizeEdge>(
    "kirie:platform:host-window:begin-resize",
  ),
  center: defineInvokeEventa<EmptyPayload, EmptyPayload>("kirie:platform:host-window:center"),
  getBounds: defineInvokeEventa<PlatformBounds, EmptyPayload>(
    "kirie:platform:host-window:get-bounds",
  ),
  getCurrentDisplayBounds: defineInvokeEventa<PlatformBounds, EmptyPayload>(
    "kirie:platform:host-window:get-current-display-bounds",
  ),
  getPointerPosition: defineInvokeEventa<HostWindowPointerPosition, EmptyPayload>(
    "kirie:platform:host-window:get-pointer-position",
  ),
  getState: defineInvokeEventa<HostWindowState, EmptyPayload>(
    "kirie:platform:host-window:get-state",
  ),
  setAlwaysOnTop: defineInvokeEventa<EmptyPayload, boolean>(
    "kirie:platform:host-window:set-always-on-top",
  ),
  setPointerPassthrough: defineInvokeEventa<EmptyPayload, boolean>(
    "kirie:platform:host-window:set-pointer-passthrough",
  ),
  registerGlobalShortcut: defineInvokeEventa<EmptyPayload, GlobalShortcut>(
    "kirie:platform:global-shortcut:register",
  ),
  unregisterGlobalShortcut: defineInvokeEventa<EmptyPayload, GlobalShortcut>(
    "kirie:platform:global-shortcut:unregister",
  ),
  openExternalUrl: defineInvokeEventa<EmptyPayload, string>("kirie:platform:open-external-url"),
  openApplicationDataDirectory: defineInvokeEventa<string, EmptyPayload>(
    "kirie:platform:open-application-data-directory",
  ),
};

/**
 * Host-window visibility, focus, and minimized-state changes.
 * Subscribe with `context.on(hostWindowStateChanged, ({ body }) => ...)`.
 */
export const hostWindowStateChanged: InboundEventa<HostWindowState> =
  defineInboundEventa<HostWindowState>("kirie:platform:host-window:state-changed");

/**
 * Host-window-relative pointer position changes.
 * Subscribe first. Then call `getPointerPosition()` once to start host observation.
 */
export const hostWindowPointerPositionChanged: InboundEventa<HostWindowPointerPosition> =
  defineInboundEventa<HostWindowPointerPosition>(
    "kirie:platform:host-window:pointer-position-changed",
  );

const globalShortcutStateChanged = defineInboundEventa<GlobalShortcutStateChanged>(
  "kirie:platform:global-shortcut:state-changed",
);

/**
 * System Back requests forwarded by the host.
 * Subscribe with `context.on(backRequested, () => ...)`.
 */
export const backRequested: InboundEventa<EmptyPayload> = defineInboundEventa<EmptyPayload>(
  "kirie:platform:back:requested",
);

function globalShortcutKey(shortcut: GlobalShortcut): string {
  return [
    shortcut.keycode,
    shortcut.shiftPressed,
    shortcut.altPressed,
    shortcut.ctrlPressed,
    shortcut.metaPressed,
    shortcut.commandOrControlAutoremap,
  ].join(":");
}

export function createPlatformClient(context: KirieEventaContext): PlatformClient {
  const invokes = defineInvokes(context, events);
  const globalShortcutRegistrations = new Map<string, (event: GlobalShortcutKeyEvent) => void>();

  context.on(globalShortcutStateChanged, ({ body }) => {
    if (!body) {
      return;
    }

    globalShortcutRegistrations.get(globalShortcutKey(body.shortcut))?.({
      state: body.state,
    });
  });

  return {
    async openExternalUrl(url) {
      await invokes.openExternalUrl(url);
    },
    openApplicationDataDirectory() {
      return invokes.openApplicationDataDirectory({});
    },
    hostWindow: {
      getBounds() {
        return invokes.getBounds({});
      },
      getCurrentDisplayBounds() {
        return invokes.getCurrentDisplayBounds({});
      },
      getPointerPosition() {
        return invokes.getPointerPosition({});
      },
      getState() {
        return invokes.getState({});
      },
      async setPointerPassthrough(enabled) {
        await invokes.setPointerPassthrough(enabled);
      },
      async beginMove() {
        await invokes.beginMove({});
      },
      async beginResize(edge) {
        await invokes.beginResize(edge);
      },
      async setAlwaysOnTop(enabled) {
        await invokes.setAlwaysOnTop(enabled);
      },
      async centerOnCurrentDisplay() {
        await invokes.center({});
      },
    },
    globalShortcuts: {
      async register(shortcut, onKeyEvent) {
        const key = globalShortcutKey(shortcut);

        if (globalShortcutRegistrations.has(key)) {
          throw new Error("Global shortcut is already registered.");
        }

        globalShortcutRegistrations.set(key, onKeyEvent);

        let registered = false;
        try {
          await invokes.registerGlobalShortcut(shortcut);
          registered = true;
        } finally {
          if (!registered && globalShortcutRegistrations.get(key) === onKeyEvent) {
            globalShortcutRegistrations.delete(key);
          }
        }
      },
      async unregister(shortcut) {
        const key = globalShortcutKey(shortcut);
        const onKeyEvent = globalShortcutRegistrations.get(key);

        if (!onKeyEvent) {
          throw new Error("Global shortcut is not registered.");
        }

        await invokes.unregisterGlobalShortcut(shortcut);

        if (globalShortcutRegistrations.get(key) === onKeyEvent) {
          globalShortcutRegistrations.delete(key);
        }
      },
    },
  };
}
