import { decode } from "cborg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPointerEventsHandler, phaseFromPointerEvent, sendPointerEvent } from "./index";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
});

describe("pointer input", () => {
  it("maps DOM pointer event types to Kirie phases", () => {
    expect(phaseFromPointerEvent(pointerEvent("pointerdown", 1, 1))).toBe("down");
    expect(phaseFromPointerEvent(pointerEvent("pointermove", 1, 1))).toBe("move");
    expect(phaseFromPointerEvent(pointerEvent("pointerup", 1, 0))).toBe("up");
    expect(phaseFromPointerEvent(pointerEvent("pointercancel", 1, 0))).toBe("cancel");
  });

  it("sends normalized pointer input over the Kirie data lane", () => {
    const postMessage = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        kirie: {
          platform: {
            os: "android",
            backend: "webview",
          },
        },
        KirieDataChannel: { postMessage },
      },
    });

    sendPointerEvent(
      pointerEvent("pointerdown", 7, 1, {
        pointerType: "touch",
        clientX: 120,
        clientY: 80,
        pressure: 0.75,
        view: {
          innerWidth: 480,
          innerHeight: 320,
        },
      }),
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const packet = decode(new Uint8Array(postMessage.mock.calls[0]?.[0] as ArrayBuffer));
    expect(packet).toEqual({
      __gd_kirie_control: {
        kind: "pointer",
        phase: "down",
        pointer_id: 7,
        pointer_type: "touch",
        normalized_x: 0.25,
        normalized_y: 0.25,
        button: 0,
        buttons: 1,
        pressure: 0.75,
      },
    });
  });

  it("forwards complete claimed pointer sequences and ignores orphan endings", () => {
    const sendPointer = vi.fn();
    const handler = createPointerEventsHandler(sendPointer);

    handler.capture(pointerEvent("pointerup", 7, 0));
    handler.bubble(pointerEvent("pointerdown", 7, 1));
    handler.capture(pointerEvent("pointermove", 7, 1));
    handler.capture(pointerEvent("pointerup", 7, 0));
    handler.capture(pointerEvent("pointerup", 7, 0));

    expect(sendPointer.mock.calls.map(([event]) => event.type)).toEqual([
      "pointerdown",
      "pointermove",
      "pointerup",
    ]);
  });

  it("cancels claimed pointers when requested", () => {
    const sendPointer = vi.fn();
    const handler = createPointerEventsHandler(sendPointer);

    handler.bubble(pointerEvent("pointerdown", 9, 1));
    handler.cancel();

    expect(sendPointer.mock.calls.map(([event, phase]) => [event.type, phase])).toEqual([
      ["pointerdown", undefined],
      ["pointerdown", "cancel"],
    ]);
  });
});

interface PointerEventOverrides {
  pointerType?: string;
  clientX?: number;
  clientY?: number;
  pressure?: number;
  view?: { innerWidth: number; innerHeight: number } | null;
}

function pointerEvent(
  type: string,
  pointerId: number,
  buttons: number,
  overrides: PointerEventOverrides = {},
): PointerEvent {
  const event = new Event(type);
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: overrides.pointerType ?? "mouse" },
    clientX: { value: overrides.clientX ?? 100 },
    clientY: { value: overrides.clientY ?? 75 },
    button: { value: 0 },
    buttons: { value: buttons },
    pressure: { value: overrides.pressure ?? (buttons === 0
      ? 0
      : 0.5) },
    view: { value: overrides.view ?? null },
  });
  return event as PointerEvent;
}
