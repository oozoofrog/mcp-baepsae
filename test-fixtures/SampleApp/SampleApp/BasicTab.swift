import SwiftUI

struct BasicTab: View {
    @State private var labelText = "Ready"
    @State private var inputText = ""

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

            List(0..<20, id: \.self) { index in
                Text("Item \(index)")
            }
            .accessibilityIdentifier("test-list")
        }
        .padding()
    }
}
