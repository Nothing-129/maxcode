import Foundation

final class ShellCoreTests {
    func testNormalizeRootAddresses() throws {
        for (input, expected) in [
            (" 192.168.1.20:3030/ ", "http://192.168.1.20:3030"),
            ("HTTPS://EXAMPLE.COM:443/", "https://example.com"),
            ("http://localhost:80", "http://localhost"),
            ("http://[::1]:3030/", "http://[::1]:3030"),
            ("maxcode.local:3030", "http://maxcode.local:3030")
        ] {
            expectEqual(try ServerURL.normalize(input).absoluteString, expected, input)
        }
    }

    func testRejectsCredentialsPathsAndMalformedAddresses() {
        for input in ["", " ", "file:///tmp/server", "javascript://example.com",
                      "https://user:password@example.com", "https://example.com/workspace",
                      "http://example.com/%2F", "http://example.com?token=secret",
                      "http://example.com#fragment", "http://example.com:0",
                      "http://example.com:65536", "http://example.com:nope", "http://",
                      "https://exa mple.com", "https://example.com/../", "https://example.com\\@evil.test"] {
            expectThrows(try ServerURL.normalize(input), input)
        }
    }

    func testOriginComparisonIncludesSchemeHostAndEffectivePort() throws {
        let base = try ServerURL.normalize("https://example.com")
        for input in ["https://example.com/workspace", "https://EXAMPLE.COM:443/settings?a=b"] {
            expectTrue(ServerURL.sameOrigin(base, URL(string: input)!))
        }
        for input in ["http://example.com", "https://example.com:444", "https://example.com.evil.test",
                      "https://evil.test/example.com", "https://user@example.com", "about:blank", "file:///tmp"] {
            expectFalse(ServerURL.sameOrigin(base, URL(string: input)!))
        }
    }

    func testFreshWorkspaceHasUniqueCacheKeyAndNoCredentials() throws {
        let base = try ServerURL.normalize("http://localhost:3030")
        let first = ServerURL.freshWorkspace(base)
        let second = ServerURL.freshWorkspace(base)
        expectNotEqual(first, second)
        expectEqual(first.path, "/workspace")
        expectTrue(ServerURL.sameOrigin(base, first))
        let items = URLComponents(url: first, resolvingAgainstBaseURL: false)!.queryItems!
        expectEqual(items.count, 1)
        expectEqual(items.first?.name, "_frontend_reload")
        expectNotNil(UUID(uuidString: items.first!.value!))
    }

    func testConnectionValidationAndStableIdentity() throws {
        let id = UUID()
        let connection = try Connection(id: id, name: " Home ", address: "localhost:3030", token: " secret ")
        expectEqual(connection.id, id)
        expectEqual(connection.name, "Home")
        expectEqual(connection.token, "secret")
        expectThrows(try Connection(name: " ", address: "localhost", token: ""))
        expectThrows(try Connection(name: "Home", address: "localhost", token: "bad\r\nheader"))
        expectThrows(try Connection(name: "Home", address: "localhost", token: "bad\0token"))
        expectNoThrow(try Connection(name: "Home", address: "localhost", token: ""))
        let data = try JSONEncoder().encode(connection)
        expectEqual(try JSONDecoder().decode(Connection.self, from: data), connection)
    }

    func testJavaScriptQuotingRoundTripsHostileTokens() throws {
        for token in ["\"');window.pwned=true;//", "\\\n\r\t</script>", "中文🔑\u{2028}\u{2029}", ""] {
            let literal = WebScripts.quote(token)
            expectEqual(try JSONDecoder().decode(String.self, from: Data(literal.utf8)), token)
            expectFalse(literal.contains("\u{2028}"))
            expectFalse(literal.contains("\u{2029}"))
            let connection = try Connection(name: "Home", address: "localhost:3030", token: token.replacingOccurrences(of: "\n", with: "").replacingOccurrences(of: "\r", with: ""))
            let script = WebScripts.bootstrap(connection)
            expectTrue(script.contains("window.top !== window"))
            expectTrue(script.contains("window.location.origin !== " + WebScripts.quote(connection.baseURL.absoluteString)))
            expectTrue(script.contains("localStorage.setItem('codeg_token', " + WebScripts.quote(connection.token)))
        }
    }

    func testHealthUsesAuthenticatedPostWithoutPuttingTokenInURL() throws {
        let connection = try Connection(name: "Home", address: "localhost:3030", token: "secret")
        let request = ServerHealthChecker.request(for: connection)
        expectEqual(request.url?.absoluteString, "http://localhost:3030/api/health")
        expectEqual(request.httpMethod, "POST")
        expectEqual(request.httpBody, Data("{}".utf8))
        expectEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
        expectEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        expectEqual(request.timeoutInterval, 10)
        expectEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
        let noToken = try Connection(name: "Local", address: "localhost:3030", token: "")
        expectNil(ServerHealthChecker.request(for: noToken).value(forHTTPHeaderField: "Authorization"))
    }

