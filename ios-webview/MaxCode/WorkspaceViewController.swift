import UIKit
import WebKit
import Network

final class WorkspaceViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let connection: Connection
    private var webView: WKWebView!
    private let progress = UIProgressView(progressViewStyle: .bar)
    private let errorLabel = UILabel()
    private var progressObservation: NSKeyValueObservation?
    private let monitor = NWPathMonitor()

    init(connection: Connection) {
        self.connection = connection
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = connection.name
        navigationItem.largeTitleDisplayMode = .never
        view.backgroundColor = .systemBackground
        let refresh = UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(refreshPage))
        refresh.accessibilityLabel = "刷新工作区"
        let back = UIBarButtonItem(image: UIImage(systemName: "chevron.backward"), style: .plain,
                                  target: self, action: #selector(backPage))
        back.accessibilityLabel = "返回上一网页"
        navigationItem.rightBarButtonItems = [refresh, back]

        let config = WKWebViewConfiguration()
        // A new in-memory store per connection prevents cookies, drafts and tokens
        // leaking between two accounts that use the same server origin.
        config.websiteDataStore = .nonPersistent()
        config.applicationNameForUserAgent = "MaxCodeiOS/0.1.0"
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.userContentController.addUserScript(WKUserScript(
            source: WebScripts.bootstrap(connection), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.addUserScript(WKUserScript(
            source: WebScripts.layout, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        progress.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(progress)
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.font = .preferredFont(forTextStyle: .body)
        errorLabel.backgroundColor = .systemBackground
        errorLabel.isHidden = true
        errorLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(errorLabel)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            progress.topAnchor.constraint(equalTo: webView.topAnchor),
            progress.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
            errorLabel.centerYAnchor.constraint(equalTo: webView.centerYAnchor),
            errorLabel.leadingAnchor.constraint(equalTo: webView.leadingAnchor, constant: 24),
            errorLabel.trailingAnchor.constraint(equalTo: webView.trailingAnchor, constant: -24)
        ])
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] web, _ in
            self?.progress.progress = Float(web.estimatedProgress)
            self?.progress.isHidden = web.estimatedProgress >= 1
        }
        NotificationCenter.default.addObserver(self, selector: #selector(wake),
            name: UIApplication.didBecomeActiveNotification, object: nil)
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            DispatchQueue.main.async { self?.wake() }
        }
        monitor.start(queue: DispatchQueue(label: "app.maxcode.ios.network"))
        refreshPage()
    }

    deinit {
        monitor.cancel()
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func refreshPage() {
        errorLabel.isHidden = true
        webView.load(URLRequest(url: ServerURL.freshWorkspace(connection.baseURL),
                               cachePolicy: .reloadIgnoringLocalCacheData))
    }

    @objc private func backPage() {
        if webView.canGoBack { webView.goBack() }
    }

    @objc private func wake() {
        guard isViewLoaded, view.window != nil, let url = webView.url,
              ServerURL.sameOrigin(connection.baseURL, url) else { return }
        webView.evaluateJavaScript(WebScripts.wake, completionHandler: nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if ServerURL.sameOrigin(connection.baseURL, url) {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            // Never send iframe redirects or arbitrary custom schemes to other apps.
            if navigationAction.navigationType == .linkActivated,
               navigationAction.targetFrame?.isMainFrame != false,
               ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        // Downloads are not silently handed to Safari, which lacks the app's token.
        guard navigationResponse.canShowMIMEType else {
            decisionHandler(.cancel)
            showMessage("此文件暂不支持在应用内下载，请在电脑端保存。")
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil, let url = navigationAction.request.url else { return nil }
        if ServerURL.sameOrigin(connection.baseURL, url) {
            webView.load(navigationAction.request)
        } else if ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        errorLabel.isHidden = true
        progress.isHidden = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        progress.isHidden = true
        navigationItem.rightBarButtonItems?.last?.isEnabled = webView.canGoBack
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showNavigationError(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showNavigationError(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        errorLabel.text = "页面已被系统释放。点击右上角刷新重新打开工作区。"
        errorLabel.isHidden = false
        progress.isHidden = true
    }

    private func showNavigationError(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        progress.isHidden = true
        errorLabel.text = "\(error.localizedDescription)\n\n点击右上角刷新重试，或返回连接列表编辑地址。"
        errorLabel.isHidden = false
    }

    private func showMessage(_ message: String) {
        guard presentedViewController == nil, view.window != nil else { return }
        let alert = UIAlertController(title: "MaxCode", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default))
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard presentedViewController == nil, view.window != nil else { completionHandler(); return }
        let alert = UIAlertController(title: connection.name, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard presentedViewController == nil, view.window != nil else { completionHandler(false); return }
        let alert = UIAlertController(title: connection.name, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        guard presentedViewController == nil, view.window != nil else { completionHandler(nil); return }
        let alert = UIAlertController(title: connection.name, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
        })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }
}
