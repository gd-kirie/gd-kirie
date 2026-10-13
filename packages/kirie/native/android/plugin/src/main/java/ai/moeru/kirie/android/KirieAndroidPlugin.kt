package ai.moeru.kirie.android

import android.app.Activity
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.JsonNodeFactory
import com.fasterxml.jackson.dataformat.cbor.CBORFactory
import org.godotengine.godot.Dictionary
import org.godotengine.godot.Godot
import org.godotengine.godot.plugin.GodotPlugin
import org.godotengine.godot.plugin.SignalInfo
import org.godotengine.godot.plugin.UsedByGodot

class KirieAndroidPlugin(
    godot: Godot,
) : GodotPlugin(godot) {
    private val webViewManager by lazy {
        KirieWebViewManager(
            activityProvider = { activity },
            onWebViewReady = { viewId -> emitOnGodotThread(SIGNAL_WEBVIEW_READY, viewId) },
            onTextPacket = { viewId, bytes ->
                emitOnGodotThread(
                    SIGNAL_TEXT_RECEIVED,
                    viewId,
                    cborMapper.readValue(bytes, String::class.java),
                )
            },
            onBinaryPacket = { viewId, bytes ->
                emitOnGodotThread(
                    SIGNAL_BINARY_RECEIVED,
                    viewId,
                    cborMapper.readValue(bytes, ByteArray::class.java),
                )
            },
            onDataPacket = { viewId, bytes ->
                emitOnGodotThread(
                    SIGNAL_DATA_RECEIVED,
                    viewId,
                    cborMapper.readTree(bytes).toGodotVariant(),
                )
            },
            onIpcError = { viewId, message ->
                Log.e(pluginName, "ipc_error view_id=$viewId message=$message")
                emitOnGodotThread(SIGNAL_IPC_ERROR, viewId, message)
            },
        )
    }

    private var webViewHost: FrameLayout? = null

    override fun getPluginName(): String = BuildConfig.GODOT_PLUGIN_NAME

    override fun getPluginSignals(): Set<SignalInfo> =
        setOf(
            SIGNAL_WEBVIEW_READY,
            SIGNAL_TEXT_RECEIVED,
            SIGNAL_BINARY_RECEIVED,
            SIGNAL_DATA_RECEIVED,
            SIGNAL_IPC_ERROR,
        )

    override fun onMainCreate(activity: Activity?): View? {
        if (activity == null) {
            return null
        }

        return FrameLayout(activity).also { hostView ->
            hostView.layoutParams =
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
            webViewHost = hostView
            webViewManager.attachHostView(hostView)
        }
    }

    override fun onMainDestroy() {
        webViewManager.destroyAllWebViews()
        webViewHost?.let(webViewManager::detachHostView)
        webViewHost = null
    }

    @UsedByGodot
    fun createWebView(
        viewId: Long,
        initialUrl: String,
    ) {
        webViewManager.createWebView(viewId, initialUrl.ifBlank { null })
    }

    @UsedByGodot
    fun destroyWebView(viewId: Long) {
        webViewManager.destroyWebView(viewId)
    }

    @UsedByGodot
    fun loadUrl(
        viewId: Long,
        url: String,
    ) {
        webViewManager.loadUrl(viewId, url)
    }

    @UsedByGodot
    fun loadHtmlString(
        viewId: Long,
        html: String,
        baseUrl: String,
    ) {
        webViewManager.loadHtmlString(viewId, html, baseUrl.ifBlank { null })
    }

    @UsedByGodot
    fun sendText(
        viewId: Long,
        message: String,
    ) {
        webViewManager.sendTextPacket(viewId, cborMapper.writeValueAsBytes(message))
    }

    @UsedByGodot
    fun sendBinary(
        viewId: Long,
        bytes: ByteArray,
    ) {
        webViewManager.sendBinaryPacket(viewId, cborMapper.writeValueAsBytes(bytes))
    }

    // Godot's Android bridge converts by registered JVM parameter type and does
    // not expose a Kotlin-side Variant parameter. Dictionary is the supported
    // container parameter for this boundary; Kirie unwraps the private value key
    // immediately so the encoded CBOR item remains the caller's original root
    // value.
    @UsedByGodot
    fun sendData(
        viewId: Long,
        value: Dictionary,
    ) {
        webViewManager.sendDataPacket(viewId, cborMapper.writeValueAsBytes(value[DATA_VALUE_KEY].toJsonNode()))
    }

    @UsedByGodot
    fun getLaunchOption(key: String): String = activity?.intent?.getStringExtra(key).orEmpty()

    private fun emitOnGodotThread(
        signal: SignalInfo,
        vararg arguments: Any?,
    ) {
        runOnRenderThread { emitSignal(signal, *arguments) }
    }

    companion object {
        private val cborMapper = ObjectMapper(CBORFactory())

        private val SIGNAL_WEBVIEW_READY = SignalInfo("webview_ready", Long::class.javaObjectType)
        private val SIGNAL_TEXT_RECEIVED =
            SignalInfo("text_received", Long::class.javaObjectType, String::class.java)
        private val SIGNAL_BINARY_RECEIVED =
            SignalInfo("binary_received", Long::class.javaObjectType, ByteArray::class.java)
        private val SIGNAL_DATA_RECEIVED =
            SignalInfo("data_received", Long::class.javaObjectType, Any::class.java)
        private val SIGNAL_IPC_ERROR =
            SignalInfo("ipc_error", Long::class.javaObjectType, String::class.java)
        private const val DATA_VALUE_KEY = "value"
    }
}

