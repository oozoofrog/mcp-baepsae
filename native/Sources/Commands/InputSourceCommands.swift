import AppKit
import Carbon
import Foundation

private func getInputSourceProperty(_ source: TISInputSource, _ key: CFString) -> AnyObject? {
    guard let cfType = TISGetInputSourceProperty(source, key) else { return nil }
    return Unmanaged<AnyObject>.fromOpaque(cfType).takeUnretainedValue()
}

private func isCJKV(_ source: TISInputSource) -> Bool {
    guard let languages = getInputSourceProperty(source, kTISPropertyInputSourceLanguages) as? [String],
          let lang = languages.first else { return false }
    return ["ko", "ja", "zh", "vi"].contains(lang)
}

private func selectableKeyboardSources() -> [TISInputSource] {
    let sourceList = TISCreateInputSourceList(nil, false)
        .takeRetainedValue() as NSArray as! [TISInputSource]
    return sourceList.filter {
        let category = getInputSourceProperty($0, kTISPropertyInputSourceCategory) as? String
        let isSelectable = getInputSourceProperty($0, kTISPropertyInputSourceIsSelectCapable) as? Bool
        return category == (kTISCategoryKeyboardInputSource as String) && isSelectable == true
    }
}

func handleListInputSources(_ parsed: ParsedOptions) throws -> Int32 {
    let sources = selectableKeyboardSources()
    for source in sources {
        let id = getInputSourceProperty(source, kTISPropertyInputSourceID) as? String ?? ""
        let name = getInputSourceProperty(source, kTISPropertyLocalizedName) as? String ?? ""
        let isSelected = (getInputSourceProperty(source, kTISPropertyInputSourceIsSelected) as? Bool) == true
        print("\(id) | \(name) | \(isSelected ? "active" : "")")
    }
    return 0
}

func handleInputSource(_ parsed: ParsedOptions) throws -> Int32 {
    // No arguments: query current input source
    guard let targetId = parsed.positionals.first else {
        let current = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
        let id = getInputSourceProperty(current, kTISPropertyInputSourceID) as? String ?? ""
        let name = getInputSourceProperty(current, kTISPropertyLocalizedName) as? String ?? ""
        print("\(id) | \(name)")
        return 0
    }

    // Find target source
    let sources = selectableKeyboardSources()
    guard let target = sources.first(where: {
        (getInputSourceProperty($0, kTISPropertyInputSourceID) as? String) == targetId
    }) else {
        let available = sources.compactMap { getInputSourceProperty($0, kTISPropertyInputSourceID) as? String }
        throw NativeError.commandFailed("Input source not found: \(targetId). Available: \(available.joined(separator: ", "))")
    }

    // CJKV workaround: double-switch via ABC/US first
    if isCJKV(target) {
        if let abc = sources.first(where: {
            let id = getInputSourceProperty($0, kTISPropertyInputSourceID) as? String ?? ""
            return id.contains("ABC") || id.contains(".US")
        }) {
            TISSelectInputSource(abc)
            usleep(100_000) // 100ms
        }
    }

    TISSelectInputSource(target)
    usleep(100_000)

    // Verify switch
    let current = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
    let currentId = getInputSourceProperty(current, kTISPropertyInputSourceID) as? String ?? ""
    if currentId == targetId {
        print("Switched to: \(targetId)")
    } else {
        fputs("Warning: requested \(targetId) but current is \(currentId)\n", stderr)
        print("Switched to: \(currentId) (requested: \(targetId))")
    }
    return 0
}
