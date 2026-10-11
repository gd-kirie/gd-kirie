<script setup lang="ts">
import type { TrayMenuItem } from "@gd-kirie/tray";
import { createContext } from "@gd-kirie/ipc-eventa";
import { createTrayClient, trayMenuItemActivated } from "@gd-kirie/tray";
import Button from "@proj-airi/ui/src/components/misc/button.vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

interface MenuNode {
  key: string;
  type: TrayMenuItem["type"];
  id: string;
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
    id: "open",
    text: "Open Kirie",
    enabled: true,
    checked: false,
    children: [],
  },
  {
    key: "enabled",
    type: "check",
    id: "enabled",
    text: "Enabled",
    enabled: true,
    checked: true,
    children: [],
  },
  {
    key: "separator-main",
    type: "separator",
    id: "",
    text: "",
    enabled: true,
    checked: false,
    children: [],
  },
  {
    key: "tools",
    type: "submenu",
    id: "tools",
    text: "Tools",
    enabled: true,
    checked: false,
    children: [
      {
        key: "refresh",
        type: "item",
        id: "refresh",
        text: "Refresh",
        enabled: true,
        checked: false,
        children: [],
      },
      {
        key: "settings",
        type: "item",
        id: "settings",
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
    id: "quit",
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
  const id = `item-${Date.now()}-${nextId++}`;
  return {
    key: id,
    type: "item",
    id,
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
      id: node.id,
      text,
      enabled: node.enabled,
      checked: node.checked,
    };
  }

  return {
    type: "item",
    id: node.id,
    text,
    enabled: node.enabled,
  };
}

function findMenuItem(nodes: MenuNode[], id: string): MenuNode | undefined {
  for (const node of nodes) {
    if (node.id === id && (node.type === "item" || node.type === "check"))
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
              class="control-action control-action-primary"
              type="button"
              :disabled="!tray || trayReady"
              @click="runAction(initializeTray)"
            >
              Create
            </button>
            <button
              class="control-action control-action-danger"
              type="button"
              :disabled="!trayReady"
              @click="runAction(destroyTray)"
            >
              Destroy
            </button>
          </div>
        </div>

        <div class="mb-5 grid gap-3 sm:grid-cols-3">
          <div class="status-card">
            <span class="status-label">Platform</span>
            <strong>{{ os ?? "browser" }}</strong>
          </div>
          <div class="status-card">
            <span class="status-label">Lifecycle</span>
            <strong>{{ trayReady ? "created" : "not created" }}</strong>
          </div>
          <div class="status-card">
            <span class="status-label">Last activation</span>
            <strong class="font-mono">{{ lastClickedId || "none" }}</strong>
          </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-3">
          <label class="control-field">
            <span>Icon</span>
            <select
              v-model="useTemplateIcon"
              class="control-input"
              :disabled="!trayReady"
              @change="runAction(updateIcon)"
            >
              <option :value="false">Regular icon</option>
              <option v-if="os === 'macos'" :value="true">macOS template icon</option>
            </select>
            <code>{{ iconPath }}</code>
          </label>

          <label class="control-field">
            <span>Tooltip</span>
            <input
              v-model="tooltip"
              class="control-input"
              :disabled="!trayReady"
              placeholder="Clear the field to remove the tooltip"
            >
          </label>

          <label class="control-field">
            <span>Visibility</span>
            <span class="control-toggle">
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
            class="tree-row rounded-xl border border-neutral-200 bg-white p-3 shadow-sm"
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
              <label v-if="row.node.type !== 'separator'" class="row-toggle">
                <input v-model="row.node.enabled" type="checkbox">
                Enabled
              </label>
              <label v-if="row.node.type === 'check'" class="row-toggle">
                <input v-model="row.node.checked" type="checkbox">
                Checked
              </label>
              <span
                v-if="row.node.id && row.node.id === lastClickedId"
                class="shrink-0 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
              >
                Last clicked
              </span>
            </div>
            <div class="mt-2 flex flex-wrap justify-end gap-1.5 md:mt-0 md:w-96 md:shrink-0">
              <button class="tree-action" type="button" @click="addAfter(row.path)">
                Add after
              </button>
              <button class="tree-action" type="button" :disabled="row.node.type !== 'submenu'" @click="addChild(row.path)">
                Add child
              </button>
              <button class="tree-action" type="button" :disabled="!canMove(row.path, -1)" @click="moveItem(row.path, -1)">
                Up
              </button>
              <button class="tree-action" type="button" :disabled="!canMove(row.path, 1)" @click="moveItem(row.path, 1)">
                Down
              </button>
              <button class="tree-action" type="button" :disabled="!canIndent(row.path)" @click="indentItem(row.path)">
                Indent
              </button>
              <button class="tree-action" type="button" :disabled="row.depth === 0" @click="outdentItem(row.path)">
                Outdent
              </button>
              <button class="tree-action tree-action-danger" type="button" @click="removeItem(row.path)">
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

<style scoped>
.status-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  border: 1px solid rgb(229 229 229);
  border-radius: 0.75rem;
  padding: 0.75rem;
  background: rgb(250 250 250);
  font-size: 0.875rem;
}

.status-label {
  color: rgb(115 115 115);
  font-size: 0.75rem;
}

.control-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  color: rgb(82 82 82);
  font-size: 0.75rem;
  font-weight: 500;
}

.control-field code {
  color: rgb(115 115 115);
  font-size: 0.6875rem;
  font-weight: 400;
}

.control-input {
  border: 1px solid rgb(229 229 229);
  border-radius: 0.5rem;
  padding: 0.5rem 0.625rem;
  background: rgb(250 250 250);
  color: rgb(38 38 38);
  outline: none;
}

.control-toggle,
.row-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 2.25rem;
  color: rgb(82 82 82);
  font-size: 0.75rem;
  font-weight: 400;
}

.control-action {
  border: 1px solid rgb(212 212 212);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: white;
  color: rgb(64 64 64);
  font-size: 0.75rem;
  font-weight: 500;
}

.control-action:hover:not(:disabled) {
  border-color: rgb(163 163 163);
  background: rgb(245 245 245);
}

.control-action:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.control-action-primary {
  border-color: rgb(37 99 235);
  background: rgb(37 99 235);
  color: white;
}

.control-action-primary:hover:not(:disabled) {
  border-color: rgb(29 78 216);
  background: rgb(29 78 216);
}

.control-action-danger {
  color: rgb(185 28 28);
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.tree-action {
  border: 1px solid rgb(229 229 229);
  border-radius: 0.5rem;
  padding: 0.375rem 0.625rem;
  color: rgb(82 82 82);
  font-size: 0.75rem;
  line-height: 1rem;
  transition:
    background-color 120ms,
    border-color 120ms;
}

.tree-action:hover:not(:disabled) {
  border-color: rgb(163 163 163);
  background: rgb(245 245 245);
}

.tree-action:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.tree-action-danger {
  color: rgb(185 28 28);
}

@media (max-width: 767px) {
  .tree-row {
    display: block;
  }
}
</style>
