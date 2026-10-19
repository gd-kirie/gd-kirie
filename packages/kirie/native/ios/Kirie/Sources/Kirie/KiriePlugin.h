#ifndef KIRIE_PLUGIN_H
#define KIRIE_PLUGIN_H

#include "core/version.h"

#include "core/object/object.h"

#include <cstdint>

class KiriePlugin : public Object {
	GDCLASS(KiriePlugin, Object);

	void *webview_ready_observer = nullptr;
	void *text_received_observer = nullptr;
	void *binary_received_observer = nullptr;
	void *data_received_observer = nullptr;
	void *ipc_error_observer = nullptr;

protected:
	static void _bind_methods();

public:
	static KiriePlugin *get_singleton();

	void createWebView(int64_t view_id, String initial_url);
	void setWebViewVisible(int64_t view_id, bool visible);
	void destroyWebView(int64_t view_id);
	void loadUrl(int64_t view_id, String url);
	void loadHtmlString(int64_t view_id, String html, String base_url);
	void sendText(int64_t view_id, String message);
	void sendBinary(int64_t view_id, PackedByteArray bytes);
	void sendData(int64_t view_id, Variant value);
	String getLaunchOption(String key);

	KiriePlugin();
	~KiriePlugin();
};

#endif
