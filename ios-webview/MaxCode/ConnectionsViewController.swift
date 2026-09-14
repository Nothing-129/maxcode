import UIKit

final class ConnectionsViewController: UITableViewController {
    private let store = ConnectionStore()
    private var connections: [Connection] = []
    private var loaded = false
    private var connecting = false

    init() { super.init(style: .insetGrouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "MaxCode"
        navigationItem.backButtonTitle = "连接"
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .add, target: self, action: #selector(addConnection))
        tableView.rowHeight = 76
        let header = UIStackView()
        header.axis = .vertical
        header.alignment = .center
        header.spacing = 12
        let logo = UIImageView(image: UIImage(named: "Brand"))
        logo.contentMode = .scaleAspectFit
        logo.heightAnchor.constraint(equalToConstant: 64).isActive = true
        logo.widthAnchor.constraint(equalToConstant: 64).isActive = true
        header.addArrangedSubview(logo)
        let description = UILabel()
        description.text = "连接你的 MaxCode 服务器"
        description.font = .preferredFont(forTextStyle: .subheadline)
        description.textColor = .secondaryLabel
        header.addArrangedSubview(description)
        header.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: 120)
        tableView.tableHeaderView = header
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !loaded else { return }
        do {
            connections = try store.load()
            loaded = true
            tableView.reloadData()
        } catch { showError(error) }
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        connections.count + 1
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        if indexPath.row == connections.count {
            cell.textLabel?.text = "添加连接"
            cell.textLabel?.textColor = .secondaryLabel
            cell.imageView?.image = UIImage(systemName: "plus")
        } else {
            let connection = connections[indexPath.row]
            cell.textLabel?.text = connection.name
            cell.detailTextLabel?.text = connection.baseURL.absoluteString
            cell.detailTextLabel?.textColor = .secondaryLabel
            cell.imageView?.image = UIImage(systemName: "server.rack")
            cell.accessoryType = .detailButton
        }
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard !connecting, loaded else { return }
        if indexPath.row == connections.count { addConnection() }
        else { connect(connections[indexPath.row]) }
    }

    override func tableView(_ tableView: UITableView, accessoryButtonTappedForRowWith indexPath: IndexPath) {
        guard !connecting, loaded else { return }
        edit(connections[indexPath.row])
    }

    override func tableView(_ tableView: UITableView,
                            trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard indexPath.row < connections.count, !connecting, loaded else { return nil }
        let connection = connections[indexPath.row]
        let delete = UIContextualAction(style: .destructive, title: "删除") { [weak self] _, _, done in
            done(false)
            self?.confirmDelete(connection)
        }
        let edit = UIContextualAction(style: .normal, title: "编辑") { [weak self] _, _, done in
            done(true)
            self?.edit(connection)
        }
        let config = UISwipeActionsConfiguration(actions: [delete, edit])
        config.performsFirstActionWithFullSwipe = false
        return config
    }

    @objc private func addConnection() {
        guard loaded, !connecting else { return }
        edit(nil)
    }

    private func edit(_ existing: Connection?) {
        let editor = ConnectionEditorViewController(connection: existing) { [weak self] connection in
            self?.connections = connection
            self?.tableView.reloadData()
        }
        editor.catalog = connections
        let sheet = UINavigationController(rootViewController: editor)
        sheet.modalPresentationStyle = .pageSheet
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
                self.tableView.reloadData()
            } catch { self.showError(error) }
        })
        present(alert, animated: true)
    }

    private func connect(_ connection: Connection) {
        connecting = true
        tableView.isUserInteractionEnabled = false
        navigationItem.rightBarButtonItem?.isEnabled = false
        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.startAnimating()
        navigationItem.titleView = spinner
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                self.connecting = false
                self.tableView.isUserInteractionEnabled = true
                self.navigationItem.rightBarButtonItem?.isEnabled = true
                self.navigationItem.titleView = nil
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
