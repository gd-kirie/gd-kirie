import type { TestContext } from "@vidot/vitest";
import { KirieNode } from "@gd-kirie/kirie/kirie-node";

export class _IntegrationProbe extends RefCounted {
  node = new KirieNode();
  private _binary_messages: Array<PackedByteArray> = [];
  private _data_messages: Array<unknown> = [];
  private _error = "";
  private _text_messages: Array<string> = [];
  private _ready_count = 0;

  initialize(root: Node, tree: SceneTree): void {
    this.node.auto_create = false;
    this.node.size = tree.root.get_visible_rect().size;
    root.add_child(this.node);
    this.node.webview_ready.connect((): void => {
      this._ready_count++;
    });
    this.node.text_received.connect((message: string): void => {
      this._text_messages.append(message);
    });
    this.node.binary_received.connect((bytes: PackedByteArray): void => {
      this._binary_messages.append(bytes);
    });
    this.node.data_received.connect((value: unknown): void => {
      this._data_messages.append(value);
    });
    this.node.ipc_error.connect((error: string): void => {
      this._error = error;
    });
  }

  reset(): void {
    this._binary_messages.clear();
    this._data_messages.clear();
    this._error = "";
    this._text_messages.clear();
    this._ready_count = 0;
  }

  ready_count(): int {
    return this._ready_count;
  }

  clear_data_messages(): void {
    this._data_messages.clear();
  }

  has_binary_message(expected: PackedByteArray): boolean {
    for (const bytes of this._binary_messages) {
      if (bytes === expected) {
        return true;
      }
    }

    return false;
  }

  has_data_echo(expected: unknown): boolean {
    for (const message of this._data_messages) {
      if (message === expected) {
        return true;
      }
    }

    return false;
  }

  has_text_message(expected: string): boolean {
    return this._text_messages.has(expected);
  }

  timeout_milliseconds(): int {
    return OS.get_name() === "iOS" ? 30_000 : 12_000;
  }

  async wait_for_text_message(
    context: TestContext,
    expected: string,
  ): Promise<boolean> {
    const received = await context.waitUntil(
      () => !this._error.is_empty() || this.has_text_message(expected),
      this.timeout_milliseconds(),
    );
    return received && this._error.is_empty();
  }

  async wait_for_ready(context: TestContext): Promise<boolean> {
    const ready = await context.waitUntil(
      () => !this._error.is_empty() || this._ready_count > 0,
      this.timeout_milliseconds(),
    );
    return ready && this._error.is_empty();
  }
}
