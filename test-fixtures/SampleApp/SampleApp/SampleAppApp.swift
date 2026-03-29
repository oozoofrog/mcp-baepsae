import SwiftUI

@main
struct SampleAppApp: App {
    private var showsTabViewResearch: Bool {
        let processInfo = ProcessInfo.processInfo
        return processInfo.arguments.contains("--tabview-research")
            || processInfo.environment["BAEPSAE_SAMPLE_SCREEN"] == "tabview-research"
    }

    var body: some Scene {
        WindowGroup {
            if showsTabViewResearch {
                TabViewOnlyResearchView()
            } else {
                ContentView()
            }
        }
    }
}
