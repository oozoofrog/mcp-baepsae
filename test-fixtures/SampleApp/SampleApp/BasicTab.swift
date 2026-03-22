import SwiftUI

struct BasicTab: View {
    @State private var labelText = "Ready"
    @State private var inputText = ""
    @State private var visibleItems: Set<Int> = []

    var scrollPositionText: String {
        guard !visibleItems.isEmpty else { return "Visible: none" }
        let minItem = visibleItems.min()!
        let maxItem = visibleItems.max()!
        return "Visible: Item \(minItem) ~ Item \(maxItem)"
    }

    var body: some View {
        VStack(spacing: 16) {
            Text(labelText)
                .accessibilityIdentifier("test-label")

            TextField("Enter text", text: $inputText)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("test-input")

            Text(inputText)
                .accessibilityIdentifier("test-result")

            Button("Tap Me") {
                labelText = "Tapped!"
            }
            .accessibilityIdentifier("test-button")

            Text(scrollPositionText)
                .frame(maxWidth: .infinity, alignment: .leading)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("basic-scroll-position")

            List(0..<100, id: \.self) { index in
                Text("Item \(index)")
                    .onAppear { visibleItems.insert(index) }
                    .onDisappear { visibleItems.remove(index) }
            }
            .accessibilityIdentifier("test-list")
        }
        .padding()
    }
}
