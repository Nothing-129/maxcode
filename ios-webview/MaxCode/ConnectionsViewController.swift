import UIKit

final class ConnectionsViewController: UIViewController {
    private let store = ConnectionStore()
    private var connections: [Connection] = []
    private var loaded = false
    private var connecting = false
    private let rows = ShellStyle.stack()
    private let card = ShellBorderView()
    private let addButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "MaxCode"
        navigationItem.backButtonTitle = "连接"
        view.backgroundColor = ShellStyle.surface
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        let content = UIView()
        content.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(content)
        let brand = ShellStyle.stack(.horizontal, spacing: 9)
        brand.alignment = .center
        let logo = UIImageView(image: UIImage(named: "Brand"))
        logo.contentMode = .scaleAspectFit
        brand.addArrangedSubview(logo)
        brand.addArrangedSubview(ShellStyle.label("MaxCode", size: 18))
        content.addSubview(brand)
        let heading = ShellStyle.label("连接你的工作区", size: 29)
        heading.textAlignment = .center
        heading.accessibilityTraits = .header
        let subtitle = ShellStyle.label("选择一台设备，继续你的创作。", size: 14, secondary: true)
        subtitle.textAlignment = .center
        let body = ShellStyle.stack(spacing: 11)
        body.addArrangedSubview(heading)
        body.addArrangedSubview(subtitle)
        body.setCustomSpacing(40, after: subtitle)
        body.addArrangedSubview(ShellStyle.label("已保存的连接", size: 12, secondary: true))
        body.setCustomSpacing(12, after: body.arrangedSubviews.last!)
        card.addSubview(rows)
        body.addArrangedSubview(card)
        var addConfig = UIButton.Configuration.plain()
        addConfig.title = "添加连接"
        addConfig.image = UIImage(systemName: "plus")
        addConfig.imagePadding = 8
        addConfig.baseForegroundColor = ShellStyle.secondary
        addConfig.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
            var attributes = attributes
            attributes.font = UIFont.systemFont(ofSize: 15)
            return attributes
        }
        addButton.configuration = addConfig
        addButton.addTarget(self, action: #selector(addConnection), for: .touchUpInside)
        addButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        body.addArrangedSubview(addButton)
        spinner.hidesWhenStopped = true
        body.addArrangedSubview(spinner)
        content.addSubview(body)
        let footer = ShellStyle.stack(.horizontal, spacing: 6)
        footer.alignment = .center
        let shield = UIImageView(image: UIImage(systemName: "checkmark.shield"))
        shield.tintColor = ShellStyle.secondary
        shield.contentMode = .scaleAspectFit
        footer.addArrangedSubview(shield)
        footer.addArrangedSubview(ShellStyle.label("连接保存在本机 · 凭据加密存储", size: 12, secondary: true))
        content.addSubview(footer)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            content.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            content.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            content.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            content.heightAnchor.constraint(greaterThanOrEqualTo: scroll.frameLayoutGuide.heightAnchor),
            brand.topAnchor.constraint(equalTo: content.topAnchor),
            brand.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            brand.heightAnchor.constraint(equalToConstant: 64),
            logo.widthAnchor.constraint(equalToConstant: 34),
            logo.heightAnchor.constraint(equalToConstant: 34),
            body.topAnchor.constraint(equalTo: brand.bottomAnchor, constant: 92),
            body.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            body.widthAnchor.constraint(equalTo: content.widthAnchor, constant: -48),
            rows.topAnchor.constraint(equalTo: card.topAnchor),
            rows.bottomAnchor.constraint(equalTo: card.bottomAnchor),
            rows.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            rows.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            footer.topAnchor.constraint(greaterThanOrEqualTo: body.bottomAnchor, constant: 72),
            footer.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -28),
            footer.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            footer.widthAnchor.constraint(lessThanOrEqualTo: content.widthAnchor, constant: -48),
            shield.widthAnchor.constraint(equalToConstant: 14),
            shield.heightAnchor.constraint(equalToConstant: 14)
        ])
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: animated)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !loaded else { return }
        do {
            connections = try store.load()
            loaded = true
            renderConnections()
        } catch { showError(error) }
    }

    private func renderConnections() {
        rows.arrangedSubviews.forEach { $0.removeFromSuperview() }
        card.isHidden = connections.isEmpty
        for (index, connection) in connections.enumerated() {
            let row = UIView()
            let open = UIButton(type: .custom)
            open.translatesAutoresizingMaskIntoConstraints = false
            open.accessibilityLabel = "连接 \(connection.name)"
            open.addAction(UIAction { [weak self] _ in
                guard let self, !self.connecting, self.loaded else { return }
                self.connect(connection)
            }, for: .touchUpInside)
            let info = ShellStyle.stack(.horizontal, spacing: 14)
            info.isUserInteractionEnabled = false
            info.isAccessibilityElement = false
            info.accessibilityElementsHidden = true
            info.alignment = .center
            let icon = UIImageView(image: UIImage(systemName: "desktopcomputer"))
            icon.contentMode = .center
            icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 18)
            icon.tintColor = ShellStyle.primary
            icon.backgroundColor = ShellStyle.subtle
            icon.layer.cornerRadius = 12
            info.addArrangedSubview(icon)
            let text = ShellStyle.stack(spacing: 5)
            let name = ShellStyle.label(connection.name, size: 16)
            name.numberOfLines = 2
            text.addArrangedSubview(name)
            text.addArrangedSubview(ShellStyle.label("轻点连接", size: 12, secondary: true))
            info.addArrangedSubview(text)
            open.addSubview(info)
            row.addSubview(open)
            let more = UIButton(type: .system)
            more.translatesAutoresizingMaskIntoConstraints = false
            more.setImage(UIImage(systemName: "ellipsis"), for: .normal)
            more.tintColor = ShellStyle.secondary
            more.accessibilityLabel = "管理 \(connection.name)"
            more.showsMenuAsPrimaryAction = true
            more.menu = UIMenu(children: [
                UIAction(title: "编辑", image: UIImage(systemName: "pencil")) { [weak self] _ in self?.edit(connection) },
                UIAction(title: "删除", image: UIImage(systemName: "trash"), attributes: .destructive) { [weak self] _ in self?.confirmDelete(connection) }
            ])
            row.addSubview(more)
            NSLayoutConstraint.activate([
                row.heightAnchor.constraint(greaterThanOrEqualToConstant: 88),
                open.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 16),
                open.topAnchor.constraint(equalTo: row.topAnchor),
                open.bottomAnchor.constraint(equalTo: row.bottomAnchor),
                open.trailingAnchor.constraint(equalTo: more.leadingAnchor),
                more.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -8),
                more.centerYAnchor.constraint(equalTo: row.centerYAnchor),
                more.widthAnchor.constraint(equalToConstant: 48),
                more.heightAnchor.constraint(equalToConstant: 48),
                info.leadingAnchor.constraint(equalTo: open.leadingAnchor),
                info.trailingAnchor.constraint(equalTo: open.trailingAnchor),
                info.topAnchor.constraint(equalTo: open.topAnchor, constant: 14),
                info.bottomAnchor.constraint(equalTo: open.bottomAnchor, constant: -14),
                icon.widthAnchor.constraint(equalToConstant: 38),
                icon.heightAnchor.constraint(equalToConstant: 38)
            ])
            rows.addArrangedSubview(row)
            if index < connections.count - 1 {
                let divider = UIView()
                let line = UIView()
                line.backgroundColor = ShellStyle.divider
                line.translatesAutoresizingMaskIntoConstraints = false
                divider.addSubview(line)
                NSLayoutConstraint.activate([
                    divider.heightAnchor.constraint(equalToConstant: 1),
                    line.topAnchor.constraint(equalTo: divider.topAnchor),
                    line.bottomAnchor.constraint(equalTo: divider.bottomAnchor),
                    line.leadingAnchor.constraint(equalTo: divider.leadingAnchor, constant: 68),
                    line.trailingAnchor.constraint(equalTo: divider.trailingAnchor, constant: -18)
                ])
                rows.addArrangedSubview(divider)
            }
        }
    }

    @objc private func addConnection() {
        guard loaded, !connecting else { return }
        edit(nil)
    }

    private func edit(_ existing: Connection?) {
        let editor = ConnectionEditorViewController(connection: existing) { [weak self] connection in
            self?.connections = connection
            self?.renderConnections()
        }
        editor.catalog = connections
        let sheet = UINavigationController(rootViewController: editor)
        sheet.setNavigationBarHidden(true, animated: false)
        sheet.modalPresentationStyle = .pageSheet
        sheet.sheetPresentationController?.detents = [.custom { context in min(620, context.maximumDetentValue) }, .large()]
        sheet.sheetPresentationController?.preferredCornerRadius = 26
        present(sheet, animated: true)
    }

    private func confirmDelete(_ connection: Connection) {
        let alert = UIAlertController(title: "删除“\(connection.name)”？", message: "将移除此设备保存的地址和 Token。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "删除", style: .destructive) { [weak self] _ in
            guard let self else { return }
            do {
                let remaining = self.connections.filter { $0.id != connection.id }
                try self.store.save(remaining)
                self.connections = remaining
                self.renderConnections()
            } catch { self.showError(error) }
        })
        present(alert, animated: true)
    }

    private func connect(_ connection: Connection) {
        connecting = true
        rows.isUserInteractionEnabled = false
        addButton.isEnabled = false

        spinner.startAnimating()
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                self.connecting = false
                self.rows.isUserInteractionEnabled = true
                self.addButton.isEnabled = true
                self.spinner.stopAnimating()

            }
            do {
                try await ServerHealthChecker.check(connection)
                self.navigationController?.pushViewController(WorkspaceViewController(connection: connection), animated: true)
            } catch { self.showError(error) }
        }
    }

    private func showError(_ error: Error) {
        let alert = UIAlertController(title: "无法连接", message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default))
        present(alert, animated: true)
    }
}
