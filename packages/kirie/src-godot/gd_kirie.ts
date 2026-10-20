import { KirieGodotCefConfig } from "./godot_cef_config";

import { _PointerInputForwarder } from "./pointer_input_forwarder";
import { _WebIframeBackend } from "./web_iframe_backend";

export class GdKirie extends GodotObject {
  webview_ready = gd.signal();
  text_received = gd.signal<[message: string]>();
  binary_received = gd.signal<[bytes: PackedByteArray]>();
  data_received = gd.signal<[value: unknown]>();
  permission_requested = gd.signal<[permission_type: string, origin: string, request_id: int]>();
  ipc_error = gd.signal<[error: string]>();

  _pointer_input_forwarding_enabled = false;

  get pointer_input_forwarding_enabled(): boolean {
    return this._pointer_input_forwarding_enabled;
  }

  set pointer_input_forwarding_enabled(value: boolean) {
    this._pointer_input_forwarding_enabled = value;
    if (!value) {
      const cef_control = this._plugin_singleton instanceof Control ? this._plugin_singleton : null;
      this._pointer_input_forwarder.reset(cef_control);
    }
  }

  _web_backend: _WebIframeBackend | null = null;

  _notification(what: int): void {
    if (what === Object.NOTIFICATION_PREDELETE && this._web_backend !== null) {
      this._web_backend.destroy_webview();
    }
  }

  _plugin_singleton: TSOnly<GodotObject> | null = null;
  _view_id = this.get_instance_id();
  _pointer_input_forwarder = new _PointerInputForwarder();

  _init(): void {
    if (OS.has_feature("web")) {
      this._web_backend = new _WebIframeBackend();
      this._web_backend.webview_ready.connect(() => {
        this.webview_ready.emit();
      });
      this._web_backend.text_received.connect((message: string) => {
        this.text_received.emit(message);
      });
      this._web_backend.binary_received.connect((bytes: PackedByteArray) => {
        this.binary_received.emit(bytes);
      });
      this._web_backend.data_received.connect((value: unknown) => {
        this.data_received.emit(value);
      });
      this._web_backend.ipc_error.connect((error: string) => {
        this.ipc_error.emit(error);
      });
      return;
    }

    if (Engine.has_singleton(GdKirie.PLUGIN_SINGLETON_NAME)) {
      this._plugin_singleton = Engine.get_singleton(GdKirie.PLUGIN_SINGLETON_NAME);
      print("[Kirie][gd] platform singleton detected");
      this._connect_plugin_signals();
      return;
    }

    if (this._is_desktop_os()) {
      this._initialize_desktop_cef_backend();
      return;
    }

    print("[Kirie][gd] platform singleton unavailable");
  }

  create_webview(options: Dictionary = {}): void {
    let initial_url = "";
    if (options.has("initial_url")) {
      initial_url = `${options.get("initial_url")}`;
    }

    const parent_node: unknown = options.get("parent_node", null);
    if (parent_node !== null && !(parent_node instanceof Node)) {
      const error = "Kirie create_webview parent_node option must be a Node";
      push_error(error);
      this.ipc_error.emit(error);
      return;
    }

    if (this._web_backend !== null) {
      this._web_backend.create_webview(initial_url);
      return;
    }

    const plugin = this._ensure_plugin_singleton("create_webview");
    if (plugin === null) {
      return;
    }

    print(`[Kirie][gd] create_webview initial_url=${initial_url}`);
    if (this._is_godot_cef_backend()) {
      this._create_cef_webview(initial_url, parent_node);
      return;
    }

    plugin.call("createWebView", this._view_id, initial_url);
  }

  destroy_webview(): void {
    if (this._web_backend !== null) {
      this._web_backend.destroy_webview();
      return;
    }

    const cef_control = this._plugin_singleton instanceof Control ? this._plugin_singleton : null;
    this._pointer_input_forwarder.reset(cef_control);
    if (this._plugin_singleton === null) {
      return;
    }

    print("[Kirie][gd] destroy_webview");
    if (this._is_godot_cef_backend()) {
      this._destroy_cef_webview();
      return;
    }

    this._plugin_singleton.call("destroyWebView", this._view_id);
  }

