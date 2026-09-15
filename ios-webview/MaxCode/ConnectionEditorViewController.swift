import UIKit

final class ConnectionEditorViewController: UIViewController {
    var catalog: [Connection] = []
    private let existing: Connection?
    private let onSave: ([Connection]) -> Void
    private let name = UITextField()
    private let address = UITextField()
    private let token = UITextField()
    private let status = UILabel()
    private let saveButton = UIButton(type: .system)
    private var verification: Task<Void, Never>?

    init(connection: Connection?, onSave: @escaping ([Connection]) -> Void) {
        existing = connection
        self.onSave = onSave
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = existing == nil ? "添加连接" : "编辑连接"
        view.backgroundColor = ShellStyle.card
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.keyboardDismissMode = .interactive
        view.addSubview(scroll)
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        let header = ShellStyle.stack(.horizontal, spacing: 12)
        header.alignment = .center
        let heading = ShellStyle.label(title ?? "添加连接", size: 22)
        heading.accessibilityTraits = .header
        header.addArrangedSubview(heading)
        let close = UIButton(type: .system)
        close.setImage(UIImage(systemName: "xmark"), for: .normal)
        close.tintColor = ShellStyle.primary
        close.accessibilityLabel = "取消"
        close.widthAnchor.constraint(equalToConstant: 48).isActive = true
        close.heightAnchor.constraint(equalToConstant: 48).isActive = true
        close.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        header.addArrangedSubview(close)
        stack.addArrangedSubview(header)
        let subtitle = ShellStyle.label(existing == nil
            ? "填写名称、远程 URL 和 Token，验证后保存连接。"
            : "修改这个连接的名称、远程 URL 或 Token。", size: 14, secondary: true)
        stack.addArrangedSubview(subtitle)
        stack.setCustomSpacing(20, after: subtitle)
        for (title, field, placeholder) in [
            ("连接名称", name, "例如：家里服务器"),
            ("服务器地址", address, "http://192.168.1.20:3030"),
            ("访问令牌", token, "CODEG_TOKEN（未设置时留空）")
        ] {
            let label = ShellStyle.label(title, size: 14, weight: .semibold)
            stack.addArrangedSubview(label)
            field.placeholder = placeholder
            field.borderStyle = .none
            field.textColor = ShellStyle.primary
            field.backgroundColor = .clear
            field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
            field.leftViewMode = .always
            field.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
            field.rightViewMode = .always
            field.font = UIFontMetrics.default.scaledFont(for: .systemFont(ofSize: 16))
            field.adjustsFontForContentSizeCategory = true
            field.autocapitalizationType = .none
            field.autocorrectionType = .no
            field.spellCheckingType = .no
            let input = ShellBorderView()
            input.layer.cornerRadius = 13
            field.translatesAutoresizingMaskIntoConstraints = false
            input.addSubview(field)
            NSLayoutConstraint.activate([
                field.topAnchor.constraint(equalTo: input.topAnchor),
                field.bottomAnchor.constraint(equalTo: input.bottomAnchor),
                field.leadingAnchor.constraint(equalTo: input.leadingAnchor),
                field.trailingAnchor.constraint(equalTo: input.trailingAnchor),
                field.heightAnchor.constraint(greaterThanOrEqualToConstant: 52)
            ])
            stack.setCustomSpacing(6, after: label)
            stack.addArrangedSubview(input)
            stack.setCustomSpacing(16, after: input)
        }
        address.keyboardType = .URL
        token.isSecureTextEntry = true
        token.textContentType = .password
        name.text = existing?.name
        address.text = existing?.baseURL.absoluteString
        token.text = existing?.token
        status.numberOfLines = 0
        status.font = .preferredFont(forTextStyle: .footnote)
        status.textColor = ShellStyle.secondary
        status.text = "填写服务器根地址，不要添加 /workspace。手机需要能访问这台服务器；HTTP 连接请仅用于可信网络。"
        let showToken = UIButton(type: .system)
        var toggleConfig = UIButton.Configuration.plain()
        toggleConfig.title = "显示 Token"
        toggleConfig.image = UIImage(systemName: "square")
        toggleConfig.imagePadding = 8
        toggleConfig.baseForegroundColor = ShellStyle.secondary
        showToken.configuration = toggleConfig
        showToken.contentHorizontalAlignment = .leading
        showToken.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        showToken.addAction(UIAction { [weak self, weak showToken] _ in
            guard let self, let showToken else { return }
            self.token.isSecureTextEntry.toggle()
            showToken.configuration?.image = UIImage(systemName: self.token.isSecureTextEntry ? "square" : "checkmark.square.fill")
            showToken.accessibilityValue = self.token.isSecureTextEntry ? "隐藏" : "显示"
        }, for: .touchUpInside)
        stack.addArrangedSubview(showToken)
        stack.addArrangedSubview(status)
        var saveConfig = UIButton.Configuration.filled()
        saveConfig.title = "验证并保存"
        saveConfig.baseBackgroundColor = ShellStyle.button
        saveConfig.baseForegroundColor = ShellStyle.buttonText
        saveConfig.background.cornerRadius = 13
        saveButton.configuration = saveConfig
        saveButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 52).isActive = true
        saveButton.addTarget(self, action: #selector(save), for: .touchUpInside)
        stack.addArrangedSubview(saveButton)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -24),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48)
        ])
    }

    @objc private func cancel() {
        verification?.cancel()
        dismiss(animated: true)
    }

    @objc private func save() {
        guard verification == nil else { return }
        do {
            let connection = try Connection(id: existing?.id ?? UUID(), name: name.text ?? "",
                                            address: address.text ?? "", token: token.text ?? "")
            view.endEditing(true)
            saveButton.isEnabled = false
            isModalInPresentation = true
            navigationController?.isModalInPresentation = true
            status.text = "正在验证连接…"
            verification = Task { @MainActor [weak self] in
                guard let self else { return }
                defer {
                    self.verification = nil
                    self.saveButton.isEnabled = true
                    self.isModalInPresentation = false
                    self.navigationController?.isModalInPresentation = false
                }
                do {
                    try await ServerHealthChecker.check(connection)
                    try Task.checkCancellation()
                    var updated = self.catalog
                    if let index = updated.firstIndex(where: { $0.id == connection.id }) {
                        updated[index] = connection
                    } else { updated.append(connection) }
                    try ConnectionStore().save(updated)
                    self.onSave(updated)
                    self.dismiss(animated: true)
                } catch {
                    if !Task.isCancelled { self.status.text = error.localizedDescription }
                }
            }
        } catch { status.text = error.localizedDescription }
    }
}
