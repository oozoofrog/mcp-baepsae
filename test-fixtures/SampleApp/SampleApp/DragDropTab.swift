import SwiftUI

struct DragDropTab: View {
    @State private var droppedItem = ""
    @State private var dropZoneGlobalFrame: CGRect = .zero

    var body: some View {
        VStack(spacing: 20) {
            Text("Drag items to the drop zone")
                .font(.headline)
                .padding(.top)

            ForEach(0..<3) { i in
                DraggableRow(
                    index: i,
                    dropZoneFrame: dropZoneGlobalFrame,
                    onDropped: { label in droppedItem = label }
                )
            }

            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.green.opacity(0.2))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.green, lineWidth: 2)
                    )
                Text("Drop Zone")
                    .foregroundColor(.green)
                    .font(.headline)
            }
            .frame(height: 100)
            .accessibilityIdentifier("drop-zone")
            .background(
                GeometryReader { geo in
                    Color.clear.onAppear {
                        dropZoneGlobalFrame = geo.frame(in: .global)
                    }
                }
            )

            Text(droppedItem.isEmpty ? "No item dropped" : "Dropped: \(droppedItem)")
                .padding()
                .accessibilityIdentifier("drop-result")

            Spacer()
        }
        .padding(.horizontal)
    }
}

struct DraggableRow: View {
    let index: Int
    let dropZoneFrame: CGRect
    let onDropped: (String) -> Void

    @State private var dragOffset: CGSize = .zero
    @State private var isDragging = false

    var body: some View {
        Text("Item \(index)")
            .frame(maxWidth: .infinity)
            .padding()
            .background(isDragging ? Color.blue.opacity(0.5) : Color.blue.opacity(0.2))
            .cornerRadius(8)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.blue, lineWidth: 1)
            )
            .offset(dragOffset)
            .accessibilityIdentifier("drag-item-\(index)")
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .global)
                    .onChanged { value in
                        dragOffset = value.translation
                        isDragging = true
                    }
                    .onEnded { value in
                        if dropZoneFrame.contains(value.location) {
                            onDropped("Item \(index)")
                        }
                        withAnimation(.spring(response: 0.3)) {
                            dragOffset = .zero
                        }
                        isDragging = false
                    }
            )
    }
}
