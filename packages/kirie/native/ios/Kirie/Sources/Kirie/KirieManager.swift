import Foundation
import UIKit
import WebKit

private extension Notification.Name {
    static let kirieWebViewReady = Notification.Name("KirieWebViewReady")
    static let kirieTextReceived = Notification.Name("KirieTextReceived")
    static let kirieBinaryReceived = Notification.Name("KirieBinaryReceived")
    static let kirieDataReceived = Notification.Name("KirieDataReceived")
    static let kirieIpcError = Notification.Name("KirieIpcError")
}

private struct KirieWebPacketMessage: Decodable {
    let lane: String
    let packet: String
}

private struct KirieRuntimeConfig {
    private static let enableWebInspectorKey = "KirieEnableWebInspector"
    private static let allowTlsBypassKey = "KirieAllowTlsBypass"

    let enableWebInspector: Bool
    let allowTlsBypass: Bool

    static var current: KirieRuntimeConfig {
        let bundle = Bundle.main
        return KirieRuntimeConfig(
            enableWebInspector: bundle.object(forInfoDictionaryKey: enableWebInspectorKey) as? Bool ?? false,
            allowTlsBypass: bundle.object(forInfoDictionaryKey: allowTlsBypassKey) as? Bool ?? false
        )
    }
}

private final class KirieScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var manager: KirieManager?
    private let viewID: Int64

    init(viewID: Int64, manager: KirieManager) {
        self.viewID = viewID
        self.manager = manager
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        Task { @MainActor in
            self.manager?.handleScriptMessage(viewID: self.viewID, message: message)
        }
    }
}

@MainActor
final class KirieManager: NSObject {
    static let shared = KirieManager()

    private static let hostWindowRetryDelay: TimeInterval = 0.1
    private static let maxHostWindowResolveAttempts = 50
    private static let kirieRuntimeScript = """
    (() => {
      globalThis.kirie ??= {};
      globalThis.kirie.platform = {
        os: "ios",
        backend: "wkwebview",
      };
    })();
    """

    private let notificationCenter = NotificationCenter.default
    private let sessionID = UUID().uuidString.lowercased()
    private let resourceURLSchemeHandler = KirieResourceURLSchemeHandler()
    private weak var hostViewOverride: UIView?
    private var usesExplicitHost = false
    private var sessions: [Int64: (containerView: UIView, webView: WKWebView)] = [:]
    private var visibility: [Int64: Bool] = [:]

    private override init() {
        super.init()
        logInfo("Manager initialized")
    }

    func attachHostView(_ hostView: UIView) {
        usesExplicitHost = true
        hostViewOverride = hostView
        moveWebViews(to: hostView)
        logInfo("Using an embedded WebView host")
    }

    func detachHostView(_ hostView: UIView) {
        guard hostViewOverride === hostView else {
            return
        }

        hostViewOverride = nil
        for session in sessions.values {
            session.containerView.removeFromSuperview()
        }
        logInfo("Embedded WebView host detached; waiting for the next explicit host")
    }

    func createWebView(viewID: Int64, initialURL: String?, defaultHostView: UIView?) {
        createWebView(
            viewID: viewID,
            initialURL: initialURL,
            defaultHostView: defaultHostView,
            remainingHostWindowAttempts: Self.maxHostWindowResolveAttempts
        )
    }

