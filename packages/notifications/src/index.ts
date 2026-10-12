import type { KirieEventaContext } from "@gd-kirie/ipc-eventa";
import type { InboundEventa } from "@moeru/eventa";
import type { KiriePlugin } from "kirie/plugin";
import { defineInboundEventa, defineInvokeEventa, defineInvokes } from "@moeru/eventa";
import { defineKiriePlugin } from "kirie/plugin";

import packageJson from "../package.json" with { type: "json" };

export interface NotificationRequest {
  id: string;
  title: string;
  body: string;
}

export interface NotificationActivated {
  id: string;
}

export interface NotificationsClient {
  show: (notification: NotificationRequest) => Promise<void>;
}

type EmptyPayload = Record<string, never>;

const showNotification = defineInvokeEventa<EmptyPayload, NotificationRequest>(
  "kirie:notifications:show",
);

export const notificationActivated: InboundEventa<NotificationActivated> =
  defineInboundEventa<NotificationActivated>("kirie:notifications:activated");

export function createNotificationsClient(context: KirieEventaContext): NotificationsClient {
  const show = defineInvokes(context, { showNotification }).showNotification;
  return {
    async show(notification) {
      await show(notification);
    },
  };
}

const notifications: KiriePlugin = defineKiriePlugin({
  id: "notifications",
  dotnetPackages: [{ id: "GdKirie.Notifications", version: packageJson.version }],
  godotAddons: [
    {
      id: "kirie-notifications",
      path: "addons/kirie_notifications",
      source: { type: "bundled", url: new URL("../addon/kirie_notifications", import.meta.url).href },
      version: packageJson.version,
    },
    {
      id: "godot-notification-scheduler",
      path: "addons/kirie_notifications/vendor/godot-notification-scheduler-v6.0",
      source: {
        type: "remote",
        archivePath: "res",
        sha256: "7446e9b1701b04a95106b731bc96dfcff6689c8482e8865866bd63453333f581",
        url: "https://github.com/godot-mobile-plugins/godot-notification-scheduler/releases/download/v6.0/NotificationSchedulerPlugin-Multi-v6.0.zip",
      },
      version: "6.0",
    },
  ],
});

export default notifications;
