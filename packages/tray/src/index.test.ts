import type { KirieEventaContext } from "@gd-kirie/ipc-eventa";
import type { TrayIcon, TrayMenuItem } from "./index";
import { createContext, defineEventa } from "@moeru/eventa";
import { describe, expect, it } from "vitest";
import { createTrayClient, trayMenuItemActivated } from "./index";

interface InvokeBody<T> {
  content: T;
  invokeId: string;
}

function respondToInvoke<T>(
  context: KirieEventaContext,
  name: string,
  expectedContent: T,
): void {
  context.on(defineEventa<InvokeBody<T>>(`${name}-send`), ({ body }) => {
    if (!body)
      throw new Error("Tray request has no body.");

    expect(body.content).toEqual(expectedContent);
    context.emit(
      defineEventa<InvokeBody<Record<string, never>>>(`${name}-receive-${body.invokeId}`),
      { content: {}, invokeId: body.invokeId },
    );
  });
}

describe("system tray", () => {
  it("uses the Tray plugin wire contract", async () => {
    const context = createContext() as KirieEventaContext;
    const tray = createTrayClient(context);
    const menu: TrayMenuItem[] = [
      { type: "item", id: "show", text: "Show Kirie" },
      { type: "check", id: "enabled", text: "Enabled", checked: true },
      { type: "separator" },
      {
        type: "submenu",
        text: "More",
        children: [{ type: "item", id: "quit", text: "Quit", enabled: false }],
      },
    ];
    const createIcon: TrayIcon = {
      icon: "res://tray-template.svg",
      iconAsTemplate: true,
    };
    const icon: TrayIcon = { icon: "res://icon.svg", iconAsTemplate: false };

    respondToInvoke(context, "kirie:tray:create", createIcon);
    respondToInvoke(context, "kirie:tray:set-icon", icon);
    respondToInvoke(context, "kirie:tray:set-menu", menu);
    respondToInvoke(context, "kirie:tray:set-tooltip", null);
    respondToInvoke(context, "kirie:tray:set-visible", false);
    respondToInvoke(context, "kirie:tray:destroy", {});

    await expect(tray.create(createIcon)).resolves.toBeUndefined();
    await expect(tray.setIcon(icon)).resolves.toBeUndefined();
    await expect(tray.setMenu(menu)).resolves.toBeUndefined();
    await expect(tray.setTooltip(null)).resolves.toBeUndefined();
    await expect(tray.setVisible(false)).resolves.toBeUndefined();
    await expect(tray.destroy()).resolves.toBeUndefined();
  });

  it("receives the activated menu item ID as the event body", () => {
    const context = createContext() as KirieEventaContext;
    let activatedId: string | undefined;

    context.on(trayMenuItemActivated, ({ body }) => {
      activatedId = body;
    });
    context.emit(trayMenuItemActivated, "show");

    expect(activatedId).toBe("show");
  });
});