private fun Any?.toJsonNode(): JsonNode {
    val nodeFactory = JsonNodeFactory.instance
    return when (this) {
        null -> nodeFactory.nullNode()
        is Boolean -> nodeFactory.booleanNode(this)
        is String -> nodeFactory.textNode(this)
        is Byte -> nodeFactory.numberNode(this.toInt())
        is Short -> nodeFactory.numberNode(this.toInt())
        is Int -> nodeFactory.numberNode(this)
        is Long -> nodeFactory.numberNode(this)
        is Float -> nodeFactory.numberNode(this.toDouble())
        is Double -> nodeFactory.numberNode(this)
        is Dictionary -> toJsonObject()
        is Map<*, *> -> toJsonObject()
        is Array<*> -> toJsonArray()
        is Iterable<*> -> toJsonArray()
        else -> throw IllegalArgumentException("Unsupported Kirie data type: ${this::class.java.name}")
    }
}

private fun Dictionary.toJsonObject(): JsonNode {
    val node = JsonNodeFactory.instance.objectNode()
    for (key in keys) {
        require(key is String) { "Kirie data maps only support string keys" }
        node.set<JsonNode>(key, this[key].toJsonNode())
    }
    return node
}

private fun Map<*, *>.toJsonObject(): JsonNode {
    val node = JsonNodeFactory.instance.objectNode()
    for ((key, value) in this) {
        require(key is String) { "Kirie data maps only support string keys" }
        node.set<JsonNode>(key, value.toJsonNode())
    }
    return node
}

private fun Array<*>.toJsonArray(): JsonNode {
    val node = JsonNodeFactory.instance.arrayNode()
    for (item in this) {
        node.add(item.toJsonNode())
    }
    return node
}

private fun Iterable<*>.toJsonArray(): JsonNode {
    val node = JsonNodeFactory.instance.arrayNode()
    for (item in this) {
        node.add(item.toJsonNode())
    }
    return node
}

private fun JsonNode.toGodotVariant(): Any? =
    when {
        isNull -> {
            null
        }

        isBoolean -> {
            booleanValue()
        }

        isTextual -> {
            textValue()
        }

        isIntegralNumber -> {
            longValue().toGodotInteger()
        }

        isFloatingPointNumber -> {
            doubleValue()
        }

        isArray -> {
            val items = ArrayList<Any?>()
            for (item in this) {
                items.add(item.toGodotVariant())
            }
            items.toTypedArray()
        }

        isObject -> {
            val dictionary = Dictionary()
            for (property in properties()) {
                dictionary[property.key] = property.value.toGodotVariant()
            }
            dictionary
        }

        else -> {
            throw IllegalArgumentException("Unsupported Kirie data node: ${nodeType.name}")
        }
    }

private fun Long.toGodotInteger(): Any =
    if (this in Int.MIN_VALUE..Int.MAX_VALUE) {
        toInt()
    } else {
        this
    }
