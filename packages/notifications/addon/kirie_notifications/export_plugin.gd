@tool
extends EditorExportPlugin

func _get_name() -> String:
	return self.PLUGIN_NAME

func _supports_platform(platform: EditorExportPlatform) -> bool:
	var os_name = platform.get_os_name().to_lower()
	return os_name == "android" or os_name == "ios"

func _get_android_libraries(_platform: EditorExportPlatform, debug: bool) -> PackedStringArray:
	var mode = "release"
	if debug:
		mode = "debug"
	var library = "" + str(self.ANDROID_ROOT) + "/bin/" + str(mode) + "/NotificationSchedulerPlugin-" + str(mode) + ".aar"
	var source = "res://addons/" + str(library)
	if FileAccess.file_exists(source):
		return PackedStringArray([library])
	var message = "Kirie Notifications Android library not found: " + str(source)
	push_error(message)
	assert(false, message)
	return PackedStringArray()

func _get_android_dependencies(_platform: EditorExportPlatform, _debug: bool) -> PackedStringArray:
	return PackedStringArray(["androidx.appcompat:appcompat:1.7.1"])

func _get_android_manifest_application_element_contents(_platform: EditorExportPlatform, _debug: bool) -> String:
	return self.ANDROID_MANIFEST_APPLICATION_CONTENTS

func _export_begin(features: PackedStringArray, is_debug: bool, _path: String, _flags: int) -> void:
	if not features.has("ios"):
		return
	var mode = "release"
	if is_debug:
		mode = "debug"
	var framework = "" + str(self.IOS_ROOT) + "/NotificationSchedulerPlugin." + str(mode) + ".xcframework"
	if not DirAccess.dir_exists_absolute(framework):
		var message = "Kirie Notifications framework not found: " + str(framework)
		push_error(message)
		assert(false, message)
		return
	self.add_apple_embedded_platform_framework(framework)
	for system_framework in self.IOS_SYSTEM_FRAMEWORKS:
		self.add_apple_embedded_platform_framework(system_framework)
	self.add_apple_embedded_platform_linker_flags("-ObjC")
	self.add_apple_embedded_platform_cpp_code(self.IOS_CPP)

const PLUGIN_NAME = "KirieNotifications"

const ANDROID_ROOT = "kirie_notifications/vendor/godot-notification-scheduler-v6.0/addons/NotificationSchedulerPlugin"

const IOS_ROOT = "res://addons/kirie_notifications/vendor/godot-notification-scheduler-v6.0/ios/plugins"

const ANDROID_MANIFEST_APPLICATION_CONTENTS = "\n\t<activity android:name=\"org.godotengine.plugin.notification.ResultActivity\" android:theme=\"@style/Theme.AppCompat.NoActionBar\" android:excludeFromRecents=\"true\" android:launchMode=\"singleTask\" android:noHistory=\"true\" android:taskAffinity=\"\" />\n\t<receiver android:name=\"org.godotengine.plugin.notification.NotificationReceiver\" android:enabled=\"true\" android:exported=\"true\" android:process=\":godot_notification_receiver\" />\n\t<receiver android:name=\"org.godotengine.plugin.notification.CancelNotificationReceiver\" android:enabled=\"true\" android:exported=\"true\" />\n\t<receiver android:name=\"org.godotengine.plugin.notification.BootReceiver\" android:enabled=\"true\" android:exported=\"false\"><intent-filter><action android:name=\"android.intent.action.BOOT_COMPLETED\" /><action android:name=\"android.intent.action.QUICKBOOT_POWERON\" /></intent-filter></receiver>\n\t"

const IOS_SYSTEM_FRAMEWORKS = ["Foundation.framework", "AudioToolbox.framework", "UIKit.framework", "UserNotifications.framework"]

const IOS_CPP = "\nextern void notification_scheduler_plugin_init();\nextern void notification_scheduler_plugin_deinit();\nvoid kirie_notifications_generated_plugin_initialize();\nvoid kirie_notifications_generated_plugin_deinitialize();\nvoid godot_apple_embedded_plugins_initialize() {\n\tnotification_scheduler_plugin_init();\n\tkirie_notifications_generated_plugin_initialize();\n}\nvoid godot_apple_embedded_plugins_deinitialize() {\n\tkirie_notifications_generated_plugin_deinitialize();\n\tnotification_scheduler_plugin_deinit();\n}\n#undef godot_apple_embedded_plugins_initialize\n#undef godot_apple_embedded_plugins_deinitialize\n#define godot_apple_embedded_plugins_initialize kirie_notifications_generated_plugin_initialize\n#define godot_apple_embedded_plugins_deinitialize kirie_notifications_generated_plugin_deinitialize\n"
