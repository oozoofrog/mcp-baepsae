// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "baepsae-native",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "baepsae-native", targets: ["baepsae-native"]),
    ],
    targets: [
        .executableTarget(
            name: "baepsae-native",
            path: "Sources"
        ),
        .testTarget(
            name: "BaepsaeNativeTests",
            dependencies: [],
            path: "Tests/BaepsaeNativeTests"
        ),
    ]
)
