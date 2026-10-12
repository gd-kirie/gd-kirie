<script setup lang="ts">
import type { TrayMenuItem } from "@gd-kirie/tray";
import { createContext } from "@gd-kirie/ipc-eventa";
import { createTrayClient, trayMenuItemActivated } from "@gd-kirie/tray";
import Button from "@proj-airi/ui/src/components/misc/button.vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

interface MenuNode {
  key: string;
  type: TrayMenuItem["type"];
  text: string;
  enabled: boolean;
  checked: boolean;
  children: MenuNode[];
}

interface TreeRow {
  node: MenuNode;
  path: number[];
  depth: number;
}

const os = window.kirie?.platform.os;
const isDesktop = os === "linux" || os === "macos" || os === "windows";
const eventa = isDesktop ? createContext() : undefined;
const tray = eventa ? createTrayClient(eventa.context) : undefined;
const menuItems = ref<MenuNode[]>([
  {
    key: "open",
    type: "item",
    text: "Open Kirie",
    enabled: true,
    checked: false,
    children: [],
  },
  {
    key: "enabled",
    type: "check",
    text: "Enabled",
    enabled: true,
    checked: true,
    children: [],
  },
  {
    key: "separator-main",
    type: "separator",
    text: "",
    enabled: true,
    checked: false,
    children: [],
  },
  {
    key: "tools",
    type: "submenu",
    text: "Tools",
    enabled: true,
    checked: false,
    children: [
      {
        key: "refresh",
        type: "item",
        text: "Refresh",
        enabled: true,
        checked: false,
        children: [],
      },
      {
        key: "settings",
        type: "item",
        text: "Settings",
        enabled: false,
        checked: false,
        children: [],
      },
    ],
  },
  {
    key: "quit",
    type: "item",
    text: "Quit",
    enabled: true,
    checked: false,
    children: [],
  },
]);
const lastClickedId = ref("");
const trayReady = ref(false);
const status = ref(tray ? "Creating tray…" : "Tray requires a desktop Kirie host");
const tooltip = ref("Kirie Tray");
const visible = ref(true);
const useTemplateIcon = ref(os === "macos");
let nextId = 1;
let syncTimer: number | undefined;
let tooltipSyncTimer: number | undefined;
let stopTrayActivation: (() => void) | undefined;

const iconPath = computed(() => useTemplateIcon.value
  ? "res://tray-template.svg"
  : "res://icon.svg");

function flatten(nodes: MenuNode[], parentPath: number[] = [], depth = 0): TreeRow[] {
  return nodes.flatMap((node, index) => {
    const path = [...parentPath, index];
    return [
      { node, path, depth },
      ...(node.type === "submenu" ? flatten(node.children, path, depth + 1) : []),
    ];
  });
}

const rows = computed(() => flatten(menuItems.value));

function createNode(): MenuNode {
  const key = `item-${Date.now()}-${nextId++}`;
  return {
    key,
    type: "item",
    text: "New item",
    enabled: true,
    checked: false,
    children: [],
  };
}

function getSiblings(path: number[]): MenuNode[] {
  let siblings = menuItems.value;
  for (const index of path.slice(0, -1))
    siblings = siblings[index].children;
  return siblings;
}

function addRoot(): void {
  menuItems.value.push(createNode());
}

function addAfter(path: number[]): void {
  getSiblings(path).splice(path.at(-1)! + 1, 0, createNode());
}

function addChild(path: number[]): void {
  const node = getSiblings(path)[path.at(-1)!];
  if (node.type !== "submenu")
    return;

  node.children.push(createNode());
}

function removeItem(path: number[]): void {
  getSiblings(path).splice(path.at(-1)!, 1);
}

