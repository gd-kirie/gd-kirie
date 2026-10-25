import { expect, test } from "@vidot/vitest";

import { _IntegrationProbe } from "./integration_probe.ts";

test("keeps the IPC session alive while the node or its parent is hidden", async (context) => {
  if (context.root === null) {
    expect(context.root !== null).toBe(true);
    return;
  }

  const parent = new Control();
  parent.hide();
  context.root.add_child(parent);
  const probe = new _IntegrationProbe();
  probe.node.hide();
  probe.initialize(parent, context.tree);
  probe.node.initial_url = "res://src-web/dist/?probe=visibility";
  probe.node.create_webview();
  if (!expect(await probe.wait_for_ready(context)).toBe(true)) {
    return;
  }
  if (!expect(await probe.wait_for_text_message(context, "web_ready:visibility")).toBe(true)) {
    return;
  }

  probe.node.show();
  for (const visible of [false, true]) {
    parent.visible = visible;

    const message = `visibility:${visible}`;
    probe.node.send_text(message);
    if (!expect(await probe.wait_for_text_message(context, `web_text_echo:${message}`)).toBe(true)) {
      return;
    }
  }

  probe.node.hide();
  probe.node.send_text("hidden_node");
  expect(await probe.wait_for_text_message(context, "web_text_echo:hidden_node")).toBe(true);
  probe.node.show();
  probe.node.send_text("restored_node");
  expect(await probe.wait_for_text_message(context, "web_text_echo:restored_node")).toBe(true);
  expect(probe.ready_count()).toBe(1);
});

test("round trips IPC lanes", async (context) => {
  if (context.root === null) {
    expect(context.root !== null).toBe(true);
    return;
  }

  const probe_name = "ipc_round_trip";
  const probe = new _IntegrationProbe();
  probe.initialize(context.root, context.tree);
  probe.node.initial_url = `res://src-web/dist/?probe=${probe_name}`;
  probe.node.create_webview();
  if (!expect(await probe.wait_for_ready(context)).toBe(true)) {
    return;
  }
  if (!expect(await probe.wait_for_text_message(context, `web_ready:${probe_name}`)).toBe(true)) {
    return;
  }

  const text_payload = `godot_text:${probe_name}`;
  probe.node.send_text(text_payload);
  if (!expect(await context.waitUntil(
    () => probe.has_text_message(`web_text_echo:${text_payload}`),
    probe.timeout_milliseconds(),
  )).toBe(true)) {
    return;
  }

  const binary_payload = PackedByteArray([0, 1, 2, 127, 128, 255]);
  probe.node.send_binary(binary_payload);
  if (!expect(await context.waitUntil(
    () => probe.has_binary_message(binary_payload),
    probe.timeout_milliseconds(),
  )).toBe(true)) {
    return;
  }

  for (const data_payload of [
    42,
    [
      "array-root",
      7,
      null,
      { nested: true },
    ],
    null,
  ]) {
    probe.node.send_data(data_payload);
    if (!expect(await context.waitUntil(
      () => probe.has_data_echo(data_payload),
      probe.timeout_milliseconds(),
    )).toBe(true)) {
      return;
    }
    probe.clear_data_messages();
  }

  probe.node.send_text(`godot_ready:${probe_name}`);
  expect(await probe.wait_for_text_message(context, `web_ack:${probe_name}`)).toBe(true);
});

test("recreates a WebView", async (context) => {
  if (context.root === null) {
    expect(context.root !== null).toBe(true);
    return;
  }

  const probe = new _IntegrationProbe();
  probe.initialize(context.root, context.tree);
  for (const probe_name of ["first_create", "second_create"]) {
    probe.reset();
    probe.node.initial_url = `res://src-web/dist/?probe=${probe_name}`;
    probe.node.create_webview();
    if (!expect(await probe.wait_for_ready(context)).toBe(true)) {
      return;
    }
    if (!expect(await probe.wait_for_text_message(context, `web_ready:${probe_name}`)).toBe(true)) {
      return;
    }

    probe.node.send_text(`godot_ready:${probe_name}`);
    if (!expect(await probe.wait_for_text_message(context, `web_ack:${probe_name}`)).toBe(true)) {
      return;
    }

    probe.node.destroy_webview();
    await context.tree.create_timer(0.4).timeout;
  }
});

test("loads packaged web assets", async (context) => {
  if (context.root === null) {
    expect(context.root !== null).toBe(true);
    return;
  }

  const probe_name = "res_asset_loading";
  const probe = new _IntegrationProbe();
  probe.initialize(context.root, context.tree);
  probe.node.initial_url = "res://src-web/dist/?probe=res_asset_loading";
  probe.node.create_webview();
  if (!expect(await probe.wait_for_ready(context)).toBe(true)) {
    return;
  }
  if (!expect(await probe.wait_for_text_message(context, `web_ready:${probe_name}`)).toBe(true)) {
    return;
  }

  probe.node.send_text(`godot_ready:${probe_name}`);
  expect(await probe.wait_for_text_message(context, `web_ack:${probe_name}`)).toBe(true);
});

test("routes messages to the owning node", async (context) => {
  if (context.root === null) {
    expect(context.root !== null).toBe(true);
    return;
  }

  const first_probe = new _IntegrationProbe();
  first_probe.initialize(context.root, context.tree);
  const second_probe = new _IntegrationProbe();
  second_probe.initialize(context.root, context.tree);
  first_probe.node.initial_url = "res://src-web/dist/?probe=multi_node_a";
  first_probe.node.create_webview();
  second_probe.node.initial_url = "res://src-web/dist/?probe=multi_node_b";
  second_probe.node.create_webview();

  if (!expect(await first_probe.wait_for_ready(context)).toBe(true)) {
    return;
  }
  if (!expect(await second_probe.wait_for_ready(context)).toBe(true)) {
    return;
  }
  if (!expect(await first_probe.wait_for_text_message(context, "web_ready:multi_node_a")).toBe(true)) {
    return;
  }
  if (!expect(await second_probe.wait_for_text_message(context, "web_ready:multi_node_b")).toBe(true)) {
    return;
  }

  const payload = "godot_text:multi_node_a";
  const expected_echo = `web_text_echo:${payload}`;
  first_probe.node.send_text(payload);
  if (!expect(await context.waitUntil(
    () => first_probe.has_text_message(expected_echo),
    first_probe.timeout_milliseconds(),
  )).toBe(true)) {
    return;
  }

  await context.tree.create_timer(0.5).timeout;
  expect(second_probe.has_text_message(expected_echo)).toBe(false);
});
