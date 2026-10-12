import { KirieGodotCefConfig } from "./godot_cef_config";

interface KirieExportOption {
  option: { name: string; type: Variant.Type };
  default_value: boolean;
}

@tool
export class _ExportPlugin extends EditorExportPlugin {
  _get_name(): string {
    return _ExportPlugin.PLUGIN_NAME;
  }

  _supports_platform(platform: EditorExportPlatform): boolean {
    const os_name = platform.get_os_name().to_lower();
    return os_name === "android" || os_name === "ios" || os_name === "web" || this._export_platform_is_desktop(platform);
  }

  _get_export_features(platform: EditorExportPlatform, _debug: boolean): PackedStringArray {
    if (
      platform.get_os_name().to_lower() === "web" &&
      !this._dotnet_web_publish_path().is_empty()
    ) {
      return PackedStringArray(["dotnet"]);
    }

    return PackedStringArray();
  }

  _get_export_options(platform: EditorExportPlatform | null): Array<KirieExportOption> {
    if (platform !== null && platform.get_os_name().to_lower() === "web") {
      return [];
    }

    return [
      {
        option: { name: _ExportPlugin.OPTION_ENABLE_WEB_INSPECTOR, type: Variant.Type.TYPE_BOOL },
        default_value: false,
      },
      {
        option: { name: _ExportPlugin.OPTION_ALLOW_TLS_BYPASS, type: Variant.Type.TYPE_BOOL },
        default_value: false,
      },
    ];
  }

  _get_export_options_overrides(platform: EditorExportPlatform): Record<string, string> {
    if (platform.get_os_name().to_lower() !== "android") {
      return {};
    }

    const extra_args = this._android_extra_args_override();
    if (extra_args.is_empty()) {
      return {};
    }

    print(`[Kirie][export] override Android command line extra args: ${extra_args}`);
    return { "command_line/extra_args": extra_args };
  }

  _export_begin(features: PackedStringArray, _is_debug: boolean, _path: string, _flags: int): void {
    if (features.has("web")) {
      // JavaScript source is not a Godot resource; include it explicitly in the PCK.
      // https://docs.godotengine.org/en/stable/classes/class_editorexportplugin.html#class-editorexportplugin-method-add-file
      const host_path = "res://addons/kirie/iframe_host.js";
      const host_file = FileAccess.open(host_path, FileAccess.READ);
      if (host_file === null) {
        const error = "Kirie Web export requires addons/kirie/iframe_host.js. Regenerate the addon before export.";
        push_error(error);
        assert(false, error);
        return;
      }

      this.add_file(host_path, host_file.get_buffer(host_file.get_length()), false);

      const publish_path = this._dotnet_web_publish_path();
      if (!publish_path.is_empty()) {
        this._add_dotnet_web_csharp_script_stubs("res://");
        this._add_dotnet_web_publish(publish_path);
      }

      return;
    }

    if (this._features_are_desktop(features)) {
      this._assert_godot_cef_available();
      return;
    }

    if (features.has("android")) {
      this._add_android_web_asset_files(_ExportPlugin.DEFAULT_WEB_ROOT);
      return;
    }

    if (!features.has("ios")) {
      return;
    }

    this._add_ios_native_plugin(_is_debug);
    this._add_ios_runtime_configuration();
    this._add_ios_web_bundle_files(_ExportPlugin.DEFAULT_WEB_ROOT);
  }

  _get_android_dependencies(
    _platform: EditorExportPlatform | null,
    _debug: boolean,
  ): PackedStringArray {
    return PackedStringArray([
      "androidx.webkit:webkit:1.16.0",
      "com.fasterxml.jackson.dataformat:jackson-dataformat-cbor:2.21.3",
    ]);
  }

  _get_android_libraries(
    _platform: EditorExportPlatform | null,
    _debug: boolean,
  ): PackedStringArray {
    switch (this._get_android_aar_mode()) {
      case "debug":
        return PackedStringArray([_ExportPlugin.ANDROID_DEBUG_AAR]);
      case "release":
        return PackedStringArray([_ExportPlugin.ANDROID_RELEASE_AAR]);
    }

    const message = `[Kirie][export] invalid Android AAR mode. Use ${_ExportPlugin.ANDROID_DEBUG_AAR_ARG}=debug or ${_ExportPlugin.ANDROID_DEBUG_AAR_ARG}=release`;
    push_error(message);
    assert(false, message);
    return PackedStringArray();
  }

