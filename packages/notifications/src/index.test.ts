import type { KirieEventaContext } from "@gd-kirie/ipc-eventa";
import { createContext, defineEventa } from "@moeru/eventa";
import { expect, it } from "vitest";

import { createNotificationsClient } from "./index";

it("shows a notification through the notifications wire", async () => {
  const context = createContext() as KirieEventaContext;
  const client = createNotificationsClient(context);
  const request = { id: "message-1", title: "Kirie", body: "Hello" };
  context.on(defineEventa<{ content: typeof request; invokeId: string }>("kirie:notifications:show-send"), ({ body }) => {
    expect(body?.content).toEqual(request);
    context.emit(defineEventa(`kirie:notifications:show-receive-${body!.invokeId}`), { content: {}, invokeId: body!.invokeId });
  });
  await expect(client.show(request)).resolves.toBeUndefined();
});
