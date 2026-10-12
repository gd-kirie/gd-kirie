@tool
extends EditorExportPlugin

const ROOT := "res://addons/kirie_notifications/vendor/godot-notification-scheduler-v6.0"
const ANDROID_ROOT := "kirie_notifications/vendor/godot-notification-scheduler-v6.0/addons/NotificationSchedulerPlugin"
const IOS_ROOT := ROOT + "/ios/plugins"
const IOS_CPP := """
extern void notification_scheduler_plugin_init();
extern void notification_scheduler_plugin_deinit();
void kirie_notifications_generated_plugin_initialize();
void kirie_notifications_generated_plugin_deinitialize();
void godot_apple_embedded_plugins_initialize() {
	notification_scheduler_plugin_init();
	kirie_notifications_generated_plugin_initialize();
}
void godot_apple_embedded_plugins_deinitialize() {
	kirie_notifications_generated_plugin_deinitialize();
	notification_scheduler_plugin_deinit();
}
#undef godot_apple_embedded_plugins_initialize
#undef godot_apple_embedded_plugins_deinitialize
#define godot_apple_embedded_plugins_initialize kirie_notifications_generated_plugin_initialize
#define godot_apple_embedded_plugins_deinitialize kirie_notifications_generated_plugin_deinitialize
"""


func _get_name() -> String:
	return "KirieNotifications"


func _supports_platform(platform: EditorExportPlatform) -> bool:
	return platform.get_os_name().to_lower() in ["android", "ios"]


func _get_android_libraries(_platform: EditorExportPlatform, debug: bool) -> PackedStringArray:
	var mode := "debug" if debug else "release"
	var library := "%s/bin/%s/NotificationSchedulerPlugin-%s.aar" % [ANDROID_ROOT, mode, mode]
	var source := "res://addons/" + library
	if not FileAccess.file_exists(source):
		var message := "Kirie Notifications Android library not found: %s" % source
		push_error(message)
		assert(false, message)
		return PackedStringArray()
	return PackedStringArray([library])


func _get_android_dependencies(_platform: EditorExportPlatform, _debug: bool) -> PackedStringArray:
	return PackedStringArray(["androidx.appcompat:appcompat:1.7.1"])


func _get_android_manifest_application_element_contents(
	_platform: EditorExportPlatform, _debug: bool
) -> String:
	return """
	<activity android:name="org.godotengine.plugin.notification.ResultActivity" android:theme="@style/Theme.AppCompat.NoActionBar" android:excludeFromRecents="true" android:launchMode="singleTask" android:noHistory="true" android:taskAffinity="" />
	<receiver android:name="org.godotengine.plugin.notification.NotificationReceiver" android:enabled="true" android:exported="true" android:process=":godot_notification_receiver" />
	<receiver android:name="org.godotengine.plugin.notification.CancelNotificationReceiver" android:enabled="true" android:exported="true" />
	<receiver android:name="org.godotengine.plugin.notification.BootReceiver" android:enabled="true" android:exported="false"><intent-filter><action android:name="android.intent.action.BOOT_COMPLETED" /><action android:name="android.intent.action.QUICKBOOT_POWERON" /></intent-filter></receiver>
	"""


func _export_begin(features: PackedStringArray, is_debug: bool, _path: String, _flags: int) -> void:
	if not features.has("ios"):
		return
	var mode := "debug" if is_debug else "release"
	var framework := "%s/NotificationSchedulerPlugin.%s.xcframework" % [IOS_ROOT, mode]
	if not DirAccess.dir_exists_absolute(framework):
		var message := "Kirie Notifications framework not found: %s" % framework
		push_error(message)
		assert(false, message)
		return
	add_apple_embedded_platform_framework(framework)
	for system_framework in ["Foundation.framework", "AudioToolbox.framework", "UIKit.framework", "UserNotifications.framework"]:
		add_apple_embedded_platform_framework(system_framework)
	add_apple_embedded_platform_linker_flags("-ObjC")
	add_apple_embedded_platform_cpp_code(IOS_CPP)
