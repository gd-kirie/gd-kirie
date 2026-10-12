import type { KirieEventaContext } from "@gd-kirie/ipc-eventa";
import type { InboundEventa } from "@moeru/eventa";
import { defineInboundEventa, defineInvokeEventa, defineInvokes } from "@moeru/eventa";

export interface TrayIcon {
  icon: string;
  iconAsTemplate?: boolean;
}

export type TrayMenuItem =
  | { type: "item"; id: string; text: string; enabled?: boolean } |
  { type: "check"; id: string; text: string; enabled?: boolean; checked?: boolean } |
  { type: "submenu"; text: string; enabled?: boolean; children: TrayMenuItem[] } |
  { type: "separator" };

export interface TrayClient {
  create: (icon: TrayIcon) => Promise<void>;
  setIcon: (icon: TrayIcon) => Promise<void>;
  setMenu: (items: TrayMenuItem[]) => Promise<void>;
  setTooltip: (tooltip: string | null) => Promise<void>;
  setVisible: (visible: boolean) => Promise<void>;
  destroy: () => Promise<void>;
}

type EmptyPayload = Record<string, never>;

const events = {
  create: defineInvokeEventa<EmptyPayload, TrayIcon>("kirie:tray:create"),
  setIcon: defineInvokeEventa<EmptyPayload, TrayIcon>("kirie:tray:set-icon"),
  setMenu: defineInvokeEventa<EmptyPayload, TrayMenuItem[]>("kirie:tray:set-menu"),
  setTooltip: defineInvokeEventa<EmptyPayload, string | null>("kirie:tray:set-tooltip"),
  setVisible: defineInvokeEventa<EmptyPayload, boolean>("kirie:tray:set-visible"),
  destroy: defineInvokeEventa<EmptyPayload, EmptyPayload>("kirie:tray:destroy"),
};

export const trayMenuItemActivated: InboundEventa<string> = defineInboundEventa(
  "kirie:tray:menu-item-activated",
);

export function createTrayClient(context: KirieEventaContext): TrayClient {
  const invokes = defineInvokes(context, events);

  return {
    async create(icon) {
      await invokes.create(icon);
    },
    async setIcon(icon) {
      await invokes.setIcon(icon);
    },
    async setMenu(items) {
      await invokes.setMenu(items);
    },
    async setTooltip(tooltip) {
      await invokes.setTooltip(tooltip);
    },
    async setVisible(visible) {
      await invokes.setVisible(visible);
    },
    async destroy() {
      await invokes.destroy({});
    },
  };
}
