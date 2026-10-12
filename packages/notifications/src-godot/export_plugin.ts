@tool
export class _ExportPlugin extends EditorExportPlugin {
  _get_name(): string {
    return _ExportPlugin.PLUGIN_NAME;
  }

  _supports_platform(platform: EditorExportPlatform): boolean {
    const os_name = platform.get_os_name().to_lower();
    return os_name === "android" || os_name === "ios";
  }

  _get_android_libraries(
    _platform: EditorExportPlatform | null,
    debug: boolean,
  ): PackedStringArray {
    let mode = "release";
    if (debug) {
      mode = "debug";
    }

    const library = `${_ExportPlugin.ANDROID_ROOT}/bin/${mode}/NotificationSchedulerPlugin-${mode}.aar`;
    const source = `res://addons/${library}`;
    if (FileAccess.file_exists(source)) {
      return PackedStringArray([library]);
    }

    const message = `Kirie Notifications Android library not found: ${source}`;
    push_error(message);
    assert(false, message);
    return PackedStringArray();
  }

  _get_android_dependencies(
    _platform: EditorExportPlatform | null,
    _debug: boolean,
  ): PackedStringArray {
    return PackedStringArray(["androidx.appcompat:appcompat:1.7.1"]);
  }

  _get_android_manifest_application_element_contents(
    _platform: EditorExportPlatform | null,
    _debug: boolean,
  ): string {
    return _ExportPlugin.ANDROID_MANIFEST_APPLICATION_CONTENTS;
  }

  _export_begin(features: PackedStringArray, is_debug: boolean, _path: string, _flags: int): void {
    if (!features.has("ios")) {
      return;
    }

    let mode = "release";
    if (is_debug) {
      mode = "debug";
    }

    const framework = `${_ExportPlugin.IOS_ROOT}/NotificationSchedulerPlugin.${mode}.xcframework`;
    if (!DirAccess.dir_exists_absolute(framework)) {
      const message = `Kirie Notifications framework not found: ${framework}`;
      push_error(message);
      assert(false, message);
      return;
    }

    this.add_apple_embedded_platform_framework(framework);
    for (const system_framework of _ExportPlugin.IOS_SYSTEM_FRAMEWORKS) {
      this.add_apple_embedded_platform_framework(system_framework);
    }

    this.add_apple_embedded_platform_linker_flags("-ObjC");
    this.add_apple_embedded_platform_cpp_code(_ExportPlugin.IOS_CPP);
  }
}

export namespace _ExportPlugin {
  export const PLUGIN_NAME = "KirieNotifications";
  export const ANDROID_ROOT =
    "kirie_notifications/vendor/godot-notification-scheduler-v6.0/addons/NotificationSchedulerPlugin";
  export const IOS_ROOT =
    "res://addons/kirie_notifications/vendor/godot-notification-scheduler-v6.0/ios/plugins";
  export const ANDROID_MANIFEST_APPLICATION_CONTENTS =
    "\n\t<activity android:name=\"org.godotengine.plugin.notification.ResultActivity\" android:theme=\"@style/Theme.AppCompat.NoActionBar\" android:excludeFromRecents=\"true\" android:launchMode=\"singleTask\" android:noHistory=\"true\" android:taskAffinity=\"\" />\n\t<receiver android:name=\"org.godotengine.plugin.notification.NotificationReceiver\" android:enabled=\"true\" android:exported=\"true\" android:process=\":godot_notification_receiver\" />\n\t<receiver android:name=\"org.godotengine.plugin.notification.CancelNotificationReceiver\" android:enabled=\"true\" android:exported=\"true\" />\n\t<receiver android:name=\"org.godotengine.plugin.notification.BootReceiver\" android:enabled=\"true\" android:exported=\"false\"><intent-filter><action android:name=\"android.intent.action.BOOT_COMPLETED\" /><action android:name=\"android.intent.action.QUICKBOOT_POWERON\" /></intent-filter></receiver>\n\t";
  export const IOS_SYSTEM_FRAMEWORKS = [
    "Foundation.framework",
    "AudioToolbox.framework",
    "UIKit.framework",
    "UserNotifications.framework",
  ];
  export const IOS_CPP =
    "\nextern void notification_scheduler_plugin_init();\nextern void notification_scheduler_plugin_deinit();\nvoid kirie_notifications_generated_plugin_initialize();\nvoid kirie_notifications_generated_plugin_deinitialize();\nvoid godot_apple_embedded_plugins_initialize() {\n\tnotification_scheduler_plugin_init();\n\tkirie_notifications_generated_plugin_initialize();\n}\nvoid godot_apple_embedded_plugins_deinitialize() {\n\tkirie_notifications_generated_plugin_deinitialize();\n\tnotification_scheduler_plugin_deinit();\n}\n#undef godot_apple_embedded_plugins_initialize\n#undef godot_apple_embedded_plugins_deinitialize\n#define godot_apple_embedded_plugins_initialize kirie_notifications_generated_plugin_initialize\n#define godot_apple_embedded_plugins_deinitialize kirie_notifications_generated_plugin_deinitialize\n";
}
