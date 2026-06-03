//
//  WebView.swift
//  Maison · Madame
//
//  SwiftUI wrapper around WKWebView. Configures cookie / storage
//  persistence (so Madame's saved looks, hearts, pick list survive
//  app restarts) and grants camera/microphone permission inline for
//  the Virtual Try-On flow.
//

import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool
    @Binding var loadError: String?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        // Persistent data store — backed by disk so localStorage + cookies
        // survive between app launches. The web app uses localStorage for
        // saved looks, hearts, pick list, event suggestions, etc., so this
        // is non-negotiable.
        let dataStore = WKWebsiteDataStore.default()

        let config = WKWebViewConfiguration()
        config.websiteDataStore = dataStore
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []   // VTO camera launches inline
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        // Pre-fill a marker into the page so JS knows it's running inside
        // the native shell — lets the SPA hide irrelevant chrome and skip
        // the role picker.
        let bootScript = WKUserScript(
            source: """
            (function(){
              try {
                window.__MAISON_NATIVE__ = 'ipad';
                document.documentElement.classList.add('native-ipad');
              } catch(_){}
            })();
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(bootScript)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.customUserAgent = (webView.value(forKey: "userAgent") as? String ?? "") + " MaisonMadame-iPad/1.0"

        let req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        webView.load(req)

        // Listen for retry events from the offline overlay.
        NotificationCenter.default.addObserver(
            forName: .maisonReload, object: nil, queue: .main
        ) { [weak webView] _ in
            guard let webView = webView else { return }
            webView.load(URLRequest(url: webView.url ?? URL(string: "https://digitalwardrobe-eta.vercel.app/?role=madame&native=ipad")!,
                                    cachePolicy: .reloadIgnoringLocalCacheData,
                                    timeoutInterval: 15))
        }

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // No-op — state changes are pushed via the Coordinator + notifications.
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: WebView

        init(_ parent: WebView) { self.parent = parent }

        // First successful paint — hide the launch overlay.
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                self.parent.isLoading = false
                self.parent.loadError = nil
            }
        }

        // Load failed before content was committed (DNS, offline, etc.)
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            handleFailure(error)
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            handleFailure(error)
        }
        private func handleFailure(_ error: Error) {
            DispatchQueue.main.async {
                self.parent.isLoading = false
                let ns = error as NSError
                if ns.code == NSURLErrorCancelled { return }  // user navigated away
                self.parent.loadError = ns.localizedDescription
            }
        }

        // Open target=_blank links in the same view (no Safari handoff)
        func webView(_ webView: WKWebView,
                     createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url {
                webView.load(URLRequest(url: url))
            }
            return nil
        }

        // JS permission prompts — auto-allow camera / mic for VTO so the
        // user doesn't get a redundant prompt on top of iOS's own one.
        @available(iOS 15.0, *)
        func webView(_ webView: WKWebView,
                     requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo,
                     type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(.grant)
        }
    }
}
