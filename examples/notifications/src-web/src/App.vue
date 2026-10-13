<script setup lang="ts">
import { createContext } from "@gd-kirie/ipc-eventa";
import { createNotificationsClient, notificationActivated } from "@gd-kirie/notifications";
import { onBeforeUnmount, ref } from "vue";

const eventa = window.kirie ? createContext() : undefined;
const notifications = eventa ? createNotificationsClient(eventa.context) : undefined;
const title = ref("Kirie Notifications");
const body = ref("Click this notification to return its ID to the WebView.");
const status = ref(notifications ? "Ready" : "Browser preview");
let nextId = 1;
const stop = eventa?.context.on(notificationActivated, ({ body: activation }) => {
  if (activation)
    status.value = `Activated ${activation.id}`;
});

async function show(): Promise<void> {
  if (!notifications)
    return;
  const id = `notification-${nextId++}`;
  try {
    await notifications.show({ id, title: title.value, body: body.value });
    status.value = `Sent ${id}`;
  } catch (error) {
    status.value = error instanceof Error ? error.message : JSON.stringify(error) ?? String(error);
  }
}

onBeforeUnmount(() => { stop?.(); eventa?.dispose(); });
</script>

<template>
  <main>
    <form @submit.prevent="show">
      <h1>Kirie Notifications</h1>
      <p>Send an immediate system notification and click it to return its ID.</p>
      <label>Title<input v-model="title" required></label>
      <label>Body<textarea v-model="body" required /></label>
      <button :disabled="!notifications" type="submit">Show notification</button>
      <output>{{ status }}</output>
    </form>
  </main>
</template>

<style>
:root { font-family: system-ui, sans-serif; color: #171717; background: #f5f5f5; }
main { min-height: 100vh; display: grid; place-items: center; }
form { width: min(42rem, calc(100% - 2rem)); display: grid; grid-template-columns: 1fr 1fr; gap: .4rem 1rem; padding: .5rem 1rem; border: 1px solid #ddd; border-radius: 1rem; background: white; }
h1, p, button, output { grid-column: 1 / -1; }
h1, p { margin: 0; } h1 { font-size: 1.5rem; } label { display: grid; gap: .4rem; } input, textarea, button { padding: .35rem .5rem; font: inherit; } textarea { min-height: 2.5rem; resize: vertical; } button { cursor: pointer; } output { font-family: monospace; color: #555; }
</style>