    private func createWebView(
        viewID: Int64,
        initialURL: String?,
        defaultHostView: UIView?,
        remainingHostWindowAttempts: Int
    ) {
        logInfo(
            "createWebView viewID=\(viewID) initialURL=\(initialURL ?? "<nil>") "
                + "remainingHostWindowAttempts=\(remainingHostWindowAttempts)"
        )

        let hostView = resolveHostView(defaultHostView: defaultHostView)
        if hostView == nil, !usesExplicitHost {
            if remainingHostWindowAttempts > 0 {
                logInfo("No WebView host is available yet; retrying WebView creation")
                DispatchQueue.main.asyncAfter(deadline: .now() + Self.hostWindowRetryDelay) { [weak self] in
                    self?.createWebView(
                        viewID: viewID,
                        initialURL: initialURL,
                        defaultHostView: defaultHostView,
                        remainingHostWindowAttempts: remainingHostWindowAttempts - 1
                    )
                }
                return
            }

            emitIpcError("Cannot create WebView because no host view was found", viewID: viewID)
            return
        }

        let containerView = ensureContainerView(viewID: viewID, attachedTo: hostView)
        let webView = ensureWebView(viewID: viewID, attachedTo: containerView)
        containerView.isHidden = visibility[viewID] == false
        hostView?.layoutIfNeeded()

        DispatchQueue.main.async { [weak self, weak webView] in
            guard let self, let webView, webView === self.sessions[viewID]?.webView else {
                return
            }

            self.post(.kirieWebViewReady, viewID: viewID)

            if let initialURL, !initialURL.isEmpty {
                self.load(initialURL, in: webView, viewID: viewID)
            }
        }
    }

    func setWebViewVisible(viewID: Int64, visible: Bool) {
        visibility[viewID] = visible
        guard let session = sessions[viewID] else {
            return
        }

        if !visible {
            session.webView.endEditing(true)
        }
        session.containerView.isHidden = !visible
    }

    func destroyWebView(viewID: Int64) {
        logInfo("Destroying WebView viewID=\(viewID)")
        visibility.removeValue(forKey: viewID)

        guard let session = sessions.removeValue(forKey: viewID) else {
            return
        }

        session.webView.configuration.userContentController.removeScriptMessageHandler(forName: "kirie")
        session.webView.navigationDelegate = nil
        session.webView.stopLoading()
        session.webView.removeFromSuperview()
        session.containerView.removeFromSuperview()
    }

    func destroyAllWebViews() {
        visibility.removeAll()
        for viewID in Array(sessions.keys) {
            destroyWebView(viewID: viewID)
        }
    }

    func loadURL(_ url: String, viewID: Int64) {
        logInfo("loadURL viewID=\(viewID) url=\(url)")

        guard let webView = sessions[viewID]?.webView else {
            emitIpcError("Cannot load URL because the WebView does not exist", viewID: viewID)
            return
        }

        load(url, in: webView, viewID: viewID)
    }

    func loadHTMLString(_ html: String, baseURLString: String?, viewID: Int64) {
        guard let webView = sessions[viewID]?.webView else {
            emitIpcError("Cannot load HTML string because the WebView does not exist", viewID: viewID)
            return
        }

        let baseURL: URL?
        if let baseURLString, !baseURLString.isEmpty {
            guard let parsedBaseURL = URL(string: baseURLString) else {
                emitIpcError("Cannot load HTML string with invalid base URL: \(baseURLString)", viewID: viewID)
                return
            }

            baseURL = parsedBaseURL
        } else {
            baseURL = nil
        }

        webView.loadHTMLString(html, baseURL: baseURL)
    }

    func sendText(_ message: String, viewID: Int64) {
        dispatchPacket(KirieIpcPacketCodec.encodeText(message), lane: "text", viewID: viewID)
    }

    func sendBinary(_ bytes: Data, viewID: Int64) {
        dispatchPacket(KirieIpcPacketCodec.encodeBinary(bytes), lane: "binary", viewID: viewID)
    }

    func sendDataJSON(_ json: String, viewID: Int64) {
        guard let webView = sessions[viewID]?.webView else {
            emitIpcError("Cannot send data because the WebView does not exist", viewID: viewID)
            return
        }

        do {
            let jsonData = Data(json.utf8)
            let object = try JSONSerialization.jsonObject(with: jsonData, options: [.fragmentsAllowed])
            let value = try KirieIpcValue.fromFoundationObject(object)
            dispatchPacket(KirieIpcPacketCodec.encodeData(value), lane: "data", in: webView, viewID: viewID)
        } catch {
            emitIpcError("Cannot encode data IPC message: \(error.localizedDescription)", viewID: viewID)
        }
    }