  _get_android_manifest_application_element_contents(
    _platform: EditorExportPlatform | null,
    _debug: boolean,
  ): string {
    return gd.ops.rem(
      "\n        <meta-data\n            android:name=\"%s\"\n            android:value=\"%s\" />\n        <meta-data\n            android:name=\"%s\"\n            android:value=\"%s\" />\n",
      [
        _ExportPlugin.ANDROID_META_ENABLE_WEB_INSPECTOR,
        this._xml_bool(this._option_enabled(_ExportPlugin.OPTION_ENABLE_WEB_INSPECTOR)),
        _ExportPlugin.ANDROID_META_ALLOW_TLS_BYPASS,
        this._xml_bool(this._option_enabled(_ExportPlugin.OPTION_ALLOW_TLS_BYPASS)),
      ],
    );
  }

  _get_android_aar_mode(): string {
    for (const arg of OS.get_cmdline_user_args()) {
      if (arg === `${_ExportPlugin.ANDROID_DEBUG_AAR_ARG}=debug`) {
        return "debug";
      }

      if (arg === `${_ExportPlugin.ANDROID_DEBUG_AAR_ARG}=release`) {
        return "release";
      }

      if (arg.begins_with(`${_ExportPlugin.ANDROID_DEBUG_AAR_ARG}=`)) {
        return "invalid";
      }
    }

    return "release";
  }

  _android_extra_args_override(): string {
    for (const arg of OS.get_cmdline_user_args()) {
      if (arg.begins_with(`${_ExportPlugin.ANDROID_EXTRA_ARGS_ARG}=`)) {
        return arg.substr(_ExportPlugin.ANDROID_EXTRA_ARGS_ARG.length() + 1);
      }
    }

    return "";
  }

  _dotnet_web_publish_path(): string {
    for (const arg of OS.get_cmdline_user_args()) {
      if (arg.begins_with(`${_ExportPlugin.DOTNET_WEB_PUBLISH_ARG}=`)) {
        return arg.substr(_ExportPlugin.DOTNET_WEB_PUBLISH_ARG.length() + 1);
      }
    }

    return "";
  }

  _add_dotnet_web_publish(publish_path: string): void {
    if (!DirAccess.dir_exists_absolute(publish_path)) {
      const message = `[Kirie][export] .NET Web publish directory not found: ${publish_path}`;
      push_error(message);
      assert(false, message);
      return;
    }

    const manifest_path = publish_path.path_join(_ExportPlugin.DOTNET_WEB_MANIFEST);
    const manifest_file = FileAccess.open(manifest_path, FileAccess.READ);
    if (manifest_file === null) {
      const message = `[Kirie][export] .NET Web publish manifest not found: ${manifest_path}`;
      push_error(message);
      assert(false, message);
      return;
    }

    if (!this._add_dotnet_web_publish_directory(publish_path, "")) {
      return;
    }

    const manifest_export_path = _ExportPlugin.DOTNET_WEB_EXPORT_ROOT.path_join(
      _ExportPlugin.DOTNET_WEB_MANIFEST,
    );
    this.add_file(
      manifest_export_path,
      manifest_file.get_buffer(manifest_file.get_length()),
      false,
    );
    print(`[Kirie][export] add .NET Web publish root: ${publish_path}`);
  }

  _add_dotnet_web_csharp_script_stubs(directory_path: string): void {
    for (const file_name of DirAccess.get_files_at(directory_path)) {
      if (!file_name.ends_with(".cs")) {
        continue;
      }

      const file_path = directory_path.path_join(file_name);
      this.add_file(file_path, "\n".to_utf8_buffer(), false);
    }

    for (const child_directory of DirAccess.get_directories_at(directory_path)) {
      if (this._dotnet_web_source_directory_is_ignored(child_directory)) {
        continue;
      }

      this._add_dotnet_web_csharp_script_stubs(directory_path.path_join(child_directory));
    }
  }

  _dotnet_web_source_directory_is_ignored(directory_name: string): boolean {
    if (directory_name.begins_with(".")) {
      return true;
    }

    switch (directory_name) {
      case "bin":
      case "node_modules":
      case "obj":
        return true;
      default:
        return false;
    }
  }

  _add_dotnet_web_publish_directory(publish_path: string, relative_directory: string): boolean {
    const directory_path = publish_path.path_join(relative_directory);
    for (const file_name of DirAccess.get_files_at(directory_path)) {
      const relative_path = relative_directory.path_join(file_name);
      if (relative_path === _ExportPlugin.DOTNET_WEB_MANIFEST) {
        continue;
      }

      if (this._dotnet_web_publish_file_is_filtered(relative_path)) {
        continue;
      }

      const file_path = publish_path.path_join(relative_path);
      const file = FileAccess.open(file_path, FileAccess.READ);
      if (file === null) {
        const message = `[Kirie][export] .NET Web publish file not readable: ${file_path}`;
        push_error(message);
        assert(false, message);
        return false;
      }

      const export_path = _ExportPlugin.DOTNET_WEB_EXPORT_ROOT.path_join(relative_path);
      this.add_file(export_path, file.get_buffer(file.get_length()), false);
    }

    for (const child_directory of DirAccess.get_directories_at(directory_path)) {
      const child_relative_directory = relative_directory.path_join(child_directory);
      if (!this._add_dotnet_web_publish_directory(publish_path, child_relative_directory)) {
        return false;
      }
    }

    return true;
  }

