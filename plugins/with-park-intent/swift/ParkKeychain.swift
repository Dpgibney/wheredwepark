import Foundation
import Security

struct SupabaseTokens {
  var accessToken: String
  var refreshToken: String
  var expiresAt: Double
}

// Reads/writes the same keychain item the JS bridge (ParkBridgeModule.swift) writes
// on sign-in. Same process + default access group, so no entitlement is required.
enum ParkKeychain {
  private static func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: ParkConfig.keychainService,
      kSecAttrAccount as String: ParkConfig.keychainAccount,
    ]
  }

  static func loadTokens() -> SupabaseTokens? {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
          let data = item as? Data,
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let access = json["access_token"] as? String,
          let refresh = json["refresh_token"] as? String else {
      return nil
    }
    let expiresAt = (json["expires_at"] as? Double) ?? 0
    return SupabaseTokens(accessToken: access, refreshToken: refresh, expiresAt: expiresAt)
  }

  static func saveTokens(_ tokens: SupabaseTokens) {
    let payload: [String: Any] = [
      "access_token": tokens.accessToken,
      "refresh_token": tokens.refreshToken,
      "expires_at": tokens.expiresAt,
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }

    SecItemDelete(baseQuery() as CFDictionary)

    var add = baseQuery()
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(add as CFDictionary, nil)
  }
}
