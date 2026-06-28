import AppIntents

// Auto-registers "Park My Car" in Siri, Spotlight, and the Shortcuts app. The
// \(.applicationName) token in each phrase is REQUIRED — without it the shortcut is
// silently dropped during indexing.
@available(iOS 16.0, *)
struct ParkCarShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: ParkCarIntent(),
      phrases: [
        "Park my car with \(.applicationName)",
        "Park my \(.applicationName) car",
      ],
      shortTitle: "Park My Car",
      systemImageName: "car.fill"
    )
  }
}
