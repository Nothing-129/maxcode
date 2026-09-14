import Foundation
import Security

// Store the entire small catalog atomically in a device-only Keychain item.
// No token, address or connection name is written to UserDefaults or a plist.
final class ConnectionStore {
    private let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "app.maxcode.ios.connections",
        kSecAttrAccount as String: "catalog-v1"
    ]

    func load() throws -> [Connection] {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        try check(status)
        guard let data = result as? Data else { throw ShellError.message("无法读取已保存连接。") }
        let catalog = try JSONDecoder().decode([Connection].self, from: data)
        // Revalidate persisted input before using it for requests or JavaScript.
        return try catalog.map {
            try Connection(id: $0.id, name: $0.name, address: $0.baseURL.absoluteString, token: $0.token)
        }
    }

    func save(_ connections: [Connection]) throws {
        let data = try JSONEncoder().encode(connections)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            attributes.forEach { item[$0.key] = $0.value }
            try check(SecItemAdd(item as CFDictionary, nil))
        } else {
            try check(status)
        }
    }

    private func check(_ status: OSStatus) throws {
        guard status == errSecSuccess else {
            throw ShellError.message("无法访问安全存储（\(status)）。请解锁设备后重试。")
        }
    }
}
