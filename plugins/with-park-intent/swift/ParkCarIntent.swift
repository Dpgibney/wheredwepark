import AppIntents
import Foundation

// Saves the current location as where the given car is parked. Runs in the background
// (openAppWhenRun = false) so NFC / Bluetooth-disconnect automations and Siri can park
// even while the phone is locked.
@available(iOS 16.0, *)
struct ParkCarIntent: AppIntent {
  static var title: LocalizedStringResource = "Park My Car"
  static var description = IntentDescription("Saves your current location as where you parked.")
  static var openAppWhenRun = false

  @Parameter(title: "Car")
  var car: CarAppEntity

  init() {}

  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard let location = await OneShotLocation().current(timeout: 8) else {
      ParkNotifications.notify(
        title: "Couldn't park \(car.name)",
        body: "No location available. Open the app to save it manually."
      )
      throw ParkError.requestFailed
    }

    do {
      try await SupabaseParkClient.park(
        carId: car.id,
        latitude: location.coordinate.latitude,
        longitude: location.coordinate.longitude
      )
    } catch {
      let message: String
      if let parkError = error as? ParkError {
        message = String(localized: parkError.localizedStringResource)
      } else {
        message = "Something went wrong. Open the app to try again."
      }
      ParkNotifications.notify(title: "Couldn't park \(car.name)", body: message)
      throw error
    }

    ParkNotifications.notify(title: "Parked \(car.name)", body: savedAtSubtitle())
    return .result(dialog: "Parked \(car.name).")
  }

  private func savedAtSubtitle() -> String {
    let formatter = DateFormatter()
    formatter.timeStyle = .short
    formatter.dateStyle = .none
    return "Saved at \(formatter.string(from: Date()))"
  }
}
