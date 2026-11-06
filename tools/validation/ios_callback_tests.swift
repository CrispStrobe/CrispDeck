import XCTest

// This standalone runner operates the installed simulator app. It neither
// launches a replacement process nor bypasses the system's URL handler choice.
final class CallbackTests: XCTestCase {
    @MainActor
    func testSystemCallbacksReturnToRunningApp() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.christianstrobele.crispdeck")
        XCTAssertNotEqual(app.state, .notRunning, "The original app must still be running")
        // The app is already running. Opening each URL must itself bring it
        // to the foreground; an extra activate() can wait indefinitely for
        // WKWebView idleness and does not exercise the callback mechanism.
        let callbacks = [
            "app.vercel.crispdeck:/oauth/callback?state=ci-native-smoke",
            "app.vercel.crispdeck://oauth/mastodon?state=ci-native-smoke"
        ]
        for callback in callbacks {
            XCUIDevice.shared.system.open(try XCTUnwrap(URL(string: callback)))
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let alert = springboard.alerts.firstMatch
            if alert.waitForExistence(timeout: 3) {
                XCTAssertTrue(alert.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "CrispDeck")).firstMatch.exists,
                              "Only the expected CrispDeck confirmation may be accepted")
                let open = alert.buttons["Open"]
                XCTAssertTrue(open.exists)
                open.tap()
            }
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
            XCTAssertFalse(springboard.alerts.firstMatch.exists, "Callback confirmation must be completed")
        }
    }
}
