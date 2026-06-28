import CoreLocation

// One-shot location fix that also works from a background App Intent while the
// device is locked. Relies on the When-In-Use grant the app already requests via
// expo-location, plus UIBackgroundModes:["location"] and (iOS 17+) a
// CLBackgroundActivitySession. Authorization is NOT requested here — a background
// intent can't present the prompt.
@available(iOS 16.0, *)
final class OneShotLocation: NSObject, CLLocationManagerDelegate {
  private var manager: CLLocationManager?
  private var continuation: CheckedContinuation<CLLocation?, Never>?
  private var backgroundSession: Any?
  private var timeoutTask: Task<Void, Never>?

  func current(timeout: TimeInterval = 8) async -> CLLocation? {
    await withCheckedContinuation { (cont: CheckedContinuation<CLLocation?, Never>) in
      self.continuation = cont

      DispatchQueue.main.async {
        let mgr = CLLocationManager()
        mgr.delegate = self
        mgr.desiredAccuracy = kCLLocationAccuracyBest
        self.manager = mgr
        if #available(iOS 17.0, *) {
          // Holds a background location session so a fix is delivered while locked.
          self.backgroundSession = CLBackgroundActivitySession()
        }
        mgr.requestLocation()
      }

      self.timeoutTask = Task { [weak self] in
        try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
        self?.finish(nil)
      }
    }
  }

  private func finish(_ location: CLLocation?) {
    DispatchQueue.main.async {
      guard let cont = self.continuation else { return } // resume exactly once
      self.continuation = nil
      self.timeoutTask?.cancel()
      self.timeoutTask = nil
      if #available(iOS 17.0, *) {
        (self.backgroundSession as? CLBackgroundActivitySession)?.invalidate()
        self.backgroundSession = nil
      }
      self.manager?.delegate = nil
      self.manager = nil
      cont.resume(returning: location)
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    finish(locations.last)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    finish(nil)
  }
}
