<script setup lang="ts">
import type { GlobalShortcut, GlobalShortcutKeyEvent, HostWindowState } from "@gd-kirie/platform";
import { createContext } from "@gd-kirie/ipc-eventa";
import { backRequested, createPlatformClient, hostWindowPointerPositionChanged, hostWindowStateChanged } from "@gd-kirie/platform";
import Button from "@proj-airi/ui/src/components/misc/button.vue";
import { useIntervalFn } from "@vueuse/core";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const escapeShortcut: GlobalShortcut = {
  keycode: 4_194_305,
  shiftPressed: false,
  altPressed: false,
  ctrlPressed: false,
  metaPressed: false,
  commandOrControlAutoremap: false,
};

const eventa = window.kirie ? createContext() : undefined;
const platform = eventa ? createPlatformClient(eventa.context) : undefined;
const previewOffset = platform ? 0 : 0.15;
const pointer = ref({
  x: platform ? 0 : -Math.round(window.screen.width / 12),
  y: platform ? 0 : Math.round(window.screen.height / 5),
  inside: false,
});
const displayBounds = ref({
  x: 0,
  y: 0,
  width: window.screen.width,
  height: window.screen.height,
});
const windowBounds = ref({
  x: window.screen.width * previewOffset,
  y: window.screen.height * previewOffset,
  width: platform ? window.innerWidth : window.screen.width * 0.6,
  height: platform ? window.innerHeight : window.screen.height * 0.6,
});
const alwaysOnTop = ref(false);
const pointerPassthrough = ref(false);
const windowState = ref<HostWindowState>({
  focused: true,
  minimized: false,
  visible: true,
});
const busy = ref("");
const actionResult = ref("");
let escapeRegistered = false;
let stopWindowState: (() => void) | undefined;
let stopPointerPosition: (() => void) | undefined;
let stopBackRequest: (() => void) | undefined;
let boundsRequest: Promise<void> | undefined;
let telemetryActive = true;

const pointerStyle = computed(() => ({
  left: `${Math.max(0, Math.min(100, ((windowBounds.value.x + pointer.value.x - displayBounds.value.x) / displayBounds.value.width) * 100))}%`,
  top: `${Math.max(0, Math.min(100, ((windowBounds.value.y + pointer.value.y - displayBounds.value.y) / displayBounds.value.height) * 100))}%`,
}));
const displayStyle = computed(() => ({
  aspectRatio: `${Math.max(displayBounds.value.width, 1)} / ${Math.max(displayBounds.value.height, 1)}`,
}));
const windowStyle = computed(() => ({
  left: `${((windowBounds.value.x - displayBounds.value.x) / Math.max(displayBounds.value.width, 1)) * 100}%`,
  top: `${((windowBounds.value.y - displayBounds.value.y) / Math.max(displayBounds.value.height, 1)) * 100}%`,
  width: `${(windowBounds.value.width / Math.max(displayBounds.value.width, 1)) * 100}%`,
  height: `${(windowBounds.value.height / Math.max(displayBounds.value.height, 1)) * 100}%`,
}));

function refreshBounds(): void {
  if (!platform) {
    return;
  }

  if (boundsRequest) {
    return;
  }

  boundsRequest = Promise.all([
    platform.hostWindow.getBounds(),
    platform.hostWindow.getCurrentDisplayBounds(),
  ])
    .then(([window, display]) => {
      if (!telemetryActive) {
        return;
      }

      windowBounds.value = window;
      displayBounds.value = display;
    }, console.error)
    .finally(() => {
      boundsRequest = undefined;
    });
}

useIntervalFn(refreshBounds, 250, { immediateCallback: true });

onMounted(async () => {
  if (!eventa || !platform) {
    return;
  }

  try {
    stopBackRequest = eventa.context.on(backRequested, () => {
      actionResult.value = "System Back requested";
    });
    stopWindowState = eventa.context.on(hostWindowStateChanged, ({ body }) => {
      if (body)
        windowState.value = body;
    });
    stopPointerPosition = eventa.context.on(hostWindowPointerPositionChanged, ({ body }) => {
      if (body)
        pointer.value = body;
    });
    pointer.value = await platform.hostWindow.getPointerPosition();
    windowState.value = await platform.hostWindow.getState();
  } catch (error) {
    console.error(error);
  }
});

async function toggleAlwaysOnTop(): Promise<void> {
  if (!platform) {
    return Promise.resolve();
  }

  const enabled = !alwaysOnTop.value;
  await platform.hostWindow.setAlwaysOnTop(enabled);
  alwaysOnTop.value = enabled;
}

function handleEscape(event: GlobalShortcutKeyEvent): void {
  if (event.state !== "pressed" || !pointerPassthrough.value) {
    return;
  }

  disablePointerPassthrough();
}

async function enablePointerPassthrough(): Promise<void> {
  if (!platform) {
    return;
  }

  if (!escapeRegistered) {
    await platform.globalShortcuts.register(escapeShortcut, handleEscape);
    escapeRegistered = true;
  }

  await platform.hostWindow.setPointerPassthrough(true);
  pointerPassthrough.value = true;
}

async function disablePointerPassthrough(): Promise<void> {
  if (!platform) {
    return;
  }

  await platform.hostWindow.setPointerPassthrough(false);
  pointerPassthrough.value = false;
  if (escapeRegistered) {
    await platform.globalShortcuts.unregister(escapeShortcut);
    escapeRegistered = false;
  }
}

