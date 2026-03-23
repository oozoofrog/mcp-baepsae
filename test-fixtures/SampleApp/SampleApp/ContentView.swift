import SwiftUI

private enum SampleTab: Hashable {
    case basic
    case scroll
    case drag
}

struct ContentView: View {
    @State private var selectedTab: SampleTab = .basic

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Button("Basic") { selectedTab = .basic }
                    .accessibilityIdentifier("nav-basic")

                Button("Scroll") { selectedTab = .scroll }
                    .accessibilityIdentifier("nav-scroll")

                Button("Drag") { selectedTab = .drag }
                    .accessibilityIdentifier("nav-drag")
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal)

            TabView(selection: $selectedTab) {
                BasicTab()
                    .tabItem {
                        Label("Basic", systemImage: "square.grid.2x2")
                    }
                    .tag(SampleTab.basic)

                ScrollTab()
                    .tabItem {
                        Label("Scroll", systemImage: "list.bullet")
                    }
                    .tag(SampleTab.scroll)

                DragDropTab()
                    .tabItem {
                        Label("Drag", systemImage: "hand.draw")
                    }
                    .tag(SampleTab.drag)
            }
        }
    }
}
