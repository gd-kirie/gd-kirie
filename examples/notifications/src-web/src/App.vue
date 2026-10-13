<script setup lang="ts">
import { createContext } from "@gd-kirie/ipc-eventa";
import { createNotificationsClient, notificationActivated } from "@gd-kirie/notifications";
import Button from "@proj-airi/ui/src/components/misc/button.vue";
import { computed, onBeforeUnmount, ref } from "vue";

const eventa = window.kirie ? createContext() : undefined;
const notifications = eventa ? createNotificationsClient(eventa.context) : undefined;
const title = ref("Kirie Notifications");
const body = ref("Click this notification to return its ID to the WebView.");
const status = ref(notifications ? "Ready" : "Browser preview");
const statusTone = computed(() => status.value.startsWith("Activated") ? "activated" : "idle");
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
  <main class="min-h-screen bg-neutral-50 p-4 text-neutral-900 sm:p-6 md:p-8">
    <div class="mx-auto max-w-4xl flex flex-col gap-4">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">
            Kirie Notifications
          </h1>
          <p class="mt-1 text-sm text-neutral-500">
            Send a native notification and receive its activation in the WebView.
          </p>
        </div>
        <output
          class="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-xs text-neutral-600 shadow-sm"
        >
          <span
            class="h-2 w-2 rounded-full"
            :class="statusTone === 'activated' ? 'bg-emerald-500' : 'bg-primary-400'"
          />
          {{ status }}
        </output>
      </header>

      <section class="grid gap-5 rounded-2xl border-2 border-neutral-200 bg-white/70 p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(16rem,.8fr)] md:p-6">
        <form class="flex flex-col gap-4" @submit.prevent="show">
          <div>
            <h2 class="text-base font-semibold">
              Notification content
            </h2>
            <p class="mt-1 text-xs text-neutral-500">
              The system owns presentation after the notification is sent.
            </p>
          </div>

          <label class="flex flex-col gap-1.5 text-xs text-neutral-600 font-medium">
            <span>Title</span>
            <input
              v-model="title"
              class="rounded-lg border-2 border-neutral-100 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-primary-300 focus:bg-white"
              required
            >
          </label>

          <label class="flex flex-1 flex-col gap-1.5 text-xs text-neutral-600 font-medium">
            <span>Body</span>
            <textarea
              v-model="body"
              class="min-h-16 flex-1 resize-none rounded-lg border-2 border-neutral-100 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition focus:border-primary-300 focus:bg-white"
              required
            />
          </label>

          <Button
            block
            :disabled="!notifications"
            label="Show notification"
            size="sm"
            type="submit"
            variant="primary"
          />
        </form>

        <aside class="flex flex-col justify-between gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <div>
            <p class="font-mono text-[11px] text-neutral-400 uppercase tracking-wider">
              Preview
            </p>
            <div class="mt-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div class="mb-3 h-1 w-10 rounded-full bg-primary-400" />
              <p class="text-sm font-semibold">
                {{ title || "Untitled notification" }}
              </p>
              <p class="mt-1 text-xs text-neutral-500 leading-relaxed">
                {{ body || "Notification body" }}
              </p>
            </div>
          </div>

          <ol class="grid grid-cols-3 gap-2 text-center text-[11px] text-neutral-500">
            <li class="rounded-lg bg-white px-2 py-2 shadow-sm">
              1 · Show
            </li>
            <li class="rounded-lg bg-white px-2 py-2 shadow-sm">
              2 · Click
            </li>
            <li class="rounded-lg bg-white px-2 py-2 shadow-sm">
              3 · Activate
            </li>
          </ol>
        </aside>
      </section>
    </div>
  </main>
</template>