function moveItem(path: number[], offset: number): void {
  const siblings = getSiblings(path);
  const index = path.at(-1)!;
  const target = index + offset;
  if (target < 0 || target >= siblings.length)
    return;

  [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
}

function indentItem(path: number[]): void {
  const siblings = getSiblings(path);
  const index = path.at(-1)!;
  if (!canIndent(path))
    return;

  const [node] = siblings.splice(index, 1);
  siblings[index - 1].children.push(node);
}

function outdentItem(path: number[]): void {
  if (path.length < 2)
    return;

  const parentPath = path.slice(0, -1);
  const parentIndex = parentPath.at(-1)!;
  const [node] = getSiblings(path).splice(path.at(-1)!, 1);
  getSiblings(parentPath).splice(parentIndex + 1, 0, node);
}

function canMove(path: number[], offset: number): boolean {
  const target = path.at(-1)! + offset;
  return target >= 0 && target < getSiblings(path).length;
}

function canIndent(path: number[]): boolean {
  const index = path.at(-1)!;
  return index > 0 && getSiblings(path)[index - 1].type === "submenu";
}

function changeType(node: MenuNode, event: Event): void {
  const type = (event.target as HTMLSelectElement).value as MenuNode["type"];
  node.type = type;
  if (type !== "submenu")
    node.children = [];
}

function toTrayItem(node: MenuNode): TrayMenuItem {
  const text = node.text.trim() || "Untitled item";

  if (node.type === "separator")
    return { type: "separator" };

  if (node.type === "submenu") {
    return {
      type: "submenu",
      text,
      enabled: node.enabled,
      children: node.children.map(toTrayItem),
    };
  }

  if (node.type === "check") {
    return {
      type: "check",
      id: node.key,
      text,
      enabled: node.enabled,
      checked: node.checked,
    };
  }

  return {
    type: "item",
    id: node.key,
    text,
    enabled: node.enabled,
  };
}

function findMenuItem(nodes: MenuNode[], id: string): MenuNode | undefined {
  for (const node of nodes) {
    if (node.key === id && (node.type === "item" || node.type === "check"))
      return node;

    const child = findMenuItem(node.children, id);
    if (child)
      return child;
  }
}

async function syncTrayMenu(): Promise<void> {
  if (!tray || !trayReady.value)
    return;

  await tray.setMenu(menuItems.value.map(toTrayItem));
  status.value = "Tray menu synced";
}

function reportError(error: unknown): void {
  console.error(error);
  status.value = error instanceof Error ? error.message : String(error);
}

function runAction(action: () => Promise<void>): void {
  action().catch(reportError);
}

function scheduleTraySync(): void {
  if (!trayReady.value)
    return;

  window.clearTimeout(syncTimer);
  status.value = "Syncing changes…";
  syncTimer = window.setTimeout(() => syncTrayMenu().catch(reportError), 120);
}

function scheduleTooltipSync(): void {
  if (!trayReady.value)
    return;

  window.clearTimeout(tooltipSyncTimer);
  status.value = "Syncing tooltip…";
  tooltipSyncTimer = window.setTimeout(() => updateTooltip().catch(reportError), 120);
}

watch(menuItems, scheduleTraySync, { deep: true });
watch(tooltip, scheduleTooltipSync);

function selectedIcon() {
  return {
    icon: iconPath.value,
    iconAsTemplate: useTemplateIcon.value,
  };
}

async function initializeTray(): Promise<void> {
  if (!tray)
    return;

  await tray.create(selectedIcon());
  trayReady.value = true;
  await syncTrayMenu();
  await tray.setTooltip(tooltip.value || null);
  await tray.setVisible(visible.value);
  status.value = `Tray active on ${os}`;
}

async function updateIcon(): Promise<void> {
  if (!tray || !trayReady.value)
    return;

  await tray.setIcon(selectedIcon());
  status.value = `Icon set to ${iconPath.value}`;
}

async function updateTooltip(): Promise<void> {
  if (!tray || !trayReady.value)
    return;

  await tray.setTooltip(tooltip.value || null);
  status.value = tooltip.value ? "Tooltip updated" : "Tooltip cleared";
}

async function updateVisibility(): Promise<void> {
  if (!tray || !trayReady.value)
    return;

  await tray.setVisible(visible.value);
  status.value = visible.value ? "Tray shown" : "Tray hidden";
}

async function destroyTray(): Promise<void> {
  if (!tray || !trayReady.value)
    return;

  await tray.destroy();
  trayReady.value = false;
  status.value = "Tray destroyed";
}

onMounted(() => {
  if (!eventa || !tray)
    return;

  stopTrayActivation = eventa.context.on(trayMenuItemActivated, ({ body }) => {
    if (!body)
      return;

    lastClickedId.value = body;
    const item = findMenuItem(menuItems.value, body);
    if (item?.type === "check")
      item.checked = !item.checked;
  });

  runAction(initializeTray);
});

onBeforeUnmount(() => {
  window.clearTimeout(syncTimer);
  window.clearTimeout(tooltipSyncTimer);
  stopTrayActivation?.();
  eventa?.dispose();
});
</script>

<template>
  <main class="min-h-screen bg-neutral-50 p-5 text-neutral-900 md:p-8">
    <div class="mx-auto max-w-5xl flex flex-col gap-5">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">
            Kirie Tray
          </h1>
          <p class="mt-1 text-sm text-neutral-500">
            Exercise every public Tray plugin operation
          </p>
        </div>
        <p class="font-mono text-xs text-neutral-500">
          {{ status }}
        </p>
      </header>

      <section class="rounded-2xl border-2 border-neutral-200 bg-white/70 p-5 shadow-sm md:p-6">
        <div class="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold">
              Tray controls
            </h2>
            <p class="mt-1 text-xs text-neutral-500">
              Create, update, hide, show, and destroy the native tray.
            </p>
          </div>
          <div class="flex gap-2">
            <button
              class="rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-xs text-white font-medium enabled:hover:border-blue-700 enabled:hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              :disabled="!tray || trayReady"
              @click="runAction(initializeTray)"
            >
              Create
            </button>
            <button
              class="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs text-red-700 font-medium enabled:hover:border-neutral-400 enabled:hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              :disabled="!trayReady"
              @click="runAction(destroyTray)"
            >
              Destroy
            </button>
          </div>
        </div>

        <div class="mb-5 grid gap-3 sm:grid-cols-3">
          <div class="flex flex-col gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <span class="text-xs text-neutral-500">Platform</span>
            <strong>{{ os ?? "browser" }}</strong>
          </div>
          <div class="flex flex-col gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <span class="text-xs text-neutral-500">Lifecycle</span>
            <strong>{{ trayReady ? "created" : "not created" }}</strong>
          </div>
          <div class="flex flex-col gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <span class="text-xs text-neutral-500">Last activation</span>
            <strong class="font-mono">{{ lastClickedId || "none" }}</strong>
          </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-3">
          <label class="flex flex-col gap-2 text-xs text-neutral-600 font-medium">
            <span>Icon</span>
            <select
              v-model="useTemplateIcon"
              class="rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-2 text-neutral-800 outline-none"
              :disabled="!trayReady"
              @change="runAction(updateIcon)"
            >
              <option :value="false">Regular icon</option>
              <option v-if="os === 'macos'" :value="true">macOS template icon</option>
            </select>
            <code class="text-[11px] text-neutral-500 font-normal">{{ iconPath }}</code>
          </label>

          <label class="flex flex-col gap-2 text-xs text-neutral-600 font-medium">
            <span>Tooltip</span>
            <input
              v-model="tooltip"
              class="rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-2 text-neutral-800 outline-none"
              :disabled="!trayReady"
              placeholder="Clear the field to remove the tooltip"
            >
          </label>

          <label class="flex flex-col gap-2 text-xs text-neutral-600 font-medium">
            <span>Visibility</span>
            <span class="min-h-9 inline-flex items-center gap-1.5 text-xs text-neutral-600 font-normal">
              <input
                v-model="visible"
                type="checkbox"
                :disabled="!trayReady"
                @change="runAction(updateVisibility)"
              >
              {{ visible ? "Visible" : "Hidden" }}
            </span>
          </label>
        </div>
      </section>

      <section class="rounded-2xl border-2 border-neutral-200 bg-white/70 p-5 shadow-sm md:p-6">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-base font-semibold">
              Menu tree
            </h2>
            <p class="mt-1 text-xs text-neutral-500">
              Edit item, check, submenu, separator, enabled, and checked states.
            </p>
          </div>
          <Button label="Add root item" size="sm" variant="primary" @click="addRoot" />
        </div>

        <div v-if="rows.length" class="flex flex-col gap-2">
          <article
            v-for="row in rows"
            :key="row.node.key"
            class="block gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm md:flex md:items-center"
            :style="{ marginLeft: `${row.depth * 20}px` }"
          >
            <div class="min-w-0 flex flex-1 flex-wrap items-center gap-2">
              <span class="w-14 shrink-0 font-mono text-xs text-neutral-400">
                {{ row.depth === 0 ? "root" : `level ${row.depth}` }}
              </span>
              <select
                :value="row.node.type"
                :aria-label="`Type for ${row.node.text || 'separator'}`"
                class="rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-2 text-sm outline-none"
                @change="changeType(row.node, $event)"
              >
                <option value="item">Item</option>
                <option value="check">Check</option>
                <option value="submenu">Submenu</option>
                <option value="separator">Separator</option>
              </select>
              <input
                v-if="row.node.type !== 'separator'"
                v-model="row.node.text"
                :aria-label="`Label for ${row.node.text}`"
                class="min-w-32 flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              >
              <span v-else class="min-w-32 flex-1 text-sm text-neutral-400">
                Native separator
              </span>
              <label v-if="row.node.type !== 'separator'" class="min-h-9 inline-flex items-center gap-1.5 text-xs text-neutral-600 font-normal">
                <input v-model="row.node.enabled" type="checkbox">
                Enabled
              </label>
              <label v-if="row.node.type === 'check'" class="min-h-9 inline-flex items-center gap-1.5 text-xs text-neutral-600 font-normal">
                <input v-model="row.node.checked" type="checkbox">
                Checked
              </label>
              <span
                v-if="row.node.key === lastClickedId"
                class="shrink-0 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
              >
                Last clicked
              </span>
            </div>
            <div class="mt-2 flex flex-wrap justify-end gap-1.5 md:mt-0 md:w-96 md:shrink-0">
              <button class="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs leading-4 text-neutral-600 transition-colors enabled:hover:border-neutral-400 enabled:hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-35" type="button" @click="addAfter(row.path)">
                Add after
              </button>
              <button class="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs leading-4 text-neutral-600 transition-colors enabled:hover:border-neutral-400 enabled:hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-35" type="button" :disabled="row.node.type !== 'submenu'" @click="addChild(row.path)">
                Add child
              </button>
              <button class="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs leading-4 text-neutral-600 transition-colors enabled:hover:border-neutral-400 enabled:hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-35" type="button" :disabled="!canMove(row.path, -1)" @click="moveItem(row.path, -1)">
                Up
              </button>
              <button class="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs leading-4 text-neutral-600 transition-colors enabled:hover:border-neutral-400 enabled:hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-35" type="button" :disabled="!canMove(row.path, 1)" @click="moveItem(row.path, 1)">
                Down
              </button>
              <button class="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs leading-4 text-neutral-600 transition-colors enabled:hover:border-neutral-400 enabled:hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-35" type="button" :disabled="!canIndent(row.path)" @click="indentItem(row.path)">
                Indent
              </button>
              <button class="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs leading-4 text-neutral-600 transition-colors enabled:hover:border-neutral-400 enabled:hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-35" type="button" :disabled="row.depth === 0" @click="outdentItem(row.path)">
                Outdent
              </button>
              <button class="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs leading-4 text-red-700 transition-colors enabled:hover:border-neutral-400 enabled:hover:bg-neutral-100" type="button" @click="removeItem(row.path)">
                Delete
              </button>
            </div>
          </article>
        </div>

        <div v-else class="rounded-xl border border-dashed border-neutral-300 p-8 text-center">
          <p class="text-sm text-neutral-500">
            The tray menu is empty.
          </p>
          <button class="mt-3 text-sm font-medium text-primary-600" type="button" @click="addRoot">
            Add the first item
          </button>
        </div>
      </section>
    </div>
  </main>
</template>
