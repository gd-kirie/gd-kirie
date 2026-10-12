import type { KirieData, KirieMessageHandler, KirieTransport } from "./index";

export interface KirieIframeConfig {
  origin: string;
}

const protocol = "gd-kirie/iframe-port/1";

interface KirieIframeMessage {
  lane?: string;
  payload?: unknown;
  type: string;
}

/** The structured-clone subset excludes cycles and objects with custom prototypes. */
export function isKirieData(value: unknown, ancestors: Set<object> = new Set<object>(), depth: number = 0): value is KirieData {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
  }
  if (typeof value !== "object" || depth >= 64 || ancestors.has(value)) {
    return false;
  }

  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  if (Object.getOwnPropertySymbols(value).length !== 0 ||
    (array && Object.keys(value).some((key, index) => key !== String(index)))) {
    return false;
  }

  const entries = Object.entries(Object.getOwnPropertyDescriptors(value));
  if (array && entries.length !== (value as unknown[]).length + 1) {
    return false;
  }

  ancestors.add(value);
  const valid = entries.every(([key, descriptor]) => {
    if (array && key === "length") {
      return true;
    }
    return descriptor.enumerable && "value" in descriptor &&
      isKirieData(descriptor.value, ancestors, depth + 1);
  });
  ancestors.delete(value);
  return valid;
}

export function iframeConfig(scope: Window): KirieIframeConfig | undefined {
  if (scope.parent === scope || !scope.frameElement) {
    return undefined;
  }

  try {
    return { origin: scope.parent.location.origin };
  } catch {
    return undefined;
  }
}

export function createIframeTransport(scope: Window, config: KirieIframeConfig): KirieTransport {
  if (scope.parent === scope || !scope.frameElement || scope.parent.location.origin !== config.origin) {
    throw new Error("Kirie iframe transport requires a same-origin parent.");
  }

  let port: MessagePort | undefined;
  const pending: KirieIframeMessage[] = [];
  const listeners = {
    text: new Set<KirieMessageHandler<string>>(),
    binary: new Set<KirieMessageHandler<Uint8Array>>(),
    data: new Set<KirieMessageHandler<KirieData>>(),
  };

  const onPortMessage = (event: MessageEvent<unknown>): void => {
    const message = event.data as Partial<KirieIframeMessage> | null;
    if (!message || message.type !== "message") {
      return;
    }

    const payload = message.payload;
    if (message.lane === "text" && typeof payload === "string") {
      listeners.text.forEach((listener) => listener(payload));
    } else if (message.lane === "binary" && payload instanceof ArrayBuffer) {
      const bytes = new Uint8Array(payload);
      listeners.binary.forEach((listener) => listener(bytes));
    } else if (message.lane === "data" && isKirieData(payload)) {
      listeners.data.forEach((listener) => listener(payload));
    }
  };
  const onConnect = (event: MessageEvent<unknown>): void => {
    const message = event.data as { protocol?: unknown } | null;
    if (port || event.source !== scope.parent || event.origin !== config.origin ||
      message?.protocol !== protocol || event.ports.length !== 1) {
      return;
    }

    scope.removeEventListener("message", onConnect);
    port = event.ports[0];
    port.addEventListener("message", onPortMessage);
    port.start();
    port.postMessage({ type: "ready" });
    for (const message of pending.splice(0)) {
      port.postMessage(message);
    }
  };
  scope.addEventListener("message", onConnect);

  const send = (lane: string, payload: unknown): void => {
    const message = { type: "message", lane, payload };
    if (port) {
      port.postMessage(message);
    } else {
      pending.push(structuredClone(message));
    }
  };

  return {
    sendText(message) {
      if (typeof message !== "string") {
        throw new TypeError("Kirie text payload must be a string.");
      }
      send("text", message);
    },
    sendBinary(bytes) {
      if (!(bytes instanceof Uint8Array)) {
        throw new TypeError("Kirie binary payload must be a Uint8Array.");
      }
      send("binary", bytes.slice().buffer);
    },
    sendData(value) {
      if (!isKirieData(value)) {
        throw new TypeError("Unsupported Kirie data payload.");
      }
      send("data", value);
    },
    onTextReceived(handler) {
      listeners.text.add(handler);
      return () => listeners.text.delete(handler);
    },
    onBinaryReceived(handler) {
      listeners.binary.add(handler);
      return () => listeners.binary.delete(handler);
    },
    onDataReceived(handler) {
      listeners.data.add(handler);
      return () => listeners.data.delete(handler);
    },
  };
}
