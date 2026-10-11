import type { KirieData } from "../index";
import { sendData } from "../index";

export type PointerPhase = "down" | "move" | "up" | "cancel";
type PointerType = "mouse" | "pen" | "touch";

interface PointerInputRecord extends Record<string, KirieData> {
  kind: "pointer";
  phase: PointerPhase;
  pointer_id: number;
  pointer_type: PointerType;
  normalized_x: number;
  normalized_y: number;
  button: number;
  buttons: number;
  pressure: number;
}

interface PointerControlRecord extends Record<string, KirieData> {
  __gd_kirie_control: PointerInputRecord;
}

export type PointerEventSender = (event: PointerEvent, phase?: PointerPhase) => void;

export interface PointerEventsHandler {
  capture(event: PointerEvent): void;
  bubble(event: PointerEvent): void;
  cancel(): void;
}

export function sendPointerEvent(
  event: PointerEvent,
  phase: PointerPhase = phaseFromPointerEvent(event),
): void {
  const view = event.view ?? window;

  const pointerType = event.pointerType;
  if (pointerType !== "mouse" && pointerType !== "pen" && pointerType !== "touch") {
    throw new TypeError(`Kirie cannot forward pointer type: ${pointerType}`);
  }

  sendData({
    __gd_kirie_control: {
      kind: "pointer",
      phase,
      pointer_id: event.pointerId,
      pointer_type: pointerType,
      normalized_x: event.clientX / view.innerWidth,
      normalized_y: event.clientY / view.innerHeight,
      button: event.button,
      buttons: event.buttons,
      pressure: event.pressure,
    },
  } satisfies PointerControlRecord);
}

export function createPointerEventsHandler(
  sendPointer: PointerEventSender = sendPointerEvent,
): PointerEventsHandler {
  // A sequence is claimed only when its down event reaches the document bubble phase.
  const claimedPointers = new Map<number, PointerEvent>();

  /** Forwards move, up, and cancel events for pointer sequences claimed by `bubble`. */
  const capture = (event: PointerEvent): void => {
    if (
      !claimedPointers.has(event.pointerId) ||
      (event.type !== "pointermove" && event.type !== "pointerup" && event.type !== "pointercancel")
    ) {
      return;
    }

    sendPointer(event);
    if (event.type === "pointerup" || event.type === "pointercancel") {
      claimedPointers.delete(event.pointerId);
      return;
    }

    claimedPointers.set(event.pointerId, event);
  };

  /** Claims bubbled pointer downs and forwards unpressed mouse hover. */
  const bubble = (event: PointerEvent): void => {
    if (event.type === "pointerdown") {
      sendPointer(event);
      claimedPointers.set(event.pointerId, event);
      return;
    }

    if (
      event.type !== "pointermove" ||
      claimedPointers.has(event.pointerId) ||
      event.pointerType !== "mouse" ||
      event.buttons !== 0
    ) {
      return;
    }

    sendPointer(event);
  };

  /** Cancels every pointer sequence currently claimed by this handler. */
  const cancel = (): void => {
    for (const pointerEvent of claimedPointers.values()) {
      sendPointer(pointerEvent, "cancel");
    }
    claimedPointers.clear();
  };

  return { capture, bubble, cancel };
}

export function phaseFromPointerEvent(event: PointerEvent): PointerPhase {
  switch (event.type) {
    case "pointerdown":
      return "down";
    case "pointermove":
      return "move";
    case "pointerup":
      return "up";
    case "pointercancel":
      return "cancel";
    default:
      throw new TypeError(`Kirie cannot forward pointer event type: ${event.type}`);
  }
}
