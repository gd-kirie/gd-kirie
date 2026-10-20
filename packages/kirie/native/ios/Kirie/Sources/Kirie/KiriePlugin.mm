#include "KiriePlugin.h"

#include "core/object/class_db.h"
#include "servers/display/display_server.h"

#include <cstdint>
#include <cstring>

#import <Foundation/Foundation.h>

extern "C" void kirie_swift_create_webview(int64_t view_id, const char *initial_url, void *default_host_view);
extern "C" void kirie_swift_destroy_webview(int64_t view_id);
extern "C" void kirie_swift_set_webview_visible(int64_t view_id, bool visible);
extern "C" void kirie_swift_load_url(int64_t view_id, const char *url);
extern "C" void kirie_swift_load_html_string(int64_t view_id, const char *html, const char *base_url);
extern "C" void kirie_swift_send_text(int64_t view_id, const char *message);
extern "C" void kirie_swift_send_binary(int64_t view_id, const uint8_t *bytes, intptr_t byte_count);
extern "C" void kirie_swift_send_data_json(int64_t view_id, const char *json);

static NSString *const KirieWebViewReadyNotification = @"KirieWebViewReady";
static NSString *const KirieTextReceivedNotification = @"KirieTextReceived";
static NSString *const KirieBinaryReceivedNotification = @"KirieBinaryReceived";
static NSString *const KirieDataReceivedNotification = @"KirieDataReceived";
static NSString *const KirieIpcErrorNotification = @"KirieIpcError";
static const char *DATA_VALUE_KEY = "value";

static KiriePlugin *singleton = nullptr;

static int64_t notification_view_id(NSNotification *notification) {
	id value = notification.userInfo[@"view_id"];
	if (![value isKindOfClass:[NSNumber class]]) {
		return 0;
	}

	return [(NSNumber *)value longLongValue];
}

static String to_godot_string(id value) {
	if (![value isKindOfClass:[NSString class]]) {
		return String();
	}

	return String::utf8([(NSString *)value UTF8String]);
}

static PackedByteArray to_godot_bytes(id value) {
	PackedByteArray bytes;
	if (![value isKindOfClass:[NSData class]]) {
		return bytes;
	}

	NSData *data = (NSData *)value;
	bytes.resize(data.length);
	if (data.length > 0) {
		std::memcpy(bytes.ptrw(), data.bytes, data.length);
	}

	return bytes;
}

static Variant to_godot_variant(id value) {
	if (!value || value == [NSNull null]) {
		return Variant();
	}

	if ([value isKindOfClass:[NSString class]]) {
		return to_godot_string(value);
	}

	if ([value isKindOfClass:[NSNumber class]]) {
		NSNumber *number = (NSNumber *)value;
		if (CFGetTypeID((__bridge CFTypeRef)number) == CFBooleanGetTypeID()) {
			return Variant([number boolValue]);
		}

		CFNumberType number_type = CFNumberGetType((CFNumberRef)number);
		switch (number_type) {
			case kCFNumberFloat32Type:
			case kCFNumberFloat64Type:
			case kCFNumberFloatType:
			case kCFNumberDoubleType:
			case kCFNumberCGFloatType:
				return Variant([number doubleValue]);
			default:
				return Variant((int64_t)[number longLongValue]);
		}
	}

	if ([value isKindOfClass:[NSArray class]]) {
		Array array;
		for (id item in (NSArray *)value) {
			array.append(to_godot_variant(item));
		}
		return array;
	}

	if ([value isKindOfClass:[NSDictionary class]]) {
		Dictionary dictionary;
		for (id key in (NSDictionary *)value) {
			if (![key isKindOfClass:[NSString class]]) {
				continue;
			}

			dictionary[to_godot_string(key)] = to_godot_variant([(NSDictionary *)value objectForKey:key]);
		}
		return dictionary;
	}

	return Variant();
}

static id to_foundation_object(const Variant &value, String *error) {
	switch (value.get_type()) {
		case Variant::NIL:
			return [NSNull null];
		case Variant::BOOL:
			return [NSNumber numberWithBool:bool(value)];
		case Variant::INT:
			return [NSNumber numberWithLongLong:(long long)(int64_t)value];
		case Variant::FLOAT:
			return [NSNumber numberWithDouble:(double)value];
		case Variant::STRING: {
			CharString string_value = String(value).utf8();
			return [NSString stringWithUTF8String:string_value.get_data()];
		}
		case Variant::ARRAY: {
			Array source = value;
			NSMutableArray *array = [NSMutableArray arrayWithCapacity:source.size()];
			for (int64_t index = 0; index < source.size(); index++) {
				id item = to_foundation_object(source[index], error);
				if (error && !error->is_empty()) {
					return nil;
				}
				[array addObject:item ?: [NSNull null]];
			}
			return array;
		}
		case Variant::DICTIONARY: {
			Dictionary source = value;
			NSMutableDictionary *dictionary = [NSMutableDictionary dictionaryWithCapacity:source.size()];
			Array keys = source.keys();
			for (int64_t index = 0; index < keys.size(); index++) {
				Variant key = keys[index];
				if (key.get_type() != Variant::STRING) {
					if (error) {
						*error = String("Kirie data maps only support string keys");
					}
					return nil;
				}

				CharString key_string = String(key).utf8();
				id item = to_foundation_object(source[key], error);
				if (error && !error->is_empty()) {
					return nil;
				}
				[dictionary setObject:item ?: [NSNull null]
					forKey:[NSString stringWithUTF8String:key_string.get_data()]];
			}
			return dictionary;
		}
		default:
			if (error) {
				*error = String("Unsupported Kirie data type: ") + Variant::get_type_name(value.get_type());
			}
			return nil;
	}
}

