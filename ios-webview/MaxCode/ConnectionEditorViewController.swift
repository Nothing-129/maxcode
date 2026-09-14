import UIKit

final class ConnectionEditorViewController: UIViewController {
    var catalog: [Connection] = []
    private let existing: Connection?
    private let onSave: ([Connection]) -> Void
    private let name = UITextField()
    private let address = UITextField()
    private let token = UITextField()
    private let status = UILabel()
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
        view.backgroundColor = .systemGroupedBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "取消", style: .plain, target: self, action: #selector(cancel))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "验证并保存", style: .done, target: self, action: #selector(save))
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.keyboardDismissMode = .interactive
        view.addSubview(scroll)
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        for (title, field, placeholder) in [
            ("连接名称", name, "家里的 Mac"),
            ("服务器地址", address, "http://192.168.1.20:3030"),
            ("访问 Token", token, "CODEG_TOKEN（未设置时留空）")
        ] {
            let label = UILabel()
            label.text = title
            label.font = .preferredFont(forTextStyle: .subheadline)
            stack.addArrangedSubview(label)
            field.placeholder = placeholder
            field.borderStyle = .roundedRect
            field.font = .preferredFont(forTextStyle: .body)
            field.adjustsFontForContentSizeCategory = true
            field.autocapitalizationType = .none
            field.autocorrectionType = .no
            field.spellCheckingType = .no
            field.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
            stack.addArrangedSubview(field)
            stack.setCustomSpacing(24, after: field)
        }
        address.keyboardType = .URL
        token.isSecureTextEntry = true
        token.textContentType = .password
        name.text = existing?.name
        address.text = existing?.baseURL.absoluteString
        token.text = existing?.token
        status.numberOfLines = 0
        status.font = .preferredFont(forTextStyle: .footnote)
        status.textColor = .secondaryLabel
        status.text = "填写服务器根地址，不要添加 /workspace。手机需要能访问这台服务器；HTTP 连接请仅用于可信网络。"
        stack.addArrangedSubview(status)
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
            navigationItem.rightBarButtonItem?.isEnabled = false
            isModalInPresentation = true
            navigationController?.isModalInPresentation = true
            status.text = "正在验证连接…"
            verification = Task { @MainActor [weak self] in
                guard let self else { return }
                defer {
                    self.verification = nil
                    self.navigationItem.rightBarButtonItem?.isEnabled = true
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
