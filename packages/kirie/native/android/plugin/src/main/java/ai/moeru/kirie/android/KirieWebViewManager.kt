package ai.moeru.kirie.android

import android.app.Activity
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class KirieWebViewManager(
    private val activityProvider: () -> Activity?,
    private val onWebViewReady: (viewId: Long) -> Unit,
    private val onTextPacket: (viewId: Long, bytes: ByteArray) -> Unit,
    private val onBinaryPacket: (viewId: Long, bytes: ByteArray) -> Unit,
    private val onDataPacket: (viewId: Long, bytes: ByteArray) -> Unit,
    private val onIpcError: (viewId: Long, message: String) -> Unit,
) {
    private val webViews = LinkedHashMap<Long, WebViewSession>()
    private val visibility = LinkedHashMap<Long, Boolean>()
    private var hostView: ViewGroup? = null
    private var usesExplicitHost = false

    fun attachHostView(hostView: ViewGroup) {
        val activity = activityProvider() ?: return
        activity.runOnUiThread {
            usesExplicitHost = true
            this.hostView = hostView
            for (session in webViews.values) {
                session.webView.removeFromSuperview()
                hostView.addView(session.webView)
            }
        }
    }

    fun detachHostView(hostView: ViewGroup) {
        val activity = activityProvider() ?: return
        activity.runOnUiThread {
            if (this.hostView !== hostView) {
                return@runOnUiThread
            }

            this.hostView = null
            for (session in webViews.values) {
                session.webView.removeFromSuperview()
            }
        }
    }

    fun createWebView(
        viewId: Long,
        initialUrl: String?,
    ) {
        val activity = activityProvider()
        if (activity == null) {
            onIpcError(viewId, "Cannot create WebView because the host activity is not available")
            return
        }

        runOnUiThread {
            val existingSession = webViews[viewId]
            if (existingSession != null) {
                if (!initialUrl.isNullOrBlank()) {
                    loadResolvedUrl(viewId, existingSession.webView, initialUrl)
                }
                return@runOnUiThread
            }

            val rootView =
                hostView
                    ?: if (usesExplicitHost) {
                        null
                    } else {
                        activity.findViewById<FrameLayout>(android.R.id.content)
                    }
            val createdWebView = WebView(activity)

            createdWebView.layoutParams =
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
            createdWebView.setBackgroundColor(Color.TRANSPARENT)
            createdWebView.settings.javaScriptEnabled = true
            createdWebView.settings.domStorageEnabled = true

            val runtimeConfig = KirieRuntimeConfig.from(activity)
            if (runtimeConfig.enableWebInspector) {
                WebView.setWebContentsDebuggingEnabled(true)
            }

            if (!installMessageChannels(viewId, createdWebView)) {
                return@runOnUiThread
            }
            if (!installRuntimeScript(viewId, createdWebView)) {
                return@runOnUiThread
            }

            createdWebView.webViewClient =
                DebugTlsBypassWebViewClient(
                    serverUrl = initialUrl,
                    allowTlsBypass = runtimeConfig.allowTlsBypass,
                    assetRequestHandler = KirieAssetRequestHandler(activity.assets),
                )

            createdWebView.visibility = if (visibility[viewId] != false) View.VISIBLE else View.GONE
            rootView?.addView(createdWebView)
            webViews[viewId] = WebViewSession(webView = createdWebView)
            onWebViewReady(viewId)

            if (!initialUrl.isNullOrBlank()) {
                loadResolvedUrl(viewId, createdWebView, initialUrl)
            }
        }
    }

    fun setWebViewVisible(
        viewId: Long,
        visible: Boolean,
    ) {
        runOnUiThread {
            visibility[viewId] = visible
            val webView = webViews[viewId]?.webView ?: return@runOnUiThread
            if (!visible) {
                webView.clearFocus()
            }
            webView.visibility = if (visible) View.VISIBLE else View.GONE
        }
    }

    fun destroyWebView(viewId: Long) {
        val activity = activityProvider()
        if (activity == null) {
            onIpcError(viewId, "Cannot destroy WebView because the host activity is not available")
            return
        }

        runOnUiThread {
            visibility.remove(viewId)
            val existingWebView = webViews.remove(viewId)?.webView ?: return@runOnUiThread
            existingWebView.stopLoading()
            existingWebView.removeFromSuperview()
            existingWebView.destroy()
        }
    }

    fun destroyAllWebViews() {
        val activity = activityProvider() ?: return
        activity.runOnUiThread {
            for (session in webViews.values) {
                session.webView.stopLoading()
                session.webView.removeFromSuperview()
                session.webView.destroy()
            }
            webViews.clear()
            visibility.clear()
        }
    }

    fun loadUrl(
        viewId: Long,
        url: String,
    ) {
        val activity = activityProvider()
        if (activity == null) {
            onIpcError(viewId, "Cannot load URL because the host activity is not available")
            return
        }

        runOnUiThread {
            val existingWebView = webViews[viewId]?.webView
            if (existingWebView == null) {
                onIpcError(viewId, "Cannot load URL because the WebView does not exist")
                return@runOnUiThread
            }

            loadResolvedUrl(viewId, existingWebView, url)
        }
    }

    fun loadHtmlString(
        viewId: Long,
        html: String,
        baseUrl: String?,
    ) {
        val activity = activityProvider()
        if (activity == null) {
            onIpcError(viewId, "Cannot load HTML string because the host activity is not available")
            return
        }

        runOnUiThread {
            val existingWebView = webViews[viewId]?.webView
            if (existingWebView == null) {
                onIpcError(viewId, "Cannot load HTML string because the WebView does not exist")
                return@runOnUiThread
            }

            existingWebView.loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", null)
        }
    }

    fun sendTextPacket(
        viewId: Long,
        bytes: ByteArray,
    ) = sendBytes(viewId, bytes, webViews[viewId]?.textReplyProxy, "text")

    fun sendBinaryPacket(
        viewId: Long,
        bytes: ByteArray,
    ) = sendBytes(viewId, bytes, webViews[viewId]?.binaryReplyProxy, "binary")

    fun sendDataPacket(
        viewId: Long,
        bytes: ByteArray,
    ) = sendBytes(viewId, bytes, webViews[viewId]?.dataReplyProxy, "data")

    private fun sendBytes(
        viewId: Long,
        bytes: ByteArray,
        replyProxy: JavaScriptReplyProxy?,
        channelName: String,
    ) {
        val activity = activityProvider()
        if (activity == null) {
            onIpcError(viewId, "Cannot send $channelName because the host activity is not available")
            return
        }

        runOnUiThread {
            if (replyProxy == null) {
                onIpcError(viewId, "Cannot send $channelName because the WebView $channelName channel is not ready")
                return@runOnUiThread
            }

            replyProxy.postMessage(bytes)
        }
    }

    private fun runOnUiThread(block: () -> Unit) {
        val activity = activityProvider() ?: return
        activity.runOnUiThread(block)
    }

    private fun loadResolvedUrl(
        viewId: Long,
        webView: WebView,
        url: String,
    ) {
        val resolvedUrl =
            try {
                KirieUrlResolver.resolveForWebView(url)
            } catch (error: IllegalArgumentException) {
                onIpcError(viewId, error.message ?: "Cannot load URL: $url")
                return
            }

        webView.loadUrl(resolvedUrl)
    }

    private fun installMessageChannels(
        viewId: Long,
        webView: WebView,
    ): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            onIpcError(viewId, "Android WebView does not support WebMessageListener")
            return false
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)) {
            onIpcError(viewId, "Android WebView does not support ArrayBuffer messages")
            return false
        }

        val origins = setOf("*")
        installBytesChannel(
            viewId,
            webView,
            TEXT_CHANNEL,
            origins,
            { webViews[viewId]?.textReplyProxy = it },
            { onTextPacket(viewId, it) },
        )
        installBytesChannel(
            viewId,
            webView,
            BINARY_CHANNEL,
            origins,
            { webViews[viewId]?.binaryReplyProxy = it },
            { onBinaryPacket(viewId, it) },
        )
        installBytesChannel(
            viewId,
            webView,
            DATA_CHANNEL,
            origins,
            { webViews[viewId]?.dataReplyProxy = it },
            { onDataPacket(viewId, it) },
        )
        return true
    }

    private fun installRuntimeScript(
        viewId: Long,
        webView: WebView,
    ): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            onIpcError(viewId, "Android WebView does not support document-start scripts")
            return false
        }

        WebViewCompat.addDocumentStartJavaScript(webView, KIRIE_RUNTIME_SCRIPT, setOf("*"))
        return true
    }

    private fun installBytesChannel(
        viewId: Long,
        webView: WebView,
        name: String,
        origins: Set<String>,
        setReplyProxy: (JavaScriptReplyProxy) -> Unit,
        onMessage: (ByteArray) -> Unit,
    ) = WebViewCompat.addWebMessageListener(webView, name, origins) { _, message, _, isMainFrame, replyProxy ->
        if (!isMainFrame) {
            return@addWebMessageListener
        }
        setReplyProxy(replyProxy)
        if (message.type != WebMessageCompat.TYPE_ARRAY_BUFFER) {
            onIpcError(viewId, "Received non-binary message on $name")
            return@addWebMessageListener
        }
        val packet = message.arrayBuffer
        if (packet.isEmpty()) {
            return@addWebMessageListener
        }
        onMessage(packet)
    }

    private fun WebView.removeFromSuperview() {
        val parentViewGroup = parent as? ViewGroup ?: return
        parentViewGroup.removeView(this)
    }

    companion object {
        private const val TEXT_CHANNEL = "KirieTextChannel"
        private const val BINARY_CHANNEL = "KirieBinaryChannel"
        private const val DATA_CHANNEL = "KirieDataChannel"
        private val KIRIE_RUNTIME_SCRIPT =
            """
            (() => {
              globalThis.kirie ??= {};
              globalThis.kirie.platform = {
                os: "android",
                backend: "webview",
              };
            })();
            """.trimIndent()
    }
}

private data class WebViewSession(
    val webView: WebView,
    var textReplyProxy: JavaScriptReplyProxy? = null,
    var binaryReplyProxy: JavaScriptReplyProxy? = null,
    var dataReplyProxy: JavaScriptReplyProxy? = null,
)