static String to_json_string(const Variant &value, String *error) {
	id object = to_foundation_object(value, error);
	if (error && !error->is_empty()) {
		return String();
	}

	NSError *json_error = nil;
	NSData *data = [NSJSONSerialization dataWithJSONObject:object
		options:NSJSONWritingFragmentsAllowed
		error:&json_error];
	if (json_error) {
		if (error) {
			*error = to_godot_string(json_error.localizedDescription);
		}
		return String();
	}

	NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
	return to_godot_string(json);
}

static Variant unwrap_carried_data(Variant value) {
	if (value.get_type() != Variant::DICTIONARY) {
		return value;
	}

	Dictionary dictionary = value;
	String key = String(DATA_VALUE_KEY);
	if (!dictionary.has(key)) {
		return value;
	}

	return dictionary[key];
}

void KiriePlugin::createWebView(int64_t view_id, String initial_url) {
	CharString encoded_initial_url = initial_url.utf8();
	void *default_host_view = reinterpret_cast<void *>(
			DisplayServer::get_singleton()->window_get_native_handle(DisplayServerEnums::WINDOW_VIEW));
	kirie_swift_create_webview(view_id, encoded_initial_url.get_data(), default_host_view);
}

void KiriePlugin::setWebViewVisible(int64_t view_id, bool visible) {
	kirie_swift_set_webview_visible(view_id, visible);
}

void KiriePlugin::destroyWebView(int64_t view_id) {
	kirie_swift_destroy_webview(view_id);
}

void KiriePlugin::loadUrl(int64_t view_id, String url) {
	CharString encoded_url = url.utf8();
	kirie_swift_load_url(view_id, encoded_url.get_data());
}

void KiriePlugin::loadHtmlString(int64_t view_id, String html, String base_url) {
	CharString encoded_html = html.utf8();
	CharString encoded_base_url = base_url.utf8();
	kirie_swift_load_html_string(view_id, encoded_html.get_data(), encoded_base_url.get_data());
}

void KiriePlugin::sendText(int64_t view_id, String message) {
	CharString encoded_message = message.utf8();
	kirie_swift_send_text(view_id, encoded_message.get_data());
}

void KiriePlugin::sendBinary(int64_t view_id, PackedByteArray bytes) {
	kirie_swift_send_binary(view_id, bytes.ptr(), bytes.size());
}

void KiriePlugin::sendData(int64_t view_id, Variant value) {
	String error;
	String json = to_json_string(unwrap_carried_data(value), &error);
	if (!error.is_empty()) {
		emit_signal(StringName("ipc_error"), view_id, error);
		return;
	}

	CharString encoded_json = json.utf8();
	kirie_swift_send_data_json(view_id, encoded_json.get_data());
}

String KiriePlugin::getLaunchOption(String key) {
	CharString encoded_key = key.utf8();
	NSString *underscore_key = [NSString stringWithUTF8String:encoded_key.get_data()];
	NSString *dash_key = [underscore_key stringByReplacingOccurrencesOfString:@"_" withString:@"-"];
	NSArray<NSString *> *arguments = [[NSProcessInfo processInfo] arguments];

	for (NSUInteger index = 0; index < arguments.count; index++) {
		NSString *argument = arguments[index];
		NSArray<NSString *> *option_names = @[ underscore_key, dash_key ];

		for (NSString *option_name in option_names) {
			NSString *prefix = [NSString stringWithFormat:@"--%@=", option_name];
			if ([argument hasPrefix:prefix]) {
				return to_godot_string([argument substringFromIndex:prefix.length]);
			}

			if ([argument isEqualToString:[NSString stringWithFormat:@"--%@", option_name]]
				&& index + 1 < arguments.count) {
				return to_godot_string(arguments[index + 1]);
			}
		}
	}

	return String();
}

KiriePlugin *KiriePlugin::get_singleton() {
	return singleton;
}

