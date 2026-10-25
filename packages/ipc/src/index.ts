import { decode, encode } from "cborg";

import { createIframeTransport, iframeConfig } from "./iframe";

export { createIframeTransport } from "./iframe";
export type { KirieIframeConfig } from "./iframe";

const READY_MESSAGE = new ArrayBuffer(0);
const ENCODE_OPTIONS = { float64: true } as const;
let iframeTransport: KirieTransport | undefined;

export type KiriePlatformOs = "android" | "ios" | "macos" | "windows" | "linux" | "web";
export type KiriePlatformBackend = "webview" | "wkwebview" | "godot-cef" | "iframe";

export interface KiriePlatform {
  os: KiriePlatformOs;
  backend: KiriePlatformBackend;
}

export interface KirieRuntime {
  platform: KiriePlatform;
}

interface KirieAndroidChannel {
  postMessage(message: ArrayBuffer): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

interface KirieIosMessageHandler {
  postMessage(message: string): void;
}

type KirieLane = "text" | "binary" | "data";

interface KirieIosPacketMessage {
  lane: KirieLane;
  packet: string;
}

interface KirieIosWebkit {
  messageHandlers?: {
    kirie?: KirieIosMessageHandler;
  };
}

declare global {
  interface Window {
    kirie?: KirieRuntime;
    KirieTextChannel?: KirieAndroidChannel;
    KirieBinaryChannel?: KirieAndroidChannel;
    KirieDataChannel?: KirieAndroidChannel;
    webkit?: KirieIosWebkit;
    sendIpcMessage(message: string): void;
    sendIpcBinaryMessage(message: ArrayBuffer): void;
    sendIpcData(message: KirieData): void;
    onIpcMessage?: KirieMessageHandler<string>;
    onIpcBinaryMessage?: KirieMessageHandler<ArrayBuffer>;
    onIpcDataMessage?: KirieMessageHandler<KirieData>;
  }
}

/**
 * Structured data lane subset shared with Godot Variant data.
 * It intentionally excludes engine-local and JavaScript-local object types.
 */
export type KirieData =
  | null |
  boolean |
  number |
  string |
  KirieData[] |
  { [key: string]: KirieData };

export type KirieMessageHandler<TMessage> = (message: TMessage) => void;

export interface KirieTransport {
  sendText(message: string): void;
  sendBinary(bytes: Uint8Array): void;
  sendData(value: KirieData): void;
  onTextReceived(handler: KirieMessageHandler<string>): () => void;
  onBinaryReceived(handler: KirieMessageHandler<Uint8Array>): () => void;
  onDataReceived(handler: KirieMessageHandler<KirieData>): () => void;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

function asUint8Array(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  throw new TypeError("Kirie message must be an ArrayBuffer.");
}

function decodeText(value: unknown): string {
  const decoded = decode(asUint8Array(value));
  if (typeof decoded !== "string") {
    throw new TypeError("Kirie text message must decode to a string.");
  }

  return decoded;
}

function decodeBinary(value: unknown): Uint8Array {
  const decoded = decode(asUint8Array(value));
  if (decoded instanceof Uint8Array) {
    return decoded;
  }

  throw new TypeError("Kirie binary message must decode to bytes.");
}

function currentTransport(): KirieTransport {
  if (!window.kirie) {
    const config = iframeConfig(window);
    if (config) {
      window.kirie = {
        platform: { os: "web", backend: "iframe" },
      };
    }
  }
  const platform = window.kirie?.platform;
  if (platform?.os === "web" && platform.backend === "iframe") {
    const config = iframeConfig(window);
    if (!config) {
      throw new Error("Kirie iframe transport is unavailable.");
    }

    iframeTransport ??= createIframeTransport(window, config);
    return iframeTransport;
  }
  return transports[`${platform?.os}/${platform?.backend}`];
}

function listenAndroid<TMessage>(
  channel: KirieAndroidChannel,
  read: (value: unknown) => TMessage,
  handler: KirieMessageHandler<TMessage>,
): () => void {
  const listener = (event: MessageEvent): void => {
    handler(read(event.data));
  };

  channel.onmessage = listener;
  channel.postMessage(READY_MESSAGE);

  return () => {
    if (channel.onmessage === listener) {
      channel.onmessage = null;
    }
  };
}

function requireAndroidChannel(
  name: "KirieTextChannel" | "KirieBinaryChannel" | "KirieDataChannel",
): KirieAndroidChannel {
  const channel = window[name];
  if (!channel) {
    throw new Error(`Kirie Android channel is not available: ${name}`);
  }

  return channel;
}

const androidTransport: KirieTransport = {
  sendText(message) {
    requireAndroidChannel("KirieTextChannel").postMessage(
      asArrayBuffer(encode(message, ENCODE_OPTIONS)),
    );
  },

  sendBinary(bytes) {
    requireAndroidChannel("KirieBinaryChannel").postMessage(
      asArrayBuffer(encode(bytes, ENCODE_OPTIONS)),
    );
  },

  sendData(value) {
    requireAndroidChannel("KirieDataChannel").postMessage(
      asArrayBuffer(encode(value, ENCODE_OPTIONS)),
    );
  },

  onTextReceived(handler) {
    return listenAndroid(requireAndroidChannel("KirieTextChannel"), decodeText, handler);
  },

  onBinaryReceived(handler) {
    return listenAndroid(requireAndroidChannel("KirieBinaryChannel"), decodeBinary, handler);
  },

  onDataReceived(handler) {
    return listenAndroid(
      requireAndroidChannel("KirieDataChannel"),
      (value) => decode(asUint8Array(value)) as KirieData,
      handler,
    );
  },
};

function requireIosMessageHandler(): KirieIosMessageHandler {
  const handler = window.webkit?.messageHandlers?.kirie;
  if (!handler) {
    throw new Error(
      "Kirie iOS message handler is not available: window.webkit.messageHandlers.kirie",
    );
  }

  return handler;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToArrayBuffer(encoded: string): ArrayBuffer {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer as ArrayBuffer;
}

function postIosPacket(lane: KirieLane, packet: Uint8Array): void {
  requireIosMessageHandler().postMessage(
    JSON.stringify({
      lane,
      packet: bytesToBase64(packet),
    } satisfies KirieIosPacketMessage),
  );
}

function listenIos<TMessage>(
  lane: KirieLane,
  read: (value: unknown) => TMessage,
  handler: KirieMessageHandler<TMessage>,
): () => void {
  const listener = (event: Event): void => {
    if (!(event instanceof CustomEvent) || !isIosPacketMessage(event.detail)) {
      return;
    }

    if (event.detail.lane !== lane) {
      return;
    }

    handler(read(base64ToArrayBuffer(event.detail.packet)));
  };

  window.addEventListener("kirie:ipc-packet", listener);
  return () => window.removeEventListener("kirie:ipc-packet", listener);
}

function isIosPacketMessage(value: unknown): value is KirieIosPacketMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as Partial<KirieIosPacketMessage>;
  return (
    (message.lane === "text" || message.lane === "binary" || message.lane === "data") &&
    typeof message.packet === "string"
  );
}

const iosTransport: KirieTransport = {
  sendText(message) {
    postIosPacket("text", encode(message, ENCODE_OPTIONS));
  },

  sendBinary(bytes) {
    postIosPacket("binary", encode(bytes, ENCODE_OPTIONS));
  },

  sendData(value) {
    postIosPacket("data", encode(value, ENCODE_OPTIONS));
  },

  onTextReceived(handler) {
    return listenIos("text", decodeText, handler);
  },

  onBinaryReceived(handler) {
    return listenIos("binary", decodeBinary, handler);
  },

  onDataReceived(handler) {
    return listenIos("data", (value) => decode(asUint8Array(value)) as KirieData, handler);
  },
};

type KirieCefCallbackName = "onIpcMessage" | "onIpcBinaryMessage" | "onIpcDataMessage";

interface KirieCefCallbacks {
  onIpcMessage?: KirieMessageHandler<string>;
  onIpcBinaryMessage?: KirieMessageHandler<ArrayBuffer>;
  onIpcDataMessage?: KirieMessageHandler<KirieData>;
}

function listenCefLegacy<TName extends KirieCefCallbackName>(
  name: TName,
  handler: KirieCefCallbacks[TName],
): () => void {
  const callbacks = window as unknown as KirieCefCallbacks;
  callbacks[name] = handler;

  return () => {
    if (callbacks[name] === handler) {
      callbacks[name] = undefined;
    }
  };
}

const cefTransport: KirieTransport = {
  sendText(message) {
    window.sendIpcMessage(message);
  },

  sendBinary(bytes) {
    window.sendIpcBinaryMessage(asArrayBuffer(bytes));
  },

  sendData(value) {
    window.sendIpcData(value);
  },

  onTextReceived(handler) {
    // TODO: Switch to Godot CEF listener objects after the upstream addListener lifecycle fix ships.
    return listenCefLegacy("onIpcMessage", handler);
  },

  onBinaryReceived(handler) {
    return listenCefLegacy("onIpcBinaryMessage", (value) => handler(new Uint8Array(value)));
  },

  onDataReceived(handler) {
    return listenCefLegacy("onIpcDataMessage", handler);
  },
};

const transports: Record<string, KirieTransport> = {
  "android/webview": androidTransport,
  "ios/wkwebview": iosTransport,
  "linux/godot-cef": cefTransport,
  "macos/godot-cef": cefTransport,
  "windows/godot-cef": cefTransport,
};

export function sendText(message: string): void {
  currentTransport().sendText(message);
}

export function sendBinary(bytes: Uint8Array): void {
  currentTransport().sendBinary(bytes);
}

export function sendData(value: KirieData): void {
  currentTransport().sendData(value);
}

export function onTextReceived(handler: KirieMessageHandler<string>): () => void {
  return currentTransport().onTextReceived(handler);
}

export function onBinaryReceived(handler: KirieMessageHandler<Uint8Array>): () => void {
  return currentTransport().onBinaryReceived(handler);
}

export function onDataReceived(handler: KirieMessageHandler<KirieData>): () => void {
  return currentTransport().onDataReceived(handler);
}