    private func dispatchPacket(_ packet: Data, lane: String, in webView: WKWebView? = nil, viewID: Int64) {
        guard let webView = webView ?? sessions[viewID]?.webView else {
            emitIpcError("Cannot send \(lane) because the WebView does not exist", viewID: viewID)
            return
        }

        let message = [
            "lane": lane,
            "packet": packet.base64EncodedString(),
        ]

        guard let messageData = try? JSONSerialization.data(withJSONObject: message),
              let messageLiteral = String(data: messageData, encoding: .utf8) else {
            emitIpcError("Cannot encode \(lane) IPC packet for JavaScript dispatch", viewID: viewID)
            return
        }

        let script = """
        window.dispatchEvent(new CustomEvent("kirie:ipc-packet", { detail: \(messageLiteral) }));
        """

        webView.evaluateJavaScript(script) { [weak self] _, error in
            if let error {
                Task { @MainActor in
                    self?.emitIpcError(
                        "Failed to dispatch \(lane) to WebView: \(error.localizedDescription)",
                        viewID: viewID
                    )
                }
            }
        }
    }

    private func load(_ urlString: String, in webView: WKWebView, viewID: Int64) {
        let resolvedURL: KirieResolvedURL
        do {
            resolvedURL = try KirieURLResolver.resolveForWebView(urlString)
        } catch {
            emitIpcError(error.localizedDescription, viewID: viewID)
            return
        }

        logInfo("Loading URL: \(resolvedURL.url.absoluteString)")
        webView.load(URLRequest(url: resolvedURL.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
    }

    private func ensureContainerView(viewID: Int64, attachedTo hostView: UIView?) -> UIView {
        if let existingContainerView = sessions[viewID]?.containerView {
            if let hostView, existingContainerView.superview !== hostView {
                logInfo("Reattaching existing container view")
                existingContainerView.removeFromSuperview()
                hostView.addSubview(existingContainerView)
                pinToEdges(existingContainerView, in: hostView)
            }

            return existingContainerView
        }

        let containerView = UIView(frame: .zero)
        containerView.translatesAutoresizingMaskIntoConstraints = false
        containerView.backgroundColor = .clear
        containerView.isOpaque = false
        containerView.clipsToBounds = true
        containerView.accessibilityIdentifier = "KirieContainer"

        if let hostView {
            hostView.addSubview(containerView)
            pinToEdges(containerView, in: hostView)
        }

        logInfo("Created container view for viewID=\(viewID)")
        return containerView
    }

    private func ensureWebView(viewID: Int64, attachedTo containerView: UIView) -> WKWebView {
        if let existingWebView = sessions[viewID]?.webView {
            if existingWebView.superview !== containerView {
                logInfo("Reattaching existing WebView")
                existingWebView.removeFromSuperview()
                containerView.addSubview(existingWebView)
                pinToEdges(existingWebView, in: containerView)
            }

            return existingWebView
        }

        let userContentController = WKUserContentController()
        userContentController.addUserScript(
            WKUserScript(
                source: Self.kirieRuntimeScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false
            )
        )
        userContentController.add(KirieScriptMessageHandler(viewID: viewID, manager: self), name: "kirie")

        let webViewConfiguration = WKWebViewConfiguration()
        webViewConfiguration.allowsInlineMediaPlayback = true
        webViewConfiguration.defaultWebpagePreferences.allowsContentJavaScript = true
        webViewConfiguration.userContentController = userContentController
        webViewConfiguration.setURLSchemeHandler(
            resourceURLSchemeHandler,
            forURLScheme: KirieURLResolver.resourceScheme
        )

        let webView = WKWebView(frame: .zero, configuration: webViewConfiguration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.accessibilityIdentifier = "KirieWebView"

        if #available(iOS 16.4, *) {
            webView.isInspectable = KirieRuntimeConfig.current.enableWebInspector
        }

        containerView.addSubview(webView)
        pinToEdges(webView, in: containerView)

        sessions[viewID] = (containerView: containerView, webView: webView)
        logInfo("Created WebView for viewID=\(viewID)")
        return webView
    }

    private func resolveHostWindow() -> UIWindow? {
        let activeScenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }

        for scene in activeScenes {
            if let hostWindow = resolveHostWindow(in: scene) {
                return hostWindow
            }
        }

        return nil
    }

    private func resolveHostWindow(in scene: UIWindowScene) -> UIWindow? {
        scene.windows.first(where: \.isKeyWindow)
            ?? scene.windows.first(where: { !$0.isHidden })
    }

    private func resolveHostView(defaultHostView: UIView?) -> UIView? {
        if usesExplicitHost {
            return hostViewOverride
        }

        return defaultHostView ?? resolveHostWindow()
    }

    private func moveWebViews(to hostView: UIView) {
        for viewID in sessions.keys {
            _ = ensureContainerView(viewID: viewID, attachedTo: hostView)
        }
        hostView.layoutIfNeeded()
    }

    private func pinToEdges(_ childView: UIView, in parentView: UIView) {
        NSLayoutConstraint.activate([
            childView.leadingAnchor.constraint(equalTo: parentView.leadingAnchor),
            childView.trailingAnchor.constraint(equalTo: parentView.trailingAnchor),
            childView.topAnchor.constraint(equalTo: parentView.topAnchor),
            childView.bottomAnchor.constraint(equalTo: parentView.bottomAnchor),
        ])
    }

    private func post(_ name: Notification.Name, object: Any? = nil, viewID: Int64) {
        notificationCenter.post(name: name, object: object, userInfo: ["view_id": viewID])
    }

    private func emitIpcError(_ message: String, viewID: Int64) {
        NSLog("[Kirie] ERROR %@", message)
        notificationCenter.post(name: .kirieIpcError, object: message, userInfo: ["view_id": viewID])
    }

    private func logInfo(_ message: String) {
        NSLog("[Kirie][session=%@] %@", sessionID, message)
    }
}

extension KirieManager {
    func handleScriptMessage(viewID: Int64, message: WKScriptMessage) {
        logInfo("Received WKScriptMessage name=\(message.name) bodyType=\(type(of: message.body))")

        guard message.name == "kirie" else {
            return
        }

        guard let messageJSON = message.body as? String else {
            emitIpcError("Received unsupported IPC message from JavaScript", viewID: viewID)
            return
        }

        handleWebPacketMessage(messageJSON, viewID: viewID)
    }

