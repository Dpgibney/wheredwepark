import Foundation
import UserNotifications

// Local notification confirming (or reporting failure of) a hands-free park.
// Permission is requested from the foreground app via ParkBridge.requestNotifications().
enum ParkNotifications {
  static func notify(title: String, body: String) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    let request = UNNotificationRequest(
      identifier: UUID().uuidString,
      content: content,
      trigger: nil // deliver immediately
    )
    UNUserNotificationCenter.current().add(request)
  }
}