  load_url(url: string): void {
    if (this._web_backend !== null) {
      this._web_backend.load_url(url);
      return;
    }

    const plugin = this._ensure_plugin_singleton("load_url");
    if (plugin === null) {
      return;
    }

    print(`[Kirie][gd] load_url url=${url}`);
    if (this._is_godot_cef_backend()) {
      plugin.set("url", url);
      return;
    }

    plugin.call("loadUrl", this._view_id, url);
  }

  load_html_string(html: string, base_url: string = ""): void {
    if (this._web_backend !== null) {
      this._web_backend.load_html_string(html, base_url);
      return;
    }

    const plugin = this._ensure_plugin_singleton("load_html_string");
    if (plugin === null) {
      return;
    }

    print(`[Kirie][gd] load_html_string bytes=${html.length()} base_url=${base_url}`);
    if (this._is_godot_cef_backend()) {
      push_error("Kirie Godot CEF backend does not support load_html_string() yet");
      return;
    }

    plugin.call("loadHtmlString", this._view_id, html, base_url);
  }

  send_text(message: string): void {
    if (this._web_backend !== null) {
      this._web_backend.send_text(message);
      return;
    }

    const plugin = this._ensure_plugin_singleton("send_text");
    if (plugin === null) {
      return;
    }

    if (this._is_godot_cef_backend()) {
      plugin.call("send_ipc_message", message);
      return;
    }

    plugin.call("sendText", this._view_id, message);
  }

  send_binary(bytes: PackedByteArray): void {
    if (this._web_backend !== null) {
      this._web_backend.send_binary(bytes);
      return;
    }

    const plugin = this._ensure_plugin_singleton("send_binary");
    if (plugin === null) {
      return;
    }

    print(`[Kirie][gd] send_binary bytes=${bytes.size()}`);
    if (this._is_godot_cef_backend()) {
      plugin.call("send_ipc_binary_message", bytes);
      return;
    }

    plugin.call("sendBinary", this._view_id, bytes);
  }

  send_data(value: unknown): void {
    if (this._web_backend !== null) {
      this._web_backend.send_data(value);
      return;
    }

    const plugin = this._ensure_plugin_singleton("send_data");
    if (plugin === null) {
      return;
    }

    print(`[Kirie][gd] send_data ${value}`);
    // Android plugin methods are registered by concrete JVM parameter type.
    // Godot does not expose a Kotlin-side Variant parameter type, and JVM Object
    // parameters do not reliably carry Variant containers. Use Godot's supported
    // Dictionary conversion path as a private carrier, then unwrap on Android
    // before CBOR encoding.
    let supported = value == null;
    if (value != null) {
      supported = gd.is(value, bool) ||
        gd.is(value, int) ||
        gd.is(value, float) ||
        gd.is(value, String) ||
        // tstogd converts this to GDScript's `is Array`; Array.isArray has no GDScript equivalent.
        // eslint-disable-next-line unicorn/no-instanceof-builtins
        value instanceof Array ||
        value instanceof Dictionary;
    }

    if (!supported) {
      push_error("Unsupported Kirie data type");
      return;
    }

    if (this._is_godot_cef_backend()) {
      plugin.call("send_ipc_data", value);
      return;
    }

    plugin.call("sendData", this._view_id, { value: value });
  }

  get_launch_option(key: string): string {
    if (this._web_backend !== null) {
      return this._web_backend.get_launch_option(key);
    }

    const plugin = this._ensure_plugin_singleton("get_launch_option");
    if (plugin === null) {
      return "";
    }

    let value = "";
    if (this._is_godot_cef_backend()) {
      value = this._get_desktop_launch_option(key);
    } else {
      value = `${plugin.call("getLaunchOption", key)}`;
    }

    print(`[Kirie][gd] get_launch_option key=${key} value=${value}`);
    return value;
  }

  grant_permission(request_id: int): boolean {
    return this._resolve_permission(request_id, true);
  }

  deny_permission(request_id: int): boolean {
    return this._resolve_permission(request_id, false);
  }

  is_available(): boolean {
    return this._web_backend !== null ? this._web_backend.is_available() : this._plugin_singleton !== null;
  }

  _get_desktop_launch_option(key: string): string {
    const option_names = PackedStringArray([key]);
    const dash_key = key.replace("_", "-");
    if (dash_key !== key) {
      option_names.append(dash_key);
    }

    const launch_args = OS.get_cmdline_user_args();
    for (let index = 0; index < launch_args.size(); index++) {
      const argument = launch_args.get(index);
      for (const option_name of option_names) {
        const option = `--${option_name}`;
        const option_prefix = `${option}=`;
        if (argument.begins_with(option_prefix)) {
          return argument.trim_prefix(option_prefix);
        }

        if (argument === option && index + 1 < launch_args.size()) {
          return launch_args.get(index + 1);
        }
      }
    }

    return "";
  }

