interface KirieIframeHost extends JavaScriptObject {
  create(callback: JavaScriptObject | null, url: string): unknown;
  launch_option(key: string): unknown;
}

interface KirieIframeSession extends JavaScriptObject {
  destroy(): void;
  load_html(html: string, base_url: string): void;
  load_url(url: string): void;
  send(lane: string, value: unknown): void;
}

interface JavaScriptArray extends JavaScriptObject {
  readonly length: int;
  [index: number]: unknown;
  push(value: unknown): void;
}

interface JavaScriptRecord extends JavaScriptObject {
  [key: string]: unknown;
}

interface JavaScriptArrayConstructor extends JavaScriptObject {
  // This is the browser API name.
  // eslint-disable-next-line ts/naming-convention
  isArray(value: unknown): boolean;
}

interface JavaScriptObjectConstructor {
  keys(value: JavaScriptObject): JavaScriptArray;
}

export class _WebIframeBackend extends RefCounted {
  webview_ready = gd.signal();
  text_received = gd.signal<[message: string]>();
  binary_received = gd.signal<[bytes: PackedByteArray]>();
  data_received = gd.signal<[value: unknown]>();
  ipc_error = gd.signal<[error: string]>();

  _host: KirieIframeHost | null = null;
  _session: KirieIframeSession | null = null;
  _array_constructor: JavaScriptArrayConstructor | null = null;
  _object_constructor: JavaScriptObjectConstructor | null = null;
  // Retain the callback until JS removes every reference, as required by create_callback.
  // https://docs.godotengine.org/en/stable/classes/class_javascriptbridge.html#class-javascriptbridge-method-create-callback
  _callback: JavaScriptObject | null = null;

  _init(): void {
    JavaScriptBridge.eval(FileAccess.get_file_as_string("res://addons/kirie/iframe_host.js"), true);
    this._host = JavaScriptBridge.get_interface("__kirieIframeHost") as KirieIframeHost | null;
    this._array_constructor = JavaScriptBridge.get_interface("Array") as JavaScriptArrayConstructor | null;
    this._object_constructor = JavaScriptBridge.get_interface("Object") as JavaScriptObjectConstructor | null;
  }

  is_available(): boolean {
    return this._host !== null;
  }

  create_webview(url: string): void {
    this.destroy_webview();
    if (this._host === null) {
      this.ipc_error.emit("Kirie Web requires JavaScriptBridge and iframe_host.js");
      return;
    }

    this._callback = JavaScriptBridge.create_callback(this._on_message);
    const session = this._host.create(this._callback, url);
    if (!(session instanceof JavaScriptObject)) {
      this.ipc_error.emit("Kirie iframe host did not return a session");
      this._callback = null;
      return;
    }

    this._session = session as KirieIframeSession;
  }

  destroy_webview(): void {
    if (this._session !== null) {
      this._session.destroy();
      this._session = null;
    }

    this._callback = null;
  }

  load_url(url: string): void {
    if (this._session === null) {
      this.ipc_error.emit("Kirie iframe WebView does not exist");
      return;
    }

    this._session.load_url(url);
  }

  load_html_string(html: string, base_url: string): void {
    if (this._session === null) {
      this.ipc_error.emit("Kirie iframe WebView does not exist");
      return;
    }

    this._session.load_html(html, base_url);
  }

  send_text(message: string): void {
    this._send("text", message);
  }

  send_binary(bytes: PackedByteArray): void {
    const buffer = JavaScriptBridge.create_object("Uint8Array", bytes.size());
    if (!(buffer instanceof JavaScriptObject)) {
      this.ipc_error.emit("Kirie Web could not create a Uint8Array");
      return;
    }

    const view = buffer as JavaScriptArray;
    for (let index = 0; index < bytes.size(); index++) {
      view[index] = bytes.get(index);
    }

    this._send("binary", view);
  }

  send_data(value: unknown): void {
    if (!this._valid_data(value, 0)) {
      this.ipc_error.emit("Unsupported Kirie Web data payload (maximum depth: 64)");
      return;
    }

    this._send("data", this._to_js(value));
  }

  get_launch_option(key: string): string {
    return this._host === null ? "" : String(this._host.launch_option(key));
  }

  _send(lane: string, value: unknown): void {
    if (this._session === null) {
      this.ipc_error.emit("Kirie iframe WebView does not exist");
      return;
    }

    this._session.send(lane, value);
  }

  _valid_data(value: unknown, depth: int): boolean {
    // tstogd converts this to GDScript's `is Array`; Array.isArray has no GDScript equivalent.
    // eslint-disable-next-line unicorn/no-instanceof-builtins
    if (value instanceof Array) {
      if (depth >= 64) {
        return false;
      }

      for (const item of value as Array<unknown>) {
        if (!this._valid_data(item, depth + 1)) {
          return false;
        }
      }

      return true;
    }

    if (value instanceof Dictionary) {
      if (depth >= 64) {
        return false;
      }

      for (const key of value.keys()) {
        if (key == null || !gd.is(key, String) || !this._valid_data(value.get(key), depth + 1)) {
          return false;
        }
      }

      return true;
    }

    if (value == null) {
      return true;
    }

    if (gd.is(value, bool) || gd.is(value, String)) {
      return true;
    }

    if (gd.is(value, int)) {
      return value >= -9007199254740991 && value <= 9007199254740991;
    }

    if (gd.is(value, float)) {
      return is_finite(value);
    }

    return false;
  }

  _to_js(value: unknown): unknown {
    // tstogd converts this to GDScript's `is Array`; Array.isArray has no GDScript equivalent.
    // eslint-disable-next-line unicorn/no-instanceof-builtins
    if (value instanceof Array) {
      const result = JavaScriptBridge.create_object("Array") as JavaScriptArray;
      for (const item of value as Array<unknown>) {
        result.push(this._to_js(item));
      }

      return result;
    }

    if (value instanceof Dictionary) {
      const result = JavaScriptBridge.create_object("Object") as JavaScriptRecord;
      for (const key of value.keys()) {
        result[String(key)] = this._to_js(value.get(key));
      }

      return result;
    }

    return value;
  }

  _from_js(value: unknown): unknown {
    if (!(value instanceof JavaScriptObject) ||
      this._array_constructor === null ||
      this._object_constructor === null) {
      return value;
    }

    if (this._array_constructor.isArray(value)) {
      const array = value as JavaScriptArray;
      const result: Array<unknown> = [];
      for (let index = 0; index < array.length; index++) {
        result.append(this._from_js(array[index]));
      }

      return result;
    }

    const record = value as JavaScriptRecord;
    const keys = this._object_constructor.keys(record);
    const result: Record<string, unknown> = {};
    for (let index = 0; index < keys.length; index++) {
      const key = String(keys[index]);
      result[key] = this._from_js(record[key]);
    }

    return result;
  }

  _on_message(args: Array<unknown>): void {
    const lane = args.get(0);
    const value = args.get(1);
    if (lane === "ready") {
      this.webview_ready.emit();
    } else if (lane === "text") {
      this.text_received.emit(`${value}`);
    } else if (lane === "binary" && value instanceof JavaScriptObject) {
      this.binary_received.emit(JavaScriptBridge.js_buffer_to_packed_byte_array(value));
    } else if (lane === "data") {
      this.data_received.emit(this._from_js(value));
    } else if (lane === "error") {
      this.ipc_error.emit(`${value}`);
    }
  }
}
