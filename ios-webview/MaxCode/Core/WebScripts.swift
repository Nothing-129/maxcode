import Foundation

enum WebScripts {
    static func quote(_ value: String) -> String {
        // JSON encoding prevents quotes, backslashes and Unicode from becoming code.
        let data = try! JSONEncoder().encode(value)
        return String(decoding: data, as: UTF8.self)
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }

    static func bootstrap(_ connection: Connection) -> String {
        """
        (() => {
          if (window.top !== window || window.location.origin !== \(quote(connection.baseURL.absoluteString))) return;
          localStorage.setItem('codeg_token', \(quote(connection.token)));
        })();
        """
    }

    // UIKit already places the viewport inside the safe area and above the keyboard.
    static let layout = """
    (() => {
      const style = document.createElement('style');
      style.id = 'maxcode-ios-safe-area';
      style.textContent = `body { padding: 0 !important; }
        div.fixed.inset-0.flex.flex-col.overflow-hidden.bg-background.text-foreground,
        div.h-screen.flex.flex-col.overflow-hidden.bg-background.text-foreground {
          padding: 0 !important;
        }`;
      (document.head || document.documentElement).appendChild(style);
      const originalOpen = window.open;
      window.open = function(url, name, features) {
        if ((url === '' || url == null) && !features) {
          let href = 'about:blank';
          return { location: { get href() { return href; }, set href(value) {
            href = String(value); window.location.assign(href);
          } }, close() {}, closed: false };
        }
        return originalOpen.call(window, url, name, features);
      };
    })();
    """

    static let wake = """
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    """
}