    func testHealthRejectsAuthErrorsRedirectsAndServerErrors() {
        for status in [200, 204, 299] { expectNoThrow(try ServerHealthChecker.validate(status: status)) }
        for status in [301, 302, 307, 308, 401, 403, 404, 500, 503] {
            expectThrows(try ServerHealthChecker.validate(status: status), "HTTP \(status)")
        }
    }

    func testHealthRedirectDelegateDoesNotForwardCredentials() {
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let url = URL(string: "https://example.com/api/health")!
        let task = session.dataTask(with: url)
        let response = HTTPURLResponse(url: url, statusCode: 302, httpVersion: nil,
                                       headerFields: ["Location": "https://other.example/api/health"])!
        let request = URLRequest(url: URL(string: "https://other.example/api/health")!)
        var called = false
        NoHealthRedirects().urlSession(session, task: task, willPerformHTTPRedirection: response,
                                       newRequest: request) { redirectedRequest in
            called = true
            expectNil(redirectedRequest)
        }
        expectTrue(called)
    }
}

private func expectTrue(_ value: @autoclosure () -> Bool, _ message: String = "", file: StaticString = #file, line: UInt = #line) {
    precondition(value(), "Expected true: " + message, file: file, line: line)
}
private func expectFalse(_ value: @autoclosure () -> Bool, file: StaticString = #file, line: UInt = #line) {
    precondition(!value(), "Expected false", file: file, line: line)
}
private func expectEqual<T: Equatable>(_ actual: @autoclosure () throws -> T, _ expected: T, _ message: String = "", file: StaticString = #file, line: UInt = #line) {
    do { let result = try actual(); precondition(result == expected, "Values differ: " + message, file: file, line: line) }
    catch { fatalError("Unexpected error: \(error)", file: file, line: line) }
}
private func expectNotEqual<T: Equatable>(_ actual: T, _ other: T, file: StaticString = #file, line: UInt = #line) {
    precondition(actual != other, "Values must differ", file: file, line: line)
}
private func expectThrows<T>(_ action: @autoclosure () throws -> T, _ message: String = "", file: StaticString = #file, line: UInt = #line) {
    do { _ = try action() } catch { return }
    fatalError("Expected an error: " + message, file: file, line: line)
}
private func expectNoThrow<T>(_ action: @autoclosure () throws -> T, file: StaticString = #file, line: UInt = #line) {
    do { _ = try action() } catch { fatalError("Unexpected error: \(error)", file: file, line: line) }
}
private func expectNil<T>(_ value: T?, file: StaticString = #file, line: UInt = #line) {
    precondition(value == nil, "Expected nil", file: file, line: line)
}
private func expectNotNil<T>(_ value: T?, file: StaticString = #file, line: UInt = #line) {
    precondition(value != nil, "Expected a value", file: file, line: line)
}

@main
private enum CoreTestRunner {
    static func main() throws {
        if CommandLine.arguments.contains("--bootstrap-fixture") {
            let token = "\"');window.pwned=true;//中文🔑\\\u{2028}\u{2029}"
            var connection = try Connection(name: "Test", address: "https://example.com:443", token: "")
            // Exercise script escaping even for characters rejected/trimmed by the form.
            connection.token = token
            let fixture = ["script": WebScripts.bootstrap(connection), "token": token,
                           "layout": WebScripts.layout, "wake": WebScripts.wake, "viewport": WebScripts.viewport]
            print(String(decoding: try JSONEncoder().encode(fixture), as: UTF8.self))
            return
        }
        let tests = ShellCoreTests()
        try tests.testNormalizeRootAddresses()
        tests.testRejectsCredentialsPathsAndMalformedAddresses()
        try tests.testOriginComparisonIncludesSchemeHostAndEffectivePort()
        try tests.testFreshWorkspaceHasUniqueCacheKeyAndNoCredentials()
        try tests.testConnectionValidationAndStableIdentity()
        try tests.testJavaScriptQuotingRoundTripsHostileTokens()
        try tests.testHealthUsesAuthenticatedPostWithoutPuttingTokenInURL()
        tests.testHealthRejectsAuthErrorsRedirectsAndServerErrors()
        tests.testHealthRedirectDelegateDoesNotForwardCredentials()
        print("Passed 9 Swift core test groups")
    }
}
