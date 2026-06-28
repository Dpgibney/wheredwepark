import Foundation

// Shared storage keys/identifiers. These MUST match the values the JS bridge writes
// in modules/park-bridge/ios/ParkBridgeModule.swift. The App Intent runs in the same
// app process, so UserDefaults.standard and the default keychain access group are
// shared — no App Group or keychain-sharing entitlement needed.
enum ParkConfig {
  static let supabaseUrlKey = "park.supabaseUrl"
  static let supabaseAnonKey = "park.supabaseAnonKey"
  static let carsKey = "park.cars"
  static let keychainService = "park.supabase.session"
  static let keychainAccount = "session"
}
