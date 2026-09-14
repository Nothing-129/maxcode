import Foundation

struct Connection: Codable, Identifiable, Equatable {
    let id: UUID
    var name: String
    var baseURL: URL
    var token: String

    init(id: UUID = UUID(), name: String, address: String, token: String) throws {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw ShellError.message("请输入连接名称。") }
        guard !token.contains(where: { $0.isNewline || $0 == "\0" }) else {
            throw ShellError.message("Token 不能包含换行或空字符。")
        }
        self.id = id
        self.name = name
        self.baseURL = try ServerURL.normalize(address)
        self.token = token
    }
}

enum ShellError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case .message(let message): return message }
    }
}

enum ServerURL {
    static func normalize(_ raw: String) throws -> URL {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.contains(where: { $0.isWhitespace }) else {
            throw ShellError.message("请输入服务器地址，例如 http://192.168.1.20:3030。")
        }
        if !value.contains("://") { value = "http://" + value }
        guard var parts = URLComponents(string: value),
              let scheme = parts.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.percentEncodedPath.isEmpty || parts.percentEncodedPath == "/",
              parts.port == nil || (1...65535).contains(parts.port!) else {
            throw ShellError.message("请使用 HTTP 或 HTTPS 根地址，不要包含账号、路径、查询参数或锚点。")
        }
        parts.scheme = scheme
        parts.host = host.lowercased()
        parts.path = ""
        if parts.port == (scheme == "https" ? 443 : 80) { parts.port = nil }
        guard let url = parts.url else { throw ShellError.message("服务器地址无效。") }
        return url
    }

    static func sameOrigin(_ base: URL, _ candidate: URL) -> Bool {
        guard let a = URLComponents(url: base, resolvingAgainstBaseURL: false),
              let b = URLComponents(url: candidate, resolvingAgainstBaseURL: false),
              let scheme = a.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = a.host?.lowercased(), !host.isEmpty else { return false }
        return scheme == b.scheme?.lowercased()
            && host == b.host?.lowercased()
            && (a.port ?? (scheme == "https" ? 443 : 80))
                == (b.port ?? (b.scheme?.lowercased() == "https" ? 443 : 80))
            && b.user == nil && b.password == nil
    }

    static func freshWorkspace(_ base: URL) -> URL {
        var parts = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        parts.path = "/workspace"
        parts.queryItems = [URLQueryItem(name: "_frontend_reload", value: UUID().uuidString)]
        return parts.url!
    }
}
