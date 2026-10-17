import type { KirieEventaMessage } from "./index";
import { defineEventa, defineInvoke, defineInvokeEventa, defineInvokeHandler } from "@moeru/eventa";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext } from "./index";

const ipcMock = vi.hoisted(() => ({
  sendText: vi.fn<(message: string) => void>(),
  inboundTextHandler: undefined as ((message: string) => void) | undefined,
  unsubscribeText: vi.fn(),
}));

vi.mock("@gd-kirie/ipc", () => ({
  onTextReceived: vi.fn((handler: (message: string) => void) => {
    ipcMock.inboundTextHandler = handler;
    return ipcMock.unsubscribeText;
  }),
  sendText: ipcMock.sendText,
}));

function receiveText(message: string): void {
  if (!ipcMock.inboundTextHandler) {
    throw new Error("Kirie text handler is not registered.");
  }

  ipcMock.inboundTextHandler(message);
}

function readLastOutboundMessage(): KirieEventaMessage {
  const lastCall = ipcMock.sendText.mock.lastCall;
  if (!lastCall) {
    throw new Error("No outbound Kirie text message was sent.");
  }

  return JSON.parse(lastCall[0]) as KirieEventaMessage;
}

describe("createContext", () => {
  beforeEach(() => {
    ipcMock.sendText.mockClear();
    ipcMock.unsubscribeText.mockClear();
    ipcMock.inboundTextHandler = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends outbound events over Kirie text IPC", () => {
    const { context, dispose } = createContext();
    const event = defineEventa<{ value: number }>("test:event");

    context.emit(event, { value: 42 });

    expect(ipcMock.sendText).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ipcMock.sendText.mock.calls[0]?.[0] ?? "")).toMatchObject({
      id: expect.any(String),
      type: "test:event",
      payload: {
        body: {
          value: 42,
        },
        id: "test:event",
      },
    });

    dispose();
  });

  it("receives inbound Kirie text IPC as Eventa events", () => {
    const { context, dispose } = createContext();
    const event = defineEventa<{ value: number }>("test:event");
    const received = vi.fn();

    context.on(event, received);
    receiveText(
      JSON.stringify({
        type: "test:event",
        payload: {
          body: {
            value: 7,
          },
        },
      }),
    );

    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0]?.[0].body).toEqual({ value: 7 });

    dispose();
  });

  it("resolves unary Eventa RPC responses received over Kirie text IPC", async () => {
    const { context, dispose } = createContext();
    const event = defineInvokeEventa<{ output: string }, { input: number }>("test:rpc");

    const invoke = defineInvoke(context, event);
    const resultPromise = invoke({ input: 42 });
    const request = readLastOutboundMessage();
    // The fake peer must echo Eventa's generated RPC correlation id.
    const requestBody = request.payload.body as { invokeId: string };

    receiveText(
      JSON.stringify({
        type: `${event.receiveEvent.id}-${requestBody.invokeId}`,
        payload: {
          body: {
            invokeId: requestBody.invokeId,
            content: {
              output: "42",
            },
          },
        },
      }),
    );

    await expect(resultPromise).resolves.toEqual({ output: "42" });

    dispose();
  });

  it("rejects unary Eventa RPC errors received over Kirie text IPC", async () => {
    const { context, dispose } = createContext();
    const event = defineInvokeEventa<string, string, Error>("test:error-rpc");

    const invoke = defineInvoke(context, event);
    const resultPromise = invoke("payload");
    const request = readLastOutboundMessage();
    // The fake peer must echo Eventa's generated RPC correlation id.
    const requestBody = request.payload.body as { invokeId: string };

    receiveText(
      JSON.stringify({
        type: `${event.receiveEventError.id}-${requestBody.invokeId}`,
        payload: {
          body: {
            invokeId: requestBody.invokeId,
            content: {
              error: {
                message: "boom",
                name: "Error",
              },
            },
          },
        },
      }),
    );

    await expect(resultPromise).rejects.toMatchObject({
      message: "boom",
      name: "Error",
    });

    dispose();
  });

  it("sends unary Eventa RPC handler responses over Kirie text IPC", async () => {
    const { context, dispose } = createContext();
    const event = defineInvokeEventa<{ output: string }, { input: number }>("test:handler-rpc");

    defineInvokeHandler(context, event, ({ input }) => ({ output: String(input) }));

    receiveText(
      JSON.stringify({
        type: event.sendEvent.id,
        payload: {
          body: {
            invokeId: "invoke-1",
            content: {
              input: 42,
            },
          },
        },
      }),
    );

    await vi.waitFor(() => {
      expect(readLastOutboundMessage()).toMatchObject({
        type: "test:handler-rpc-receive-invoke-1",
        payload: {
          body: {
            content: {
              output: "42",
            },
            invokeId: "invoke-1",
          },
        },
      });
    });

    dispose();
  });

  it("sends unary Eventa RPC handler error events over Kirie text IPC", async () => {
    const { context, dispose } = createContext();
    const event = defineInvokeEventa<string, string, Error>("test:handler-error-rpc");

    defineInvokeHandler(context, event, () => {
      throw new Error("boom");
    });

    receiveText(
      JSON.stringify({
        type: event.sendEvent.id,
        payload: {
          body: {
            invokeId: "invoke-1",
            content: "payload",
          },
        },
      }),
    );

    await vi.waitFor(() => {
      expect(readLastOutboundMessage()).toMatchObject({
        type: "test:handler-error-rpc-receive-error-invoke-1",
        payload: {
          body: {
            content: {},
            invokeId: "invoke-1",
          },
        },
      });
    });

    dispose();
  });

  it("logs malformed inbound messages without dispatching a normal event", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { context, dispose } = createContext();
    const event = defineEventa("test:event");
    const received = vi.fn();

    context.on(event, received);
    receiveText("{");

    expect(received).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    dispose();
  });

  it("disposes outbound and inbound subscriptions", () => {
    const { context, dispose } = createContext();
    const event = defineEventa("test:event");

    dispose();
    context.emit(event, undefined);

    expect(ipcMock.sendText).not.toHaveBeenCalled();
    expect(ipcMock.unsubscribeText).toHaveBeenCalledTimes(1);
  });
});
