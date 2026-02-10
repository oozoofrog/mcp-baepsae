import XCTest
import Foundation

/// Tests that invoke the compiled `baepsae-native` binary as a subprocess
/// and verify stdout/stderr output and exit codes.
///
/// These tests focus on argument parsing, help output, and error handling
/// rather than actual UI automation (which requires accessibility permissions
/// and running applications).
final class BinaryInvocationTests: XCTestCase {

    // MARK: - Helpers

    struct ProcessResult {
        let exitCode: Int32
        let stdout: String
        let stderr: String
    }

    /// Returns the path to the built products directory.
    private static func productsDirectory() -> URL {
        #if os(macOS)
        for bundle in Bundle.allBundles where bundle.bundlePath.hasSuffix(".xctest") {
            return bundle.bundleURL.deletingLastPathComponent()
        }
        #endif
        return Bundle.main.bundleURL
    }

    /// Resolves the path to the compiled `baepsae-native` binary.
    /// SPM places it in the same build directory as the test runner.
    private static func resolveBinaryPath() -> String {
        let buildDir = productsDirectory()
        let path = buildDir.appendingPathComponent("baepsae-native").path
        guard FileManager.default.isExecutableFile(atPath: path) else {
            fatalError(
                "baepsae-native binary not found at \(path). "
                + "Run `swift build --package-path native` first."
            )
        }
        return path
    }

    /// Runs the binary with the given arguments and captures output.
    private func execute(_ arguments: [String] = []) throws -> ProcessResult {
        let binaryPath = Self.resolveBinaryPath()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: binaryPath)
        process.arguments = arguments

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        try process.run()
        process.waitUntilExit()

        let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()