  _connect_plugin_signals(): void {
    if (this._plugin_singleton === null) {
      return;
    }

    if (this._plugin_singleton.has_signal(StringName("webview_ready"))) {
      print("[Kirie][gd] connecting webview_ready signal");
      this._plugin_singleton.connect(StringName("webview_ready"), this._on_plugin_webview_ready);
    }

    if (this._plugin_singleton.has_signal(StringName("text_received"))) {
      print("[Kirie][gd] connecting text_received signal");
      this._plugin_singleton.connect(StringName("text_received"), this._on_plugin_text_received);
    }

    if (this._plugin_singleton.has_signal(StringName("binary_received"))) {
      print("[Kirie][gd] connecting binary_received signal");
      this._plugin_singleton.connect(
        StringName("binary_received"),
        this._on_plugin_binary_received,
      );
    }

    if (this._plugin_singleton.has_signal(StringName("data_received"))) {
      print("[Kirie][gd] connecting data_received signal");
      this._plugin_singleton.connect(StringName("data_received"), this._on_plugin_data_received);
    }

    if (this._plugin_singleton.has_signal(StringName("permission_requested"))) {
      print("[Kirie][gd] connecting permission_requested signal");
      this._plugin_singleton.connect(
        StringName("permission_requested"),
        this._on_plugin_permission_requested,
      );
    }

    if (this._plugin_singleton.has_signal(StringName("ipc_error"))) {
      print("[Kirie][gd] connecting ipc_error signal");
      this._plugin_singleton.connect(StringName("ipc_error"), this._on_plugin_ipc_error);
    }
  }

  _ensure_plugin_singleton(method_name: string): TSOnly<GodotObject> | null {
    if (this._plugin_singleton !== null) {
      return this._plugin_singleton;
    }

    if (this._is_desktop_os()) {
      this._initialize_desktop_cef_backend();
      if (this._plugin_singleton !== null) {
        return this._plugin_singleton;
      }
    }

    const error = `Kirie platform singleton is not available for ${method_name}()`;
    push_warning(error);
    this.ipc_error.emit(error);
    return null;
  }

  _resolve_permission(request_id: int, grant: boolean): boolean {
    if (this._web_backend !== null) {
      this.ipc_error.emit("Kirie Web does not support permission mediation");
      return false;
    }

    const method_name = grant ? "grant_permission" : "deny_permission";
    const plugin = this._ensure_plugin_singleton(method_name);
    if (plugin === null) {
      return false;
    }

    if (this._is_godot_cef_backend()) {
      const result = plugin.call(method_name, request_id);
      return gd.is(result, bool) && result;
    }

    const native_method_name = grant ? "grantPermission" : "denyPermission";
    if (plugin.has_method(native_method_name)) {
      const result = plugin.call(native_method_name, this._view_id, request_id);
      return gd.is(result, bool) && result;
    }

    const error = "Kirie permission mediation is not available on this platform";
    push_warning(error);
    this.ipc_error.emit(error);
    return false;
  }

  _should_ignore_view_signal(view_id: int): boolean {
    return view_id !== -1 && view_id !== this._view_id;
  }

  _is_godot_cef_backend(): boolean {
    return (
      this._plugin_singleton !== null &&
      this._plugin_singleton.is_class(KirieGodotCefConfig.CLASS_NAME)
    );
  }

