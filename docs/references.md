# References

This file collects the primary official references for `godot-kirie`.

Use these links before relying on memory for engine behavior, Android plugin
packaging, or platform WebView bridge details.

## Godot

- [Node class (stable)](https://docs.godotengine.org/en/stable/classes/class_node.html)
  Reference for scene-tree ownership and node lifecycle callbacks used by
  `KirieNode`.
- [Window class (stable)](https://docs.godotengine.org/en/stable/classes/class_window.html)
  Reference for Godot window nodes. Kirie users may place `KirieNode` under a
  `Window`, but Kirie core does not own window organization. Platform uses its
  current screen, position, size, visibility, focus, and mode for host-window
  telemetry.
- [DisplayServer class (stable)](https://docs.godotengine.org/en/stable/classes/class_displayserver.html)
  Reference for the current display's position and pixel size.
- [Godot Android plugins (stable)](https://docs.godotengine.org/en/stable/tutorials/platform/android/android_plugin.html)
  Main reference for Godot Android plugin v2 packaging and export flow.
- [Exporting projects (stable)](https://docs.godotengine.org/en/stable/tutorials/export/exporting_projects.html)
  Reference for export templates, export presets, and platform SDK
  prerequisites used by `kirie doctor` and export diagnostics.
- [Command line tutorial (stable)](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html)
  Reference for `--import`, `--path`, `--remote-debug`, `--script`,
  `--build-solutions`, command-line running, and export behavior.
- [ProjectSettings (stable)](https://docs.godotengine.org/en/stable/classes/class_projectsettings.html)
  Reference for reading and saving `project.godot` through Godot instead of
  hand-editing the file from JavaScript.
- [ConfigFile (stable)](https://docs.godotengine.org/en/stable/classes/class_configfile.html)
  Reference for Godot's INI-like configuration file API and Variant-aware
  reading and writing.
- [GDScript reference: registering named classes](https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_basics.html#registering-named-classes)
  Reference for `class_name` scripts such as `GdKirie` and `KirieNode`, which
  Godot exposes as named/global script classes after project scanning.
- [Overview of debugging tools (stable)](https://docs.godotengine.org/en/stable/tutorials/scripting/debug/overview_of_debugging_tools.html)
  High-level reference for remote debugging and editor debugging workflows.
- [Debugger panel (stable)](https://docs.godotengine.org/en/stable/tutorials/scripting/debug/debugger_panel.html)
  Reference for runtime debugger capabilities such as scene inspection and
  stack or variable introspection.
- [EditorSettings (stable)](https://docs.godotengine.org/en/stable/classes/class_editorsettings.html)
  Reference for editor debugger settings such as automatic switching to the
  remote scene tree.
- [EditorExportPlugin (stable)](https://docs.godotengine.org/en/stable/classes/class_editorexportplugin.html)
  Reference for Android export hooks and Apple embedded platform hooks such as
  framework, plist, and C++ code injection.
- [Godot Object class architecture (stable)](https://docs.godotengine.org/en/stable/engine_details/architecture/object_class.html)
  Reference for registering `Object` classes with `GDREGISTER_CLASS`, binding
  methods in `_bind_methods`, and declaring native signals with `ADD_SIGNAL`.
- [EditorExportPlatformAndroid (stable)](https://docs.godotengine.org/en/stable/classes/class_editorexportplatformandroid.html)
  Android export platform settings, including Gradle build requirements.
- [iOS plugins index (stable)](https://docs.godotengine.org/en/stable/tutorials/platform/ios/index.html)
  Entry point for Godot iOS plugin documentation.
- [Creating iOS plugins](https://docs.godotengine.org/en/stable/tutorials/platform/ios/ios_plugin.html)
  Reference for Godot native iOS plugin entry points and `.xcframework`
  support. Kirie uses addon export hooks instead of a project-local `.gdip`
  shim.
- [Godot iOS plugins repository](https://github.com/godot-sdk-integrations/godot-ios-plugins)
  Upstream reference for Godot's official iOS plugin build model, including
  `release_debug` artifacts for debug export templates and `.xcframework`
  generation across device and simulator slices.
- [EditorExportPlatformIOS (stable)](https://docs.godotengine.org/en/stable/classes/class_editorexportplatformios.html)
  iOS export platform settings reference.
- [C#/.NET (stable)](https://docs.godotengine.org/en/stable/tutorials/scripting/c_sharp/index.html)
  Reference for Godot C# platform support, including Android and iOS export
  limitations.
- [Variant class (stable)](https://docs.godotengine.org/en/stable/classes/class_variant.html)
  Reference for Godot's cross-language dynamic value model.
- [C# Variant (stable)](https://docs.godotengine.org/en/stable/tutorials/scripting/c_sharp/c_sharp_variant.html)
  Reference for `Godot.Variant`, `Variant.Type`, and C# Variant-compatible
  types.
- [C# signals (stable)](https://docs.godotengine.org/en/stable/tutorials/scripting/c_sharp/c_sharp_signals.html)
  Reference for idiomatic C# event usage when working with Godot signals.
- [Signal class (stable)](https://docs.godotengine.org/en/stable/classes/class_signal.html)
  Reference for Godot signal behavior and cross-language signal concepts.
- [InputEventKey (Godot 4.7)](https://docs.godotengine.org/en/4.7/classes/class_inputeventkey.html)
  Reference for logical keycodes, physical keycodes, modifiers, pressed state,
  and keyboard echo behavior.
- [Godot 4.7.2 macOS key mapping](https://github.com/godotengine/godot/blob/4.7.2-stable/platform/macos/key_mapping_macos.mm)
  Upstream mapping between Godot keys and macOS virtual keycodes.

## Android

- [Android WebView](https://developer.android.com/reference/android/webkit/WebView)
  Primary API reference for WebView lifecycle, `addJavascriptInterface()`, and
  `evaluateJavascript()`.
- [JavascriptInterface](https://developer.android.com/reference/android/webkit/JavascriptInterface)
  Security-critical annotation reference for JavaScript-exposed methods.
- [WebMessage](https://developer.android.com/reference/android/webkit/WebMessage)
  Reference for message payloads when using the platform message APIs.
- [WebMessagePort](https://developer.android.com/reference/android/webkit/WebMessagePort)
  Reference for channel-style messaging on Android WebView.
- [AndroidX WebKit WebViewCompat](https://developer.android.com/reference/androidx/webkit/WebViewCompat)
  Reference for AndroidX WebView message listener APIs used by Kirie's Android
  ArrayBuffer IPC channels and document-start runtime injection.
- [AndroidX WebKit WebMessageCompat](https://developer.android.com/reference/androidx/webkit/WebMessageCompat)
  Reference for WebView message payload types, including ArrayBuffer support.
- [Android environment variables](https://developer.android.com/tools/variables)
  Reference for Android SDK environment variables such as `ANDROID_HOME`.
- [Upload your Android library](https://developer.android.com/studio/publish-library/upload-library)
  Publishing reference for Maven delivery of Android libraries and metadata.
- [Gradle dependency management basics](https://docs.gradle.org/current/userguide/declaring_dependencies_basics.html)
  Reference for module dependencies vs file dependencies and transitive
  dependency behavior.

## Apple

- [Xcode command-line tool reference](https://developer.apple.com/documentation/xcode/xcode-command-line-tool-reference)
  Official reference for command-line Xcode build and device-development
  tooling used by the public iOS export and run commands.
- [WKWebView](https://developer.apple.com/documentation/webkit/wkwebview)
  Primary API reference for embedded web content on Apple platforms.
- [WKScriptMessageHandler](https://developer.apple.com/documentation/webkit/wkscriptmessagehandler)
  Reference for JavaScript-to-native messaging through
  `window.webkit.messageHandlers`.
- [WKUserScriptInjectionTime.atDocumentStart](https://developer.apple.com/documentation/webkit/wkuserscriptinjectiontime/atdocumentstart)
  Reference for iOS document-start script injection before page content loads.
- [Tauri global-hotkey macOS backend](https://github.com/tauri-apps/global-hotkey/blob/dev/src/platform_impl/macos/mod.rs)
  Upstream implementation reference for Carbon hot-key registration and
  pressed/released event dispatch on the application event target.

## Windows

- [ToastNotificationManager](https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.toastnotificationmanager)
  WinRT API used to post a toast from an unpackaged desktop process.
- [INotificationActivationCallback](https://learn.microsoft.com/en-us/windows/win32/api/notificationactivationcallback/nn-notificationactivationcallback-inotificationactivationcallback)
  COM callback that receives a toast click while the process is running.
- [RoInitialize](https://learn.microsoft.com/en-us/windows/win32/api/roapi/nf-roapi-roinitialize)
  Each successful call requires a matching `RoUninitialize` call on that thread.
- [CoRegisterClassObject](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-coregisterclassobject)
  COM adds a class factory reference and releases it when registration ends.
- [Application User Model IDs](https://learn.microsoft.com/en-us/windows/win32/shell/appids)
  Identity an unpackaged executable must register before Windows will show its
  toasts.
- [Avalonia.Labs Windows notifications](https://github.com/AvaloniaUI/Avalonia.Labs/tree/main/src/Avalonia.Labs.Notifications/Windows)
  Implementation reference for the unpackaged AppUserModelID, COM activator,
  and direct WinRT toast calls.

## IPC formats and compatibility targets

- [Godot CEF methods](https://godotcef.org/api/methods)
  Reference for `CefTexture` browser controls, JavaScript `eval`, and Godot CEF
  JavaScript IPC send APIs.
- [Godot CEF properties](https://godotcef.org/api/properties)
  Reference for `CefTexture.preload_script`, `preload_script_path`, and URL
  loading behavior.
- [Godot CEF releases](https://github.com/dsh0416/godot-cef/releases)
  Desktop artifact source for Kirie. The current pin lives in
  `kirie/plugin/core`.
- [RFC 8949: Concise Binary Object Representation](https://www.rfc-editor.org/rfc/rfc8949.html)
  Stable CBOR specification used as the primary reference for Kirie IPC v1
  packet encoding.
- [Jackson CBOR data format](https://github.com/FasterXML/jackson-dataformats-binary/tree/2.21/cbor)
  Android native CBOR implementation used for dynamic data lane decoding through
  Jackson's tree model.
- [cborg](https://github.com/rvagg/cborg)
  Browser-side CBOR implementation used by `@gd-kirie/ipc`.
- [Godot CEF IPC signals](https://godotcef.org/api/signals)
  Reference implementation and future compatibility target for separate text,
  binary, and CBOR-backed data IPC lanes.
- [CEF `CefRenderProcessHandler`](https://cef-builds.spotifycdn.com/docs/112.3/classCefRenderProcessHandler.html)
  Reference for `OnContextCreated`, the desktop CEF hook closest to Kirie's
  future pre-page-script runtime injection point.
- [Eventa TypeScript repository](https://github.com/moeru-ai/eventa)
  Upstream TypeScript Eventa project that Kirie JavaScript adapters should
  integrate with rather than modify.
- [eventa.net repository](https://github.com/moeru-ai/eventa.net)
  Upstream C# Eventa project that `GdKirie.EventaAdapter` should integrate with
  rather than modify.

## Tray

- [`tray-icon`](https://github.com/tauri-apps/tray-icon)
  Upstream native tray implementation used by the optional Tray plugin.
- [`tray-icon` Cargo manifest](https://github.com/tauri-apps/tray-icon/blob/17e3196a15aa6174a21588ac4c5a52e322878479/Cargo.toml)
  Reference for the pinned `0.26.1` features and platform dependencies.
- [`muda` menu items](https://github.com/tauri-apps/muda/blob/88e0c3658a85668872c621f77d6aad1616f42780/src/items/mod.rs)
  Upstream menu types exposed through `tray-icon`.
- [NuGet native runtime assets](https://learn.microsoft.com/nuget/create-packages/native-files-in-net-packages)
  Reference for RID-specific native libraries under `runtimes/<rid>/native/`.

## .NET

- [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy)
  Reference for supported .NET versions and end-of-support dates.
- [Attributes and reflection](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/reflection-and-attributes/)
  Reference for C# attribute metadata and runtime reflection.
- [Native AOT deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/)
  Reference for Native AOT limitations, platform restrictions, and AOT
  compatibility analyzers.
- [Introduction to AOT warnings](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/fixing-warnings)
  Reference for warning categories that flag code patterns that may fail under
  Native AOT.
- [.NET native interop best practices](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/best-practices)
  Reference for source-generated P/Invoke and long-lived native callback
  function pointers.
- [System.Text.Json source generation](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation)
  Reference for AOT-friendly JSON metadata generation.
- [Godot .NET assembly loading](https://github.com/godotengine/godot/blob/master/modules/mono/mono_gd/gd_mono.cpp)
  Reference for editor-time loading of project assemblies from Godot's managed
  assembly directory and in-memory images.
- [Godot .NET export packaging](https://github.com/godotengine/godot/blob/master/modules/mono/editor/GodotTools/GodotTools/Export/ExportPlugin.cs)
  Reference for publishing and placing .NET runtime and native files in Godot
  desktop exports.
- [Microsoft.Testing.Platform migration to v2](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-migration-from-v1-to-v2)
  Reference for the .NET 10 `dotnet test` opt-in through `global.json`.
- [NuGet contentFiles](https://learn.microsoft.com/en-us/nuget/reference/nuspec#including-content-files)
  Reference for source files included in PackageReference-based NuGet packages.
- [dotnet pack](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-pack)
  Reference for creating NuGet packages from .NET projects.
- [dotnet build](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-build)
  Reference for compiling .NET projects without publishing or packaging them.
- [dotnet nuget push](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-nuget-push)
  Reference for publishing NuGet packages.

## JavaScript packaging

- [Node.js TypeScript support](https://nodejs.org/api/typescript.html)
  Reference for Node's built-in TypeScript type stripping and erasable syntax
  constraints used by the repository task implementation.
- [mise task configuration](https://mise.jdx.dev/tasks/task-configuration.html)
  Reference for repository task dependencies and task graph behavior.
- [Execa](https://github.com/sindresorhus/execa)
  Reference for programmatic process execution from the repository task runner.
- [Vite build guide](https://vite.dev/guide/build)
  Reference for production HTML builds used by the platform integration web
  fixture.
- [Vite JavaScript API](https://vite.dev/guide/api-javascript.html)
  Reference for `createServer()`, `build()`, `mergeConfig()`, and dev server
  `resolvedUrls`, which underpin current and planned `kirie dev` behavior.
- [Vite CLI](https://vite.dev/guide/cli)
  Reference for Vite command-line flags when Kirie chooses to expose or proxy
  Vite-shaped arguments.
- [Vite server options](https://vite.dev/config/server-options.html)
  Reference for development server host, port, strict port behavior, and related
  options owned by Kirie CLI defaults.
- [Godot Window](https://docs.godotengine.org/en/4.7/classes/class_window.html)
  Reference for screen position, native move and resize gestures,
  always-on-top, and Godot's platform window behavior.
- [Godot SceneTree](https://docs.godotengine.org/en/4.7/classes/class_scenetree.html#class-scenetree-signal-process-frame)
  Reference for the frame signal that samples host-window state changes.
- [Godot DisplayServer](https://docs.godotengine.org/en/4.7/classes/class_displayserver.html)
  Reference for cursor coordinates, usable display rectangles, display-server
  limits, and native window handles.
- [Godot Windows hit testing](https://github.com/godotengine/godot/blob/master/platform/windows/display_server_windows.cpp#L5352-L5355)
  Upstream implementation showing that Godot's mouse-passthrough path returns
  `HTTRANSPARENT` on Windows.
- [Windows layered windows](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features)
  Reference for cross-application hit testing through layered transparent
  windows.
- [Microsoft CsWin32](https://github.com/microsoft/CsWin32)
  Source generator for the Windows APIs used by `GdKirie.Platform`.
- [SetWindowsHookExW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowshookexw)
  Reference for installing the Windows low-level keyboard hook.
- [LowLevelKeyboardProc](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)
  Reference for low-level keyboard delivery, message-loop ownership, callback
  timing, and timeout behavior.
- [KBDLLHOOKSTRUCT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-kbdllhookstruct)
  Reference for Windows virtual keys, scan codes, extended-key state, and
  injected-event metadata.
- [CallNextHookEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-callnexthookex)
  Reference for forwarding observed keyboard events through the hook chain.
- [UnhookWindowsHookEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-unhookwindowshookex)
  Reference for deterministic hook teardown and in-flight callback behavior.
- [Electron preload scripts](https://www.electronjs.org/docs/latest/tutorial/tutorial-preload)
  Comparison point for renderer-side runtime injection before a page is loaded.
- [Tauri WebviewWindowBuilder initialization scripts](https://docs.rs/tauri/latest/src/tauri/webview/webview_window.rs.html)
  Comparison point for scripts that run after the global object exists but
  before the HTML document is parsed and before HTML scripts run.
- [Wails frontend script injection](https://wails.io/docs/guides/frontend/)
  Comparison point for injecting IPC and runtime scripts while serving
  `index.html`.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
  Reference for publishing npm packages from GitHub Actions through OIDC instead
  of long-lived npm tokens.
- [GitHub Actions OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)
  Reference for the `id-token: write` permission required to request OIDC
  tokens from GitHub Actions.
- [bumpp](https://github.com/antfu-collective/bumpp)
  Reference for recursive monorepo version bumps, release commits, and tags.
- [pnpm publish](https://pnpm.io/cli/publish)
  Reference for pnpm workspace publishing behavior, including `publishConfig`
  manifest overrides.

## Suggested usage in this repo

- When changing Android plugin packaging, start with the Godot Android plugin
  docs and `EditorExportPlugin`.
- When changing Android IPC, start with `WebView`, AndroidX WebKit
  `WebViewCompat` and `WebMessageCompat`, RFC 8949, Jackson CBOR, and `cborg`.
- When changing iOS IPC or packaging, start with `WKWebView`,
  `WKScriptMessageHandler`, Godot's iOS plugin guide, the Godot iOS plugins
  repository, Godot Object class registration docs, and `EditorExportPlugin`.
- When changing Kirie runtime injection, start with AndroidX WebKit
  `addDocumentStartJavaScript`, `WKUserScriptInjectionTime.atDocumentStart`, CEF
  `OnContextCreated`, and the Electron, Tauri, and Wails runtime injection
  references.
- When changing the desktop Godot CEF backend, start with Godot CEF methods,
  Godot CEF IPC signals, and CEF `OnContextCreated`.
- When changing the IPC packet format or data lane, start with RFC 8949 and
  Godot CEF's IPC lane documentation.
- When changing the C# wrapper or C# tests, start with Godot C#/.NET platform
  support, C# signals, and .NET reflection or AOT documentation.
- When changing the Eventa adapter or NuGet packaging, start with .NET Native
  AOT, System.Text.Json source generation, the upstream Eventa repositories,
  NuGet contentFiles, `dotnet pack`, and `dotnet nuget push`.
- When changing the Tray plugin, start with `tray-icon`, `muda`, and NuGet
  native runtime asset guidance.
- When changing npm package publishing, start with npm trusted publishing,
  GitHub Actions OIDC, bumpp, and pnpm publish behavior.
- When changing native artifact orchestration, start with Node.js TypeScript
  support, mise task configuration, and Execa.
- When changing the platform integration web fixture, start with the Vite build
  guide and `@gd-kirie/ipc`.
- When changing Kirie CLI development-server behavior, start with the Vite
  JavaScript API and Vite server options.
