import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        .portrait
    }

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        let navigation = UINavigationController(rootViewController: ConnectionsViewController())
        navigation.navigationBar.prefersLargeTitles = false
        navigation.setNavigationBarHidden(true, animated: false)
        window.rootViewController = navigation
        window.tintColor = .label
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