  _initialize_desktop_cef_backend(): void {
    const cef_class_name = KirieGodotCefConfig.CLASS_NAME;
    if (!ClassDB.class_exists(cef_class_name)) {
      const message = `Kirie desktop backend requires Godot CEF to be installed and registered in [native_extensions]. Install it with: ${KirieGodotCefConfig.SETUP_COMMAND}`;
      push_error(message);
      const tree = Engine.get_main_loop();
      if (tree instanceof SceneTree) {
        tree.quit(1);
      }

      return;
    }

    const cef_backend = ClassDB.instantiate(cef_class_name);
    if (!(cef_backend instanceof Node)) {
      const error = `Failed to instantiate Godot CEF ${cef_class_name}`;
      this.ipc_error.emit(error);
      return;
    }

    this._plugin_singleton = cef_backend;
    cef_backend.name = "KirieCefWebView";
    // TODO(godot-cef#227): Re-evaluate accelerated OSR pointer-motion jitter after
    // godot-cef implements a synchronized CEF-to-Godot GPU texture handoff.
    // https://github.com/dsh0416/godot-cef/issues/227
    const preload_script = GdKirie.GODOT_CEF_PRELOAD_SCRIPT.replace(
      "%s",
      JSON.stringify(this._desktop_platform_os()),
    );
    this._set_cef_property_if_present("preload_script", preload_script);
    this._set_cef_property_if_present("background_color", Color.TRANSPARENT);
    this._set_cef_property_if_present("url", "about:blank");
    this._connect_cef_signals();
  }

  _is_desktop_os(): boolean {
    switch (OS.get_name()) {
      case "macOS":
      case "Windows":
      case "Linux":
      case "FreeBSD":
      case "NetBSD":
      case "OpenBSD":
      case "BSD":
        return true;
      default:
        return false;
    }
  }

  _create_cef_webview(initial_url: string, parent_node: Node | null = null): void {
    const browser = this._plugin_singleton;
    if (!(browser instanceof Node)) {
      const error = "Cannot create Godot CEF WebView because the desktop backend does not exist";
      this.ipc_error.emit(error);
      return;
    }

    if (browser.get_parent() !== null) {
      if (parent_node !== null && browser.get_parent() !== parent_node) {
        browser.reparent(parent_node);
      }

      if (initial_url !== "") {
        browser.set("url", initial_url);
      }

      this.call_deferred("_emit_cef_webview_ready");
      return;
    }

    if (!(Engine.get_main_loop() instanceof SceneTree)) {
      const error = "Cannot create Godot CEF WebView because no scene tree is available";
      this.ipc_error.emit(error);
      return;
    }

    this.call_deferred("_add_cef_webview_to_scene", initial_url, parent_node);
  }

  _add_cef_webview_to_scene(initial_url: string, parent_node: Node | null = null): void {
    const browser = this._plugin_singleton;
    if (!(browser instanceof Node)) {
      return;
    }

    if (browser.get_parent() === null) {
      const owner = this._resolve_cef_parent_node(parent_node);
      if (owner === null) {
        const error = "Cannot create Godot CEF WebView because no parent node is available";
        this.ipc_error.emit(error);
        return;
      }

      owner.add_child(browser);
    }

    this._configure_cef_layout();
    if (initial_url !== "") {
      browser.set("url", initial_url);
    }

    this._emit_cef_webview_ready();
  }

  _resolve_cef_parent_node(parent_node: Node | null = null): Node | null {
    if (parent_node !== null) {
      return parent_node;
    }

    const tree = Engine.get_main_loop();
    if (!(tree instanceof SceneTree)) {
      return null;
    }

    return tree.root;
  }

  _destroy_cef_webview(): void {
    const browser = this._plugin_singleton;
    if (!(browser instanceof Node)) {
      return;
    }

    browser.queue_free();
    this._plugin_singleton = null;
  }

  _connect_cef_signals(): void {
    const plugin = this._plugin_singleton;
    if (plugin === null) {
      return;
    }

    if (plugin.has_signal(StringName("ipc_message"))) {
      plugin.connect(StringName("ipc_message"), (message: string): void => {
        this._on_plugin_text_received(-1, message);
      });
    }

    if (plugin.has_signal(StringName("ipc_binary_message"))) {
      plugin.connect(StringName("ipc_binary_message"), (bytes: PackedByteArray): void => {
        this._on_plugin_binary_received(-1, bytes);
      });
    }

    if (plugin.has_signal(StringName("ipc_data_message"))) {
      plugin.connect(StringName("ipc_data_message"), (value: unknown): void => {
        this._on_plugin_data_received(-1, value);
      });
    }

    if (plugin.has_signal(StringName("permission_requested"))) {
      plugin.connect(
        StringName("permission_requested"),
        (permission_type: string, origin: string, request_id: int): void => {
          this._on_plugin_permission_requested(-1, permission_type, origin, request_id);
        },
      );
    }

    if (plugin.has_signal(StringName("load_error"))) {
      plugin.connect(StringName("load_error"), this._on_cef_load_error);
    }

    if (plugin.has_signal(StringName("render_process_terminated"))) {
      plugin.connect(
        StringName("render_process_terminated"),
        this._on_cef_render_process_terminated,
      );
    }
  }

