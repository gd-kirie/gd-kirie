import { GdKirie } from "./gd_kirie";

export class KirieNode extends Control {
  webview_ready = gd.signal();
  text_received = gd.signal<[message: string]>();
  binary_received = gd.signal<[bytes: PackedByteArray]>();
  data_received = gd.signal<[value: unknown]>();
  permission_requested = gd.signal<[permission_type: string, origin: string, request_id: int]>();
  ipc_error = gd.signal<[error: string]>();
  @exports
  initial_url = "";

  @exports
  auto_create = true;

  @exports
  auto_destroy = true;

  // @gd.eval: @export
  pointer_input_forwarding_enabled: boolean = gd.getset({
    value: false,
    get: null,
    set: (value) => {
      this.pointer_input_forwarding_enabled = value;
      if (this._kirie !== null) {
        this._kirie.pointer_input_forwarding_enabled = value;
      }
    },
  });

  _kirie = new GdKirie();

  _ready(): void {
    this.visibility_changed.connect(this._sync_webview_visibility);
    this._sync_webview_visibility();
    this._kirie.pointer_input_forwarding_enabled = this.pointer_input_forwarding_enabled;
    this._kirie.webview_ready.connect((): void => {
      this.webview_ready.emit();
    });
    this._kirie.text_received.connect((message: string): void => {
      this.text_received.emit(message);
    });
    this._kirie.binary_received.connect((bytes: PackedByteArray): void => {
      this.binary_received.emit(bytes);
    });
    this._kirie.data_received.connect((value: unknown): void => {
      this.data_received.emit(value);
    });
    this._kirie.permission_requested.connect(
      (permission_type: string, origin: string, request_id: int): void => {
        this.permission_requested.emit(permission_type, origin, request_id);
      },
    );
    this._kirie.ipc_error.connect((error: string): void => {
      this.ipc_error.emit(error);
    });
    if (!this.auto_create) {
      return;
    }

    this.create_webview();
  }

  _exit_tree(): void {
    if (this.visibility_changed.is_connected(this._sync_webview_visibility)) {
      this.visibility_changed.disconnect(this._sync_webview_visibility);
    }

    if (!is_instance_valid(this._kirie)) {
      return;
    }

    if (this.auto_destroy) {
      this._kirie.destroy_webview();
    }

    this._kirie.free();
  }

  create_webview(options: Dictionary = {}): void {
    const create_options = options.duplicate();
    create_options.set("parent_node", this);
    if (!create_options.has("initial_url")) {
      create_options.set("initial_url", this.initial_url);
    }

    this._sync_webview_visibility();
    this._kirie.create_webview(create_options);
  }

  _sync_webview_visibility(): void {
    this._kirie._set_webview_visible(this.is_visible_in_tree());
  }

  destroy_webview(): void {
    this._kirie.destroy_webview();
  }

  load_url(url: string): void {
    this._kirie.load_url(url);
  }

  load_html_string(html: string, base_url: string = ""): void {
    this._kirie.load_html_string(html, base_url);
  }

  send_text(message: string): void {
    this._kirie.send_text(message);
  }

  send_binary(bytes: PackedByteArray): void {
    this._kirie.send_binary(bytes);
  }

  send_data(value: unknown): void {
    this._kirie.send_data(value);
  }

  get_launch_option(key: string): string {
    return this._kirie.get_launch_option(key);
  }

  grant_permission(request_id: int): boolean {
    return this._kirie.grant_permission(request_id);
  }

  deny_permission(request_id: int): boolean {
    return this._kirie.deny_permission(request_id);
  }

  is_available(): boolean {
    return this._kirie.is_available();
  }
}
