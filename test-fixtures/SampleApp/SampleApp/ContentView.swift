import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            BasicTab()
                .tabItem {
                    Label("Basic", systemImage: "square.grid.2x2")
                }

            ScrollTab()
                .tabItem {
                    Label("Scroll", systemImage: "list.bullet")
                }

            DragDropTab()
                .tabItem {
                    Label("Drag", systemImage: "hand.draw")
                }
        }
    }
}
