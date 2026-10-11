import type { Eventa, EventContext, EventTag } from "@moeru/eventa";
import { onTextReceived, sendText } from "@gd-kirie/ipc";
import {
  and,
  createContext as createEventaContext,
  defineInboundEventa,
  defineOutboundEventa,
  EventaFlowDirection,
  matchBy,
  nanoid,
} from "@moeru/eventa";

export interface KirieEventaMessage {
  id: string;
  type: EventTag<unknown, unknown>;
  payload: Eventa<unknown>;
}

interface KirieEventaRawMessage {
  raw: {
    message: string;
  };
}

type KirieDirectionalEvent = Eventa<unknown> & {
  _flowDirection?: EventaFlowDirection;
};

export type KirieEventaContext = EventContext<unknown, KirieEventaRawMessage>;

export interface KirieEventaContextHandle {
  context: KirieEventaContext;
  dispose: () => void;
}

function createMessage(event: Eventa<unknown>): KirieEventaMessage {
  return {
    id: nanoid(),
    payload: {
      ...defineOutboundEventa(event.type),
      ...event,
    },
    type: event.id,
  };
}

export function createContext(): KirieEventaContextHandle {
  const context = createEventaContext<unknown, KirieEventaRawMessage>();
  const offOutbound = context.on(
    and(
      matchBy((event: KirieDirectionalEvent) => {
        return event._flowDirection === EventaFlowDirection.Outbound || !event._flowDirection;
      }),
      matchBy("*"),
    ),
    (event) => {
      sendText(JSON.stringify(createMessage(event)));
    },
  );

  const offInbound = onTextReceived((message) => {
    let parsed: KirieEventaMessage;
    try {
      parsed = JSON.parse(message) as KirieEventaMessage;
    } catch (error) {
      console.error("Failed to parse Kirie Eventa message:", error);
      return;
    }

    context.emit(defineInboundEventa(parsed.type), parsed.payload.body, {
      raw: {
        message,
      },
    });
  });

  return {
    context,
    dispose: () => {
      offOutbound();
      offInbound();
    },
  };
}