    private func handleWebPacketMessage(_ messageJSON: String, viewID: Int64) {
        guard let messageData = messageJSON.data(using: .utf8),
              let message = try? JSONDecoder().decode(KirieWebPacketMessage.self, from: messageData),
              let packet = Data(base64Encoded: message.packet) else {
            emitIpcError("Received malformed Kirie IPC packet from JavaScript", viewID: viewID)
            return
        }

        do {
            switch message.lane {
            case "text":
                post(.kirieTextReceived, object: try KirieIpcPacketCodec.decodeText(packet), viewID: viewID)
            case "binary":
                post(.kirieBinaryReceived, object: try KirieIpcPacketCodec.decodeBinary(packet), viewID: viewID)
            case "data":
                post(.kirieDataReceived, object: try KirieIpcPacketCodec.decodeData(packet).foundationObject, viewID: viewID)
            default:
                emitIpcError("Received unsupported IPC lane from JavaScript: \(message.lane)", viewID: viewID)
            }
        } catch {
            emitIpcError("Failed to decode \(message.lane) IPC packet: \(error.localizedDescription)", viewID: viewID)
        }
    }
}

extension KirieManager: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        emitIpcError("Navigation failed: \(error.localizedDescription)", viewID: viewID(for: webView))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        emitIpcError("Initial navigation failed: \(error.localizedDescription)", viewID: viewID(for: webView))
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        emitIpcError("Web content process terminated", viewID: viewID(for: webView))
    }

    private func viewID(for webView: WKWebView) -> Int64 {
        for (viewID, session) in sessions where session.webView === webView {
            return viewID
        }

        return 0
    }

    func webView(
        _ webView: WKWebView,
        respondTo challenge: URLAuthenticationChallenge
    ) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        let protectionSpace = challenge.protectionSpace

        guard KirieRuntimeConfig.current.allowTlsBypass,
              protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = protectionSpace.serverTrust else {
            return (.performDefaultHandling, nil)
        }

        return (.useCredential, URLCredential(trust: serverTrust))
    }
}