  _dotnet_web_publish_file_is_filtered(path: string): boolean {
    for (const suffix of _ExportPlugin.DOTNET_WEB_FILTERED_SUFFIXES) {
      if (path.ends_with(suffix)) {
        return true;
      }
    }

    return false;
  }

  _add_ios_runtime_configuration(): void {
    this.add_apple_embedded_platform_plist_content(
      gd.ops.rem("\n<key>%s</key>\n%s\n<key>%s</key>\n%s\n", [
        _ExportPlugin.IOS_PLIST_ENABLE_WEB_INSPECTOR_KEY,
        this._plist_bool(this._option_enabled(_ExportPlugin.OPTION_ENABLE_WEB_INSPECTOR)),
        _ExportPlugin.IOS_PLIST_ALLOW_TLS_BYPASS_KEY,
        this._plist_bool(this._option_enabled(_ExportPlugin.OPTION_ALLOW_TLS_BYPASS)),
      ]),
    );
    if (!this._option_enabled(_ExportPlugin.OPTION_ALLOW_TLS_BYPASS)) {
      return;
    }

    this.add_apple_embedded_platform_plist_content(
      _ExportPlugin.IOS_INSECURE_NETWORK_PLIST_CONTENT,
    );
  }

  _option_enabled(option_name: string): boolean {
    const value = this.get_option(option_name);
    return gd.is(value, bool) && value;
  }

  _xml_bool(value: boolean): string {
    if (value) {
      return "true";
    }

    return "false";
  }

  _plist_bool(value: boolean): string {
    if (value) {
      return "<true/>";
    }

    return "<false/>";
  }

  _add_android_web_asset_files(root_path: string): void {
    if (!this._has_web_entry(root_path)) {
      return;
    }

    print(`[Kirie][export] add Android web asset root: ${root_path}`);
    this._add_android_web_asset_directory(root_path);
  }

  _add_android_web_asset_directory(dir_path: string): boolean {
    // EditorExportPlugin only exposes add_file() for custom exported resources.
    // There is no Android directory-level API for resource files, so recurse here.
    for (const file_name of DirAccess.get_files_at(dir_path)) {
      const file_path = dir_path.path_join(file_name);
      const file = FileAccess.open(file_path, FileAccess.READ);
      if (file === null) {
        const message = `[Kirie][export] Android web asset file not readable: ${file_path}`;
        push_error(message);
        assert(false, message);
        return false;
      }

      this.add_file(file_path, file.get_buffer(file.get_length()), false);
    }

    for (const directory_name of DirAccess.get_directories_at(dir_path)) {
      const child_path = dir_path.path_join(directory_name);
      if (!this._add_android_web_asset_directory(child_path)) {
        return false;
      }
    }

    return true;
  }

  _has_web_entry(root_path: string): boolean {
    const index_path = root_path.path_join("index.html");
    if (FileAccess.file_exists(index_path)) {
      return true;
    }

    const message = `[Kirie][export] web entry not found: ${index_path}`;
    push_error(message);
    assert(false, message);
    return false;
  }

  _add_ios_web_bundle_files(root_path: string): void {
    if (!this._has_web_entry(root_path)) {
      return;
    }

    print(`[Kirie][export] add iOS bundle web root: ${root_path}`);
    this.add_apple_embedded_platform_bundle_file(root_path);
  }

  _add_ios_native_plugin(is_debug: boolean): void {
    let framework_path = _ExportPlugin.IOS_RELEASE_XCFRAMEWORK_PATH;
    if (is_debug) {
      framework_path = _ExportPlugin.IOS_DEBUG_XCFRAMEWORK_PATH;
    }

    if (!DirAccess.dir_exists_absolute(framework_path)) {
      const message = `[Kirie][export] iOS framework not found: ${framework_path}`;
      push_error(message);
      assert(false, message);
      return;
    }

    print(`[Kirie][export] add iOS framework: ${framework_path}`);
    this.add_apple_embedded_platform_framework(framework_path);
    for (const system_framework of _ExportPlugin.IOS_SYSTEM_FRAMEWORKS) {
      this.add_apple_embedded_platform_framework(system_framework);
    }

    this.add_apple_embedded_platform_cpp_code(_ExportPlugin.IOS_PLUGIN_CPP_CODE);
  }