        return ProcessResult(
            exitCode: process.terminationStatus,
            stdout: String(data: stdoutData, encoding: .utf8) ?? "",
            stderr: String(data: stderrData, encoding: .utf8) ?? ""
        )
    }

    // MARK: - Help & Version Tests

    func testNoArguments_printsHelp() throws {
        let result = try execute()
        XCTAssertEqual(result.exitCode, 0, "No arguments should exit with 0 (shows help)")
        XCTAssertTrue(result.stdout.contains("baepsae-native"), "Help output should contain binary name")
        XCTAssertTrue(result.stdout.contains("Usage:"), "Help output should contain 'Usage:'")
    }

    func testHelpCommand() throws {
        let result = try execute(["help"])
        XCTAssertEqual(result.exitCode, 0)
        XCTAssertTrue(result.stdout.contains("baepsae-native"))
        XCTAssertTrue(result.stdout.contains("Usage:"))
        XCTAssertTrue(result.stdout.contains("describe-ui"))
        XCTAssertTrue(result.stdout.contains("screenshot"))
    }

    func testDashDashHelp() throws {
        let result = try execute(["--help"])
        XCTAssertEqual(result.exitCode, 0)
        XCTAssertTrue(result.stdout.contains("Usage:"))
    }

    func testDashH() throws {
        let result = try execute(["-h"])
        XCTAssertEqual(result.exitCode, 0)
        XCTAssertTrue(result.stdout.contains("Usage:"))
    }

    func testVersionCommand() throws {
        let result = try execute(["--version"])
        XCTAssertEqual(result.exitCode, 0)
        XCTAssertTrue(
            result.stdout.contains("baepsae-native"),
            "Version output should contain binary name"
        )
        // Version string should match a pattern like "X.Y.Z"
        let versionPattern = #"\d+\.\d+\.\d+"#
        XCTAssertTrue(
            result.stdout.range(of: versionPattern, options: .regularExpression) != nil,
            "Version output should contain a semver version number, got: \(result.stdout)"
        )
    }

    // MARK: - Unknown Command Tests

    func testUnknownCommand_exitsWithError() throws {
        let result = try execute(["nonexistent-command"])
        XCTAssertNotEqual(result.exitCode, 0, "Unknown command should exit with non-zero status")
        XCTAssertTrue(
            result.stderr.contains("Unknown command"),
            "stderr should mention 'Unknown command', got: \(result.stderr)"
        )
    }

    func testUnknownCommand_showsCommandName() throws {
        let result = try execute(["foobar"])
        XCTAssertTrue(
            result.stderr.contains("foobar"),
            "Error message should include the unknown command name"
        )
    }

    // MARK: - Argument Validation Tests

    func testScreenshot_missingUdid() throws {
        let result = try execute(["screenshot"])
        XCTAssertNotEqual(result.exitCode, 0, "screenshot without --udid should fail")
        XCTAssertTrue(
            result.stderr.contains("--udid"),
            "Error should mention missing --udid option, got: \(result.stderr)"
        )
    }

    func testRecordVideo_missingUdid() throws {
        let result = try execute(["record-video"])
        XCTAssertNotEqual(result.exitCode, 0, "record-video without --udid should fail")
        XCTAssertTrue(
            result.stderr.contains("--udid"),
            "Error should mention missing --udid option, got: \(result.stderr)"
        )
    }

    func testTap_missingTarget() throws {
        let result = try execute(["tap"])
        XCTAssertNotEqual(result.exitCode, 0, "tap without target should fail")
        XCTAssertTrue(
            result.stderr.lowercased().contains("target") || result.stderr.contains("--udid"),
            "Error should mention missing target, got: \(result.stderr)"
        )
    }

    func testDescribeUi_missingTarget() throws {
        let result = try execute(["describe-ui"])
        XCTAssertNotEqual(result.exitCode, 0, "describe-ui without target should fail")
    }

    func testSearchUi_missingTarget() throws {
        let result = try execute(["search-ui"])
        XCTAssertNotEqual(result.exitCode, 0, "search-ui without target should fail")
    }

    func testType_missingTarget() throws {
        let result = try execute(["type"])
        XCTAssertNotEqual(result.exitCode, 0, "type without target should fail")
    }

    func testSwipe_missingTarget() throws {
        let result = try execute(["swipe"])
        XCTAssertNotEqual(result.exitCode, 0, "swipe without target should fail")
    }

    func testButton_missingTarget() throws {
        let result = try execute(["button"])
        XCTAssertNotEqual(result.exitCode, 0, "button without target should fail")
    }

    func testKey_missingTarget() throws {
        let result = try execute(["key"])
        XCTAssertNotEqual(result.exitCode, 0, "key without target should fail")
    }

    func testKeySequence_missingTarget() throws {
        let result = try execute(["key-sequence"])
        XCTAssertNotEqual(result.exitCode, 0, "key-sequence without target should fail")
    }

    func testKeyCombo_missingTarget() throws {
        let result = try execute(["key-combo"])
        XCTAssertNotEqual(result.exitCode, 0, "key-combo without target should fail")
    }

    func testTouch_missingTarget() throws {
        let result = try execute(["touch"])
        XCTAssertNotEqual(result.exitCode, 0, "touch without target should fail")
    }

    func testGesture_missingTarget() throws {
        let result = try execute(["gesture"])
        XCTAssertNotEqual(result.exitCode, 0, "gesture without target should fail")
    }

    func testRightClick_missingTarget() throws {
        let result = try execute(["right-click"])
        XCTAssertNotEqual(result.exitCode, 0, "right-click without target should fail")
    }

    func testScroll_missingTarget() throws {
        let result = try execute(["scroll"])
        XCTAssertNotEqual(result.exitCode, 0, "scroll without target should fail")
    }

    func testDragDrop_missingTarget() throws {
        let result = try execute(["drag-drop"])
        XCTAssertNotEqual(result.exitCode, 0, "drag-drop without target should fail")
    }

    func testMenuAction_missingTarget() throws {
        let result = try execute(["menu-action"])
        XCTAssertNotEqual(result.exitCode, 0, "menu-action without target should fail")
    }

    func testClipboard_missingFlag() throws {
        let result = try execute(["clipboard"])
        XCTAssertNotEqual(result.exitCode, 0, "clipboard without --read or --write should fail")
        XCTAssertTrue(
            result.stderr.contains("--read") || result.stderr.contains("--write"),
            "Error should mention --read or --write, got: \(result.stderr)"
        )
    }

    func testActivateApp_missingTarget() throws {
        let result = try execute(["activate-app"])
        XCTAssertNotEqual(result.exitCode, 0, "activate-app without target should fail")
    }

    func testListWindows_missingTarget() throws {
        let result = try execute(["list-windows"])
        XCTAssertNotEqual(result.exitCode, 0, "list-windows without target should fail")
    }

    func testScreenshotApp_missingTarget() throws {
        let result = try execute(["screenshot-app"])
        XCTAssertNotEqual(result.exitCode, 0, "screenshot-app without target should fail")
    }

    // MARK: - Target Conflict Tests

    func testConflictingTargets_udidAndBundleId() throws {
        let result = try execute([
            "describe-ui",
            "--udid", "FAKE-UDID",
            "--bundle-id", "com.example.app",
        ])
        XCTAssertNotEqual(result.exitCode, 0, "Using both --udid and --bundle-id should fail")
        XCTAssertTrue(
            result.stderr.contains("Cannot use --udid with --bundle-id"),
            "Error should explain the conflict, got: \(result.stderr)"
        )
    }

    func testConflictingTargets_udidAndAppName() throws {
        let result = try execute([
            "tap",
            "--udid", "FAKE-UDID",
            "--app-name", "Finder",
        ])
        XCTAssertNotEqual(result.exitCode, 0, "Using both --udid and --app-name should fail")
        XCTAssertTrue(
            result.stderr.contains("Cannot use --udid with"),
            "Error should explain the conflict, got: \(result.stderr)"
        )
    }

    func testConflictingTargets_bundleIdAndAppName() throws {
        let result = try execute([
            "describe-ui",
            "--bundle-id", "com.example.app",
            "--app-name", "SomeApp",
        ])
        XCTAssertNotEqual(result.exitCode, 0, "Using both --bundle-id and --app-name should fail")
        XCTAssertTrue(
            result.stderr.contains("Cannot use both --bundle-id and --app-name"),
            "Error should explain the conflict, got: \(result.stderr)"
        )
    }

    // MARK: - Specific Command Argument Validation

    func testSwipe_missingCoordinates() throws {
        // Provide a target but missing required coordinates
        let result = try execute([
            "swipe",
            "--udid", "FAKE-UDID",
            "--start-x", "10",
            // Missing --start-y, --end-x, --end-y
        ])
        XCTAssertNotEqual(result.exitCode, 0, "swipe with missing coordinates should fail")
    }

    func testKeySequence_missingKeycodes() throws {
        let result = try execute([
            "key-sequence",
            "--udid", "FAKE-UDID",
        ])
        XCTAssertNotEqual(result.exitCode, 0, "key-sequence without --keycodes should fail")
        XCTAssertTrue(
            result.stderr.contains("--keycodes"),
            "Error should mention missing --keycodes, got: \(result.stderr)"
        )
    }

    func testKeyCombo_missingModifiersAndKey() throws {
        let result = try execute([
            "key-combo",
            "--udid", "FAKE-UDID",
        ])
        XCTAssertNotEqual(result.exitCode, 0, "key-combo without --modifiers/--key should fail")
        XCTAssertTrue(
            result.stderr.contains("--modifiers") || result.stderr.contains("--key"),
            "Error should mention missing options, got: \(result.stderr)"
        )
    }

    func testScroll_missingDeltas() throws {
        let result = try execute([
            "scroll",
            "--udid", "FAKE-UDID",
        ])
        XCTAssertNotEqual(result.exitCode, 0, "scroll without deltas should fail")
        XCTAssertTrue(
            result.stderr.contains("--delta"),
            "Error should mention missing delta options, got: \(result.stderr)"
        )
    }

    // MARK: - Commands That May Succeed Without Simulator

    func testListApps_succeeds() throws {
        let result = try execute(["list-apps"])
        XCTAssertEqual(result.exitCode, 0, "list-apps should succeed (lists macOS running apps)")
        // Output format: "bundleId | name | pid" per line
        // There should be at least one running app (the test runner or Finder)
        let lines = result.stdout.components(separatedBy: "\n").filter { !$0.isEmpty }
        XCTAssertGreaterThan(lines.count, 0, "list-apps should show at least one running app")
        // Verify output format: each line should contain pipe separators
        if let firstLine = lines.first {
            XCTAssertTrue(
                firstLine.contains("|"),
                "list-apps output should use pipe separator, got: \(firstLine)"
            )
        }
    }

    func testGetFocusedApp_succeeds() throws {
        let result = try execute(["get-focused-app"])
        XCTAssertEqual(result.exitCode, 0, "get-focused-app should succeed")
        // Output format: "bundleId | name | pid"
        XCTAssertTrue(
            result.stdout.contains("|"),
            "get-focused-app output should use pipe separator, got: \(result.stdout)"
        )
    }

    func testClipboard_readSucceeds() throws {
        let result = try execute(["clipboard", "--read"])
        // clipboard --read should always succeed (exit 0), even if clipboard is empty
        XCTAssertEqual(result.exitCode, 0, "clipboard --read should succeed")
    }

    func testClipboard_writeAndRead() throws {
        let testString = "baepsae-test-\(UUID().uuidString)"
        let writeResult = try execute(["clipboard", "--write", testString])
        XCTAssertEqual(writeResult.exitCode, 0, "clipboard --write should succeed")
        XCTAssertTrue(
            writeResult.stdout.contains("Clipboard updated"),
            "clipboard --write should confirm update"
        )

        let readResult = try execute(["clipboard", "--read"])
        XCTAssertEqual(readResult.exitCode, 0)
        XCTAssertTrue(
            readResult.stdout.contains(testString),
            "clipboard --read should return the written text, got: \(readResult.stdout)"
        )
    }

    // MARK: - Help Content Completeness

    func testHelpMentionsAllMajorCommands() throws {
        let result = try execute(["help"])
        let expectedCommands = [
            "list-simulators",
            "list-apps",
            "describe-ui",
            "search-ui",
            "screenshot",
            "record-video",
            "tap",
            "type",
            "swipe",
            "button",
            "key-sequence",
            "key-combo",
            "touch",
            "gesture",
            "stream-video",
            "list-windows",
            "activate-app",
            "screenshot-app",
            "right-click",
            "scroll",
            "drag-drop",
            "menu-action",
            "get-focused-app",
            "clipboard",
        ]
        for command in expectedCommands {
            XCTAssertTrue(
                result.stdout.contains(command),
                "Help output should mention command '\(command)'"
            )
        }
    }

    func testHelpMentionsTargetOptions() throws {
        let result = try execute(["help"])
        XCTAssertTrue(result.stdout.contains("--udid"), "Help should mention --udid")
        XCTAssertTrue(result.stdout.contains("--bundle-id"), "Help should mention --bundle-id")
        XCTAssertTrue(result.stdout.contains("--app-name"), "Help should mention --app-name")
    }

    // MARK: - Non-existent Bundle ID / App Name

    func testDescribeUi_nonExistentBundleId() throws {
        let result = try execute([
            "describe-ui",
            "--bundle-id", "com.nonexistent.app.that.does.not.exist",
        ])
        XCTAssertNotEqual(result.exitCode, 0, "Non-existent bundle ID should fail")
        XCTAssertTrue(
            result.stderr.contains("No running application found"),
            "Error should say no app found, got: \(result.stderr)"
        )
    }

    func testTap_nonExistentAppName() throws {
        let result = try execute([
            "tap",
            "--app-name", "ThisAppDefinitelyDoesNotExist12345",
            "-x", "100",
            "-y", "100",
        ])
        XCTAssertNotEqual(result.exitCode, 0, "Non-existent app name should fail")
        XCTAssertTrue(
            result.stderr.contains("No running application found"),
            "Error should say no app found, got: \(result.stderr)"
        )
    }
}