void KiriePlugin::_bind_methods() {
	ClassDB::bind_method(D_METHOD("createWebView", "view_id", "initial_url"), &KiriePlugin::createWebView);
	ClassDB::bind_method(D_METHOD("setWebViewVisible", "view_id", "visible"), &KiriePlugin::setWebViewVisible);
	ClassDB::bind_method(D_METHOD("destroyWebView", "view_id"), &KiriePlugin::destroyWebView);
	ClassDB::bind_method(D_METHOD("loadUrl", "view_id", "url"), &KiriePlugin::loadUrl);
	ClassDB::bind_method(D_METHOD("loadHtmlString", "view_id", "html", "base_url"), &KiriePlugin::loadHtmlString);
	ClassDB::bind_method(D_METHOD("sendText", "view_id", "message"), &KiriePlugin::sendText);
	ClassDB::bind_method(D_METHOD("sendBinary", "view_id", "bytes"), &KiriePlugin::sendBinary);
	ClassDB::bind_method(D_METHOD("sendData", "view_id", "value"), &KiriePlugin::sendData);
	ClassDB::bind_method(D_METHOD("getLaunchOption", "key"), &KiriePlugin::getLaunchOption);

	ADD_SIGNAL(MethodInfo("webview_ready", PropertyInfo(Variant::INT, "view_id")));
	ADD_SIGNAL(MethodInfo("text_received", PropertyInfo(Variant::INT, "view_id"), PropertyInfo(Variant::STRING, "message")));
	ADD_SIGNAL(MethodInfo("binary_received", PropertyInfo(Variant::INT, "view_id"), PropertyInfo(Variant::PACKED_BYTE_ARRAY, "bytes")));
	ADD_SIGNAL(MethodInfo("data_received", PropertyInfo(Variant::INT, "view_id"), PropertyInfo(Variant::NIL, "value", PROPERTY_HINT_NONE, "", PROPERTY_USAGE_NIL_IS_VARIANT)));
	ADD_SIGNAL(MethodInfo("ipc_error", PropertyInfo(Variant::INT, "view_id"), PropertyInfo(Variant::STRING, "error")));
}

KiriePlugin::KiriePlugin() {
	singleton = this;

	NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
	NSOperationQueue *main_queue = [NSOperationQueue mainQueue];

	webview_ready_observer = (__bridge_retained void *)[center addObserverForName:KirieWebViewReadyNotification
		object:nil
		queue:main_queue
		usingBlock:^(NSNotification *notification) {
			if (singleton) {
				singleton->emit_signal(StringName("webview_ready"), notification_view_id(notification));
			}
		}];

	text_received_observer = (__bridge_retained void *)[center addObserverForName:KirieTextReceivedNotification
		object:nil
		queue:main_queue
		usingBlock:^(NSNotification *notification) {
			if (singleton) {
				singleton->emit_signal(StringName("text_received"), notification_view_id(notification), to_godot_string(notification.object));
			}
		}];

	binary_received_observer = (__bridge_retained void *)[center addObserverForName:KirieBinaryReceivedNotification
		object:nil
		queue:main_queue
		usingBlock:^(NSNotification *notification) {
			if (singleton) {
				singleton->emit_signal(StringName("binary_received"), notification_view_id(notification), to_godot_bytes(notification.object));
			}
		}];

	data_received_observer = (__bridge_retained void *)[center addObserverForName:KirieDataReceivedNotification
		object:nil
		queue:main_queue
		usingBlock:^(NSNotification *notification) {
			if (singleton) {
				singleton->emit_signal(StringName("data_received"), notification_view_id(notification), to_godot_variant(notification.object));
			}
		}];

	ipc_error_observer = (__bridge_retained void *)[center addObserverForName:KirieIpcErrorNotification
		object:nil
		queue:main_queue
		usingBlock:^(NSNotification *notification) {
			if (singleton) {
				singleton->emit_signal(StringName("ipc_error"), notification_view_id(notification), to_godot_string(notification.object));
			}
		}];
}

KiriePlugin::~KiriePlugin() {
	NSNotificationCenter *center = [NSNotificationCenter defaultCenter];

	if (webview_ready_observer) {
		id observer = (__bridge_transfer id)webview_ready_observer;
		[center removeObserver:observer];
		webview_ready_observer = nullptr;
	}

	if (text_received_observer) {
		id observer = (__bridge_transfer id)text_received_observer;
		[center removeObserver:observer];
		text_received_observer = nullptr;
	}

	if (binary_received_observer) {
		id observer = (__bridge_transfer id)binary_received_observer;
		[center removeObserver:observer];
		binary_received_observer = nullptr;
	}

	if (data_received_observer) {
		id observer = (__bridge_transfer id)data_received_observer;
		[center removeObserver:observer];
		data_received_observer = nullptr;
	}

	if (ipc_error_observer) {
		id observer = (__bridge_transfer id)ipc_error_observer;
		[center removeObserver:observer];
		ipc_error_observer = nullptr;
	}

	singleton = nullptr;
}