  _export_platform_is_desktop(platform: EditorExportPlatform): boolean {
    const platform_name = platform.get_os_name().to_lower();
    switch (platform_name) {
      case "macos":
      case "windows":
      case "linux":
      case "linuxbsd":
      case "freebsd":
      case "netbsd":
      case "openbsd":
        return true;
      default:
        return false;
    }
  }

  _features_are_desktop(features: PackedStringArray): boolean {
    return (
      features.has("macos") ||
      features.has("windows") ||
      features.has("linux") ||
      features.has("linuxbsd") ||
      features.has("bsd")
    );
  }

  _assert_godot_cef_available(): void {
    if (DirAccess.dir_exists_absolute(KirieGodotCefConfig.ADDON_PATH)) {
      return;
    }

    const message = `[Kirie][export] desktop export requires Godot CEF at ${KirieGodotCefConfig.ADDON_PATH}. Install it with: ${KirieGodotCefConfig.SETUP_COMMAND}`;
    assert(false, message);
  }
}

export namespace _ExportPlugin {
  export const PLUGIN_NAME = "Kirie";
  export const DEFAULT_WEB_ROOT = "res://src-web/dist";
  export const OPTION_ENABLE_WEB_INSPECTOR = "kirie/debug/enable_web_inspector";
  export const OPTION_ALLOW_TLS_BYPASS = "kirie/debug/allow_tls_bypass";
  export const ANDROID_DEBUG_AAR_ARG = "--kirie-android-aar";
  export const ANDROID_EXTRA_ARGS_ARG = "--kirie-android-extra-args";
  export const DOTNET_WEB_PUBLISH_ARG = "--kirie-dotnet-web-publish";
  export const DOTNET_WEB_EXPORT_ROOT = "res://.godot/mono/publish/wasm32";
  export const DOTNET_WEB_MANIFEST = ".dotnet-publish-manifest";
  export const DOTNET_WEB_FILTERED_SUFFIXES = [
    ".c",
    ".h",
    ".ts",
    ".js",
    ".js.map",
    ".js.symbols",
    ".rsp",
    ".wasm",
  ];
  export const ANDROID_DEBUG_AAR = "kirie/libraries/android/Kirie-debug.aar";
  export const ANDROID_RELEASE_AAR = "kirie/libraries/android/Kirie-release.aar";
  export const ANDROID_META_ENABLE_WEB_INSPECTOR = "ai.moeru.kirie.ENABLE_WEB_INSPECTOR";
  export const ANDROID_META_ALLOW_TLS_BYPASS = "ai.moeru.kirie.ALLOW_TLS_BYPASS";
  export const IOS_PLIST_ENABLE_WEB_INSPECTOR_KEY = "KirieEnableWebInspector";
  export const IOS_PLIST_ALLOW_TLS_BYPASS_KEY = "KirieAllowTlsBypass";
  export const IOS_DEBUG_XCFRAMEWORK_PATH = "res://addons/kirie/ios/Kirie.debug.xcframework";
  export const IOS_RELEASE_XCFRAMEWORK_PATH = "res://addons/kirie/ios/Kirie.release.xcframework";
  export const IOS_SYSTEM_FRAMEWORKS = [
    "Foundation.framework",
    "UIKit.framework",
    "WebKit.framework",
  ];
  export const IOS_INSECURE_NETWORK_PLIST_CONTENT =
    "\n<key>NSAppTransportSecurity</key>\n<dict>\n    <key>NSAllowsArbitraryLoads</key>\n    <true/>\n    <key>NSAllowsArbitraryLoadsInWebContent</key>\n    <true/>\n    <key>NSAllowsLocalNetworking</key>\n    <true/>\n</dict>\n";
  export const IOS_PLUGIN_CPP_CODE =
    "\nextern void init_kirie();\nextern void deinit_kirie();\n\nvoid kirie_generated_plugin_initialize();\nvoid kirie_generated_plugin_deinitialize();\n\nvoid godot_apple_embedded_plugins_initialize() {\n\tinit_kirie();\n\tkirie_generated_plugin_initialize();\n}\n\nvoid godot_apple_embedded_plugins_deinitialize() {\n\tkirie_generated_plugin_deinitialize();\n\tdeinit_kirie();\n}\n\n#undef godot_apple_embedded_plugins_initialize\n#undef godot_apple_embedded_plugins_deinitialize\n#define godot_apple_embedded_plugins_initialize kirie_generated_plugin_initialize\n#define godot_apple_embedded_plugins_deinitialize kirie_generated_plugin_deinitialize\n\n";
}
