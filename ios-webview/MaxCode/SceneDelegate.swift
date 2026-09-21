import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let navigation = UINavigationController(rootViewController: ConnectionsViewController())
        navigation.navigationBar.prefersLargeTitles = false
        navigation.setNavigationBarHidden(true, animated: false)
        window.rootViewController = navigation
        window.tintColor = .label
        window.makeKeyAndVisible()
        self.window = window
    }
}
