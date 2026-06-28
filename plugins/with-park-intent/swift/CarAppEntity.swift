import AppIntents
import Foundation

// A car the user can park. Options come from the cached [{id,name}] list the JS app
// writes to UserDefaults after every fetch (parkBridge.syncCars).
@available(iOS 16.0, *)
struct CarAppEntity: AppEntity, Identifiable {
  let id: String
  let name: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation { "Car" }
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }

  static var defaultQuery = CarQuery()
}

@available(iOS 16.0, *)
struct CarQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [CarAppEntity] {
    let all = Self.cachedCars()
    return all.filter { identifiers.contains($0.id) }
  }

  func suggestedEntities() async throws -> [CarAppEntity] {
    Self.cachedCars()
  }

  // When the user has exactly one car, "Park my car" runs with no disambiguation.
  func defaultResult() async -> CarAppEntity? {
    let all = Self.cachedCars()
    return all.count == 1 ? all.first : nil
  }

  static func cachedCars() -> [CarAppEntity] {
    guard let json = UserDefaults.standard.string(forKey: ParkConfig.carsKey),
          let data = json.data(using: .utf8),
          let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
      return []
    }
    return array.compactMap { dict in
      guard let id = dict["id"] as? String, let name = dict["name"] as? String else { return nil }
      return CarAppEntity(id: id, name: name)
    }
  }
}
