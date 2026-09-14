import Foundation

// Never follow health redirects: the user must explicitly select the destination
// that will receive their Bearer token. Default TLS verification remains intact.
final class NoHealthRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

enum ServerHealthChecker {
    static func request(for connection: Connection) -> URLRequest {
        var request = URLRequest(url: connection.baseURL.appendingPathComponent("api/health"))
        request.httpMethod = "POST"
        request.httpBody = Data("{}".utf8)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !connection.token.isEmpty {
            request.setValue("Bearer " + connection.token, forHTTPHeaderField: "Authorization")
        }
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 10
        return request
    }

    static func validate(status: Int) throws {
        switch status {
        case 200..<300: return
        case 401, 403: throw ShellError.message("Token 无效或没有访问权限，请编辑连接后重试。")
        case 300..<400: throw ShellError.message("服务器返回了重定向，请填写最终服务器根地址。")
        default: throw ShellError.message("服务器检查失败（HTTP \(status)）。请确认 MaxCode 服务正在运行。")
        }
    }

    static func check(_ connection: Connection) async throws {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForResource = 15
        config.httpCookieStorage = nil
        let session = URLSession(configuration: config, delegate: NoHealthRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (_, response) = try await session.data(for: request(for: connection))
        guard let http = response as? HTTPURLResponse else {
            throw ShellError.message("服务器未返回 HTTP 响应。")
        }
        try validate(status: http.statusCode)
    }
}
