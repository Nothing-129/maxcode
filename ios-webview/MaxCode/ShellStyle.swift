import UIKit

// Keep native shell colors and typography aligned with android-webview resources.
enum ShellStyle {
    static func color(_ light: UInt32, _ dark: UInt32) -> UIColor {
        UIColor { traits in
            let rgb = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((rgb >> 16) & 255) / 255,
                           green: CGFloat((rgb >> 8) & 255) / 255,
                           blue: CGFloat(rgb & 255) / 255, alpha: 1)
        }
    }
    static let surface = color(0xFFFFFF, 0x141414)
    static let card = color(0xFFFFFF, 0x1C1C1C)
    static let primary = color(0x171717, 0xF3F3F3)
    static let secondary = color(0x737373, 0xA3A3A3)
    static let divider = color(0xEBEBEB, 0x333333)
    static let subtle = color(0xF7F7F7, 0x262626)
    static let button = color(0x171717, 0xEEEEEE)
    static let buttonText = color(0xFFFFFF, 0x171717)

    static func label(_ text: String, size: CGFloat, secondary: Bool = false,
                      weight: UIFont.Weight = .regular) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = UIFontMetrics.default.scaledFont(for: .systemFont(ofSize: size, weight: weight))
        label.adjustsFontForContentSizeCategory = true
        label.textColor = secondary ? self.secondary : primary
        label.numberOfLines = 0
        return label
    }
    static func stack(_ axis: NSLayoutConstraint.Axis = .vertical, spacing: CGFloat = 0) -> UIStackView {
        let stack = UIStackView()
        stack.axis = axis
        stack.spacing = spacing
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }
}

final class ShellBorderView: UIView {
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = ShellStyle.card
        layer.cornerRadius = 22
        layer.borderWidth = 1
        layer.borderColor = ShellStyle.divider.resolvedColor(with: traitCollection).cgColor
        clipsToBounds = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        layer.borderColor = ShellStyle.divider.resolvedColor(with: traitCollection).cgColor
    }
}
