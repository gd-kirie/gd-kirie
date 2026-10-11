package ai.moeru.kirie.android

import android.net.Uri
import android.net.http.SslError
import android.util.Log
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient

class DebugTlsBypassWebViewClient(
    private val serverUrl: String?,
    private val allowTlsBypass: Boolean,
    private val assetRequestHandler: KirieAssetRequestHandler,
) : WebViewClient() {
    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse? {
        if (!KirieUrlResolver.isResolvedAssetUrl(request.url)) {
            return null
        }

        return assetRequestHandler.open(request.url)
    }

    override fun onReceivedSslError(
        view: WebView,
        handler: SslErrorHandler,
        error: SslError,
    ) {
        if (shouldBypassDevServerCertificate(error)) {
            Log.w(TAG, "Bypassing TLS certificate validation for debug dev server: ${error.url}")
            handler.proceed()
            return
        }

        handler.cancel()
    }

    private fun shouldBypassDevServerCertificate(error: SslError?): Boolean {
        if (!allowTlsBypass || error == null) {
            return false
        }

        val errorUrl = error.url ?: return false
        val errorUri = Uri.parse(errorUrl)

        if (!HTTPS_SCHEME.equals(errorUri.scheme, ignoreCase = true)) {
            return false
        }

        if (!serverUrl.isNullOrBlank()) {
            val serverUri = Uri.parse(serverUrl)
            if (!HTTPS_SCHEME.equals(serverUri.scheme, ignoreCase = true)) {
                return false
            }

            val serverHost = serverUri.host
            val errorHost = errorUri.host
            return serverHost != null &&
                errorHost != null &&
                serverHost.equals(errorHost, ignoreCase = true) &&
                normalizePort(serverUri) == normalizePort(errorUri)
        }

        return isLocalDevelopmentHost(errorUri.host)
    }

    private fun isLocalDevelopmentHost(host: String?): Boolean =
        if (host.isNullOrBlank()) {
            false
        } else {
            when {
                host.equals("localhost", ignoreCase = true) -> {
                    true
                }

                host == "127.0.0.1" || host == "10.0.2.2" || host == "10.0.3.2" || host == "::1" -> {
                    true
                }

                host.endsWith(".local") -> {
                    true
                }

                host.startsWith("10.") || host.startsWith("192.168.") -> {
                    true
                }

                host.startsWith("172.") -> {
                    val secondOctet = host.split('.').getOrNull(1)?.toIntOrNull()
                    secondOctet in 16..31
                }

                else -> {
                    false
                }
            }
        }

    private fun normalizePort(uri: Uri): Int = if (uri.port != -1) uri.port else 443

    companion object {
        private const val TAG = "Kirie"
        private const val HTTPS_SCHEME = "https"
    }
}
