import SwiftUI

struct ScrollTab: View {
    @State private var visibleItems: Set<Int> = []

    var scrollPositionText: String {
        guard !visibleItems.isEmpty else { return "Visible: none" }
        let minItem = visibleItems.min()!
        let maxItem = visibleItems.max()!
        return "Visible: Item \(minItem) ~ Item \(maxItem)"
    }

    var body: some View {
        VStack(spacing: 0) {
            Text(scrollPositionText)
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color(uiColor: .systemGray6))
                .accessibilityIdentifier("scroll-position")

            List(0..<100, id: \.self) { i in
                Text("Item \(i)")
                    .onAppear { visibleItems.insert(i) }
                    .onDisappear { visibleItems.remove(i) }
            }
            .accessibilityIdentifier("scroll-list")
        }
    }
}