function togglePointerPassthrough(): Promise<void> {
  const enabled = !pointerPassthrough.value;
  return enabled ? enablePointerPassthrough() : disablePointerPassthrough();
}

function centerWindow(): Promise<void> {
  if (!platform) {
    return Promise.resolve();
  }

  return platform.hostWindow.centerOnCurrentDisplay();
}

async function openKirieWebsite(): Promise<void> {
  if (!platform) {
    return;
  }

  busy.value = "external-url";
  try {
    await platform.openExternalUrl("https://github.com/moeru-ai/godot-kirie");
    actionResult.value = "Opened the Kirie website in the system browser.";
  } catch (error) {
    console.error(error);
    actionResult.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = "";
  }
}

async function openApplicationDataDirectory(): Promise<void> {
  if (!platform) {
    return;
  }

  busy.value = "application-data";
  try {
    const path = await platform.openApplicationDataDirectory();
    actionResult.value = `Opened ${path}`;
  } catch (error) {
    console.error(error);
    actionResult.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = "";
  }
}

onBeforeUnmount(async () => {
  telemetryActive = false;
  try {
    stopBackRequest?.();
    stopWindowState?.();
    stopPointerPosition?.();
    if (pointerPassthrough.value || escapeRegistered) {
      await disablePointerPassthrough();
    }
  } catch (error) {
    console.error(error);
  } finally {
    eventa?.dispose();
  }
});
</script>

<template>
  <main class="min-h-screen bg-neutral-50 p-5 text-neutral-900 md:p-8">
    <div class="mx-auto max-w-5xl flex flex-col gap-5">
      <header class="flex items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">
            Kirie Platform
          </h1>
          <p class="mt-1 text-sm text-neutral-500">
            Host window controls and live pointer telemetry
          </p>
        </div>
        <p class="font-mono text-xs text-neutral-500">
          {{ windowState.visible ? "visible" : "hidden" }} ·
          {{ windowState.focused ? "focused" : "unfocused" }} ·
          {{ windowState.minimized ? "minimized" : "restored" }}
        </p>
      </header>

      <section class="rounded-2xl border-2 border-neutral-200 bg-white/70 p-5 shadow-sm md:p-6">
        <div
          class="window-stage relative mx-auto w-full max-w-2xl overflow-hidden rounded-xl border-2 border-neutral-400 bg-neutral-100/70"
          :style="displayStyle"
        >
          <span class="absolute left-2 top-2 rounded-md bg-neutral-700 px-2 py-1 font-mono text-xs text-white">
            Display · x {{ displayBounds.x }} · y {{ displayBounds.y }}
          </span>
          <span
            class="absolute bottom-2 right-2 rounded-md bg-white/90 px-2 py-1 font-mono text-xs text-neutral-600 shadow-sm"
          >
            {{ displayBounds.width }} × {{ displayBounds.height }}
          </span>
          <div class="absolute rounded-lg border-2 border-primary-500 bg-primary-50/50 shadow-sm" :style="windowStyle">
            <span
              class="absolute left-2 top-2 whitespace-nowrap rounded-md bg-primary-500 px-2 py-1 font-mono text-xs text-white"
            >
              Window · x {{ windowBounds.x }} · y {{ windowBounds.y }}
            </span>
            <span
              class="absolute bottom-2 right-2 whitespace-nowrap rounded-md bg-white/90 px-2 py-1 font-mono text-xs text-neutral-600 shadow-sm"
            >
              {{ windowBounds.width }} × {{ windowBounds.height }}
            </span>
          </div>
          <div
            class="pointer-dot absolute z-20 h-3 w-3 rounded-full bg-emerald-500"
            :style="pointerStyle"
          >
            <span class="absolute left-4 top-3 whitespace-nowrap font-mono text-xs text-emerald-700">
              {{ pointer.x }}, {{ pointer.y }}
            </span>
          </div>
        </div>

        <div class="mt-5 grid gap-3 md:grid-cols-3">
          <Button
            block :disabled="!platform || Boolean(busy)"
            :label="alwaysOnTop ? 'Disable always-on-top' : 'Enable always-on-top'" size="sm" :toggled="alwaysOnTop"
            variant="secondary-muted" @click="toggleAlwaysOnTop"
          />
          <Button
            block :disabled="!platform || Boolean(busy)"
            :label="pointerPassthrough ? 'Disable passthrough' : 'Enable mouse passthrough'" size="sm"
            :toggled="pointerPassthrough" variant="secondary-muted" @click="togglePointerPassthrough"
          />
          <Button
            block :disabled="!platform || Boolean(busy)" label="Center window" size="sm" variant="primary"
            @click="centerWindow"
          />
          <Button
            block :disabled="!platform || Boolean(busy)" label="Open Kirie website" size="sm"
            variant="secondary-muted" @click="openKirieWebsite"
          />
          <Button
            block :disabled="!platform || Boolean(busy)" label="Open app data directory" size="sm"
            variant="secondary-muted" @click="openApplicationDataDirectory"
          />
        </div>
        <p v-if="actionResult" class="mt-3 font-mono text-xs text-neutral-500">
          {{ actionResult }}
        </p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.window-stage {
  background-image:
    linear-gradient(rgb(163 163 163 / 14%) 1px, transparent 1px),
    linear-gradient(90deg, rgb(163 163 163 / 14%) 1px, transparent 1px);
  background-size: 20px 20px;
}

.pointer-dot {
  box-shadow: 0 0 0 5px rgb(16 185 129 / 18%);
  transform: translate(-50%, -50%);
}
</style>
