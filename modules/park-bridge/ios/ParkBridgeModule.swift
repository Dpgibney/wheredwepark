import ExpoModulesCore
import Security
import UserNotifications

// These keys/identifiers MUST match the ones the App Intent reads in
// plugins/with-park-intent/swift/ (ParkKeychain.swift + SupabaseParkClient.swift +
// CarAppEntity.swift). The Intent runs in the SAME app process/target, so
// UserDefaults.standard and the default keychain access group are shared with no
// App Group or keychain-sharing entitlement required.
private let kSupabaseUrlKey = "park.supabaseUrl"
private let kSupabaseAnonKey = "park.supabaseAnonKey"
private let kCarsKey = "park.cars"
private let kKeychainService = "park.supabase.session"
private let kKeychainAccount = "session"

public class ParkBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ParkBridge")

    Function("syncConfig") { (url: String, anonKey: String) in
      let defaults = UserDefaults.standard
      defaults.set(url, forKey: kSupabaseUrlKey)
      defaults.set(anonKey, forKey: kSupabaseAnonKey)
    }

    Function("syncCars") { (carsJson: String) in
      UserDefaults.standard.set(carsJson, forKey: kCarsKey)
    }

    Function("syncAuth") { (accessToken: String, refreshToken: String, expiresAt: Double) in
      let payload: [String: Any] = [
        "access_token": accessToken,
        "refresh_token": refreshToken,
        "expires_at": expiresAt,
      ]
      guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }

      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: kKeychainService,
        kSecAttrAccount as String: kKeychainAccount,
      ]
      SecItemDelete(query as CFDictionary)

      var add = query
      add[kSecValueData as String] = data
      // Readable while the device is locked (after the first post-boot unlock) so
      // the background App Intent can park from a locked pocket. ThisDeviceOnly =
      // never synced to iCloud Keychain.
      add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      SecItemAdd(add as CFDictionary, nil)
    }

    Function("clearAuth") {
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: kKeychainService,
        kSecAttrAccount as String: kKeychainAccount,
      ]
      SecItemDelete(query as CFDictionary)
    }

    // Returns the stored session JSON ({access_token, refresh_token, expires_at}) or
    // nil. Used by JS on launch to adopt tokens the background intent may have rotated.
    Function("readAuth") { () -> String? in
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: kKeychainService,
        kSecAttrAccount as String: kKeychainAccount,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
      ]
      var item: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
            let data = item as? Data else {
        return nil
      }
      return String(data: data, encoding: .utf8)
    }

    Function("requestNotifications") {
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }
  }
}
