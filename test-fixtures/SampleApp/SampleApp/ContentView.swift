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

private enum TabViewResearchTab: Hashable {
    case home
    case scroll
    case form
    case state
}

struct TabViewOnlyResearchView: View {
    @State private var selectedTab: TabViewResearchTab = .home

    var body: some View {
        TabView(selection: $selectedTab) {
            ResearchHomeTab()
                .tabItem {
                    Label("Home", systemImage: "house")
                }
                .tag(TabViewResearchTab.home)

            ResearchScrollTab()
                .tabItem {
                    Label("Scroll", systemImage: "list.bullet")
                }
                .tag(TabViewResearchTab.scroll)

            ResearchFormTab()
                .tabItem {
                    Label("Form", systemImage: "square.and.pencil")
                }
                .tag(TabViewResearchTab.form)

            ResearchStateTab()
                .tabItem {
                    Label("State", systemImage: "switch.2")
                }
                .tag(TabViewResearchTab.state)
        }
    }
}

private struct ResearchHomeTab: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("Research Home")
                .font(.title2)
                .accessibilityIdentifier("research-home-anchor")

            Text("Pure TabView fixture")
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("research-home-subtitle")
        }
        .padding()
    }
}

private struct ResearchScrollTab: View {
    @State private var visibleItems: Set<Int> = []

    private var scrollPositionText: String {
        guard !visibleItems.isEmpty else { return "Visible: none" }
        let minItem = visibleItems.min()!
        let maxItem = visibleItems.max()!
        return "Visible: Item \(minItem) ~ Item \(maxItem)"
    }

    var body: some View {
        VStack(spacing: 0) {
            Text("Research Scroll")
                .font(.headline)
                .padding(.top)
                .accessibilityIdentifier("research-scroll-anchor")

            Text(scrollPositionText)
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color(uiColor: .systemGray6))
                .accessibilityIdentifier("research-scroll-position")

            List(0..<100, id: \.self) { index in
                Text("Research Item \(index)")
                    .onAppear { visibleItems.insert(index) }
                    .onDisappear { visibleItems.remove(index) }
            }
            .accessibilityIdentifier("research-scroll-list")
        }
    }
}

private struct ResearchFormTab: View {
    @State private var inputText = ""

    var body: some View {
        VStack(spacing: 16) {
            Text("Research Form")
                .font(.headline)
                .accessibilityIdentifier("research-form-anchor")

            TextField("Enter research text", text: $inputText)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("research-form-input")

            Text(inputText.isEmpty ? "Empty" : inputText)
                .accessibilityIdentifier("research-form-result")
        }
        .padding()
    }
}

private struct ResearchStateTab: View {
    @State private var isEnabled = false

    var body: some View {
        VStack(spacing: 16) {
            Text("Research State")
                .font(.headline)
                .accessibilityIdentifier("research-state-anchor")

            Toggle("Enable research mode", isOn: $isEnabled)
                .accessibilityIdentifier("research-state-toggle")

            Text(isEnabled ? "Enabled" : "Disabled")
                .accessibilityIdentifier("research-state-value")
        }
        .padding()
    }
}