  _configure_cef_layout(): void {
    const plugin = this._plugin_singleton;
    if (plugin instanceof Control) {
      plugin.set_anchors_preset(Control.PRESET_FULL_RECT);
      plugin.offset_left = 0;
      plugin.offset_top = 0;
      plugin.offset_right = 0;
      plugin.offset_bottom = 0;
      return;
    }

    if (plugin !== null && this._cef_backend_has_property("texture_size")) {
      plugin.set("texture_size", DisplayServer.window_get_size());
    }
  }

  _set_cef_property_if_present(property_name: string, value: unknown): void {
    const plugin = this._plugin_singleton;
    if (plugin === null || !this._cef_backend_has_property(property_name)) {
      return;
    }

    plugin.set(property_name, value);
  }

  _cef_backend_has_property(property_name: string): boolean {
    const plugin = this._plugin_singleton;
    if (plugin === null) {
      return false;
    }

    for (const property of plugin.get_property_list()) {
      if (`${property.get("name", "")}` === property_name) {
        return true;
      }
    }

    return false;
  }

  _desktop_platform_os(): string {
    switch (OS.get_name()) {
      case "macOS":
        return "macos";
      case "Windows":
        return "windows";
      default:
        return "linux";
    }
  }

  _emit_cef_webview_ready(): void {
    if (this._plugin_singleton === null) {
      return;
    }

    print("[Kirie][gd] signal webview_ready");
    this.webview_ready.emit();
  }

  _on_cef_load_error(url: string, error_code: int, error_text: string): void {
    this._on_plugin_ipc_error(
      -1,
      `Godot CEF failed to load ${url}: ${error_text} (${error_code})`,
    );
  }

  _on_cef_render_process_terminated(status: int, error_message: string): void {
    this._on_plugin_ipc_error(
      -1,
      `Godot CEF render process terminated: ${error_message} (${status})`,
    );
  }

  _on_plugin_webview_ready(view_id: int): void {
    if (this._should_ignore_view_signal(view_id)) {
      return;
    }

    print("[Kirie][gd] signal webview_ready");
    this.webview_ready.emit();
  }

  _on_plugin_text_received(view_id: int, message: string): void {
    if (this._should_ignore_view_signal(view_id)) {
      return;
    }

    // print("[Kirie][gd] signal text_received %s" % message)
    this.text_received.emit(message);
  }

  _on_plugin_binary_received(view_id: int, bytes: PackedByteArray): void {
    if (this._should_ignore_view_signal(view_id)) {
      return;
    }

    print(`[Kirie][gd] signal binary_received bytes=${bytes.size()}`);
    this.binary_received.emit(bytes);
  }

  _on_plugin_data_received(view_id: int, value: unknown): void {
    if (this._should_ignore_view_signal(view_id)) {
      return;
    }

    const cef_control = this._plugin_singleton instanceof Control ? this._plugin_singleton : null;
    if (
      this._pointer_input_forwarder.try_forward_pointer_input(
        value,
        this.pointer_input_forwarding_enabled,
        cef_control,
      )
    ) {
      return;
    }

    print(`[Kirie][gd] signal data_received ${value}`);
    this.data_received.emit(value);
  }

  _on_plugin_permission_requested(
    view_id: int,
    permission_type: string,
    origin: string,
    request_id: int,
  ): void {
    if (this._should_ignore_view_signal(view_id)) {
      return;
    }

    print(`[Kirie][gd] signal permission_requested type=${permission_type} origin=${origin} request_id=${request_id}`);
    this.permission_requested.emit(permission_type, origin, request_id);
  }

  _on_plugin_ipc_error(view_id: int, error: string): void {
    if (this._should_ignore_view_signal(view_id)) {
      return;
    }

    print(`[Kirie][gd] signal ipc_error ${error}`);
    this.ipc_error.emit(error);
  }
}

export namespace GdKirie {
  export const PLUGIN_SINGLETON_NAME = "Kirie";
  export const GODOT_CEF_PRELOAD_SCRIPT =
    "\nglobalThis.kirie ??= {};\nglobalThis.kirie.platform = Object.freeze({\n  os: %s,\n  backend: \"godot-cef\",\n});\n";
}
