import Foundation
import AppIntents

@available(iOS 16.0, *)
enum ParkError: Error, CustomLocalizedStringResourceConvertible {
  case noConfig
  case notSignedIn
  case requestFailed

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .noConfig: return "App isn't set up yet. Open the app once and try again."
    case .notSignedIn: return "You're not signed in. Open the app and sign in."
    case .requestFailed: return "Couldn't save your parking spot. Try again."
    }
  }
}

// Thin raw-PostgREST mirror of lib/parking.ts upsertParkingLocation(). Keep the body
// and headers in sync with that file. Reads config from UserDefaults and tokens from
// the keychain (both written by the JS bridge), refreshing the access token if needed.
@available(iOS 16.0, *)
enum SupabaseParkClient {
  static func park(carId: String, latitude: Double, longitude: Double) async throws {
    let defaults = UserDefaults.standard
    guard let urlString = defaults.string(forKey: ParkConfig.supabaseUrlKey),
          let anonKey = defaults.string(forKey: ParkConfig.supabaseAnonKey),
          let baseURL = URL(string: urlString) else {
      throw ParkError.noConfig
    }

    guard var tokens = ParkKeychain.loadTokens() else {
      throw ParkError.notSignedIn
    }

    // Refresh if the access token is expired or about to expire.
    if tokens.expiresAt > 0, Date().timeIntervalSince1970 > tokens.expiresAt - 60 {
      tokens = try await refresh(baseURL: baseURL, anonKey: anonKey, refreshToken: tokens.refreshToken)
    }

    guard let userId = jwtSubject(tokens.accessToken) else {
      throw ParkError.requestFailed
    }

    let endpoint = baseURL
      .appendingPathComponent("rest/v1/parking_locations")
      .appending(queryItems: [URLQueryItem(name: "on_conflict", value: "car_id")])

    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue(anonKey, forHTTPHeaderField: "apikey")
    request.setValue("Bearer \(tokens.accessToken)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("resolution=merge-duplicates", forHTTPHeaderField: "Prefer")

    let body: [String: Any] = [
      "car_id": carId,
      "latitude": latitude,
      "longitude": longitude,
      "updated_by_user_id": userId,
      "updated_at": iso8601(Date()),
    ]
    request.httpBody = try JSONSerialization.data(withJSONObject: body)

    let (_, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw ParkError.requestFailed
    }
  }

  private static func refresh(baseURL: URL, anonKey: String, refreshToken: String) async throws -> SupabaseTokens {
    let endpoint = baseURL
      .appendingPathComponent("auth/v1/token")
      .appending(queryItems: [URLQueryItem(name: "grant_type", value: "refresh_token")])

    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue(anonKey, forHTTPHeaderField: "apikey")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let access = json["access_token"] as? String,
          let refresh = json["refresh_token"] as? String else {
      throw ParkError.notSignedIn
    }

    let expiresAt: Double
    if let value = json["expires_at"] as? Double {
      expiresAt = value
    } else if let expiresIn = json["expires_in"] as? Double {
      expiresAt = Date().timeIntervalSince1970 + expiresIn
    } else {
      expiresAt = 0
    }

    let tokens = SupabaseTokens(accessToken: access, refreshToken: refresh, expiresAt: expiresAt)
    ParkKeychain.saveTokens(tokens) // persist rotated refresh token
    return tokens
  }

  // Decodes the `sub` (user id) claim from the JWT payload — no signature check needed,
  // RLS enforces auth server-side via the Bearer token.
  private static func jwtSubject(_ jwt: String) -> String? {
    let parts = jwt.split(separator: ".")
    guard parts.count == 3 else { return nil }

    var base64 = String(parts[1])
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    while base64.count % 4 != 0 { base64 += "=" }

    guard let data = Data(base64Encoded: base64),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return nil
    }
    return json["sub"] as? String
  }

  private static func iso8601(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
  }
}
