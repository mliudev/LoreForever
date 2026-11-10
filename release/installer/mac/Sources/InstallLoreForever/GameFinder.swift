import Foundation

// World of Warcraft: Forever on this Mac: where Battle.net puts it, what its agent's database names, then each mounted
// disk, the same places Willo looks (companion/lore_companion/paths.py). It only checks whether known paths exist and
// never lists a folder's contents: listing inside an external disk would make macOS ask for permission.
struct GameFolder: Hashable {
    let root: URL         // the World of Warcraft folder
    let flavor: String    // _forever_ (the beta's _classic_beta_ if there's no _forever_)
    var addOns: URL { root.appendingPathComponent(flavor).appendingPathComponent("Interface/AddOns") }
    var stage: URL { root.appendingPathComponent(".lf-download-stage") }
}

let FLAVORS = ["_forever_", "_classic_beta_"]
private let WOW = "World of Warcraft"

func isDir(_ url: URL) -> Bool {
    var dir: ObjCBool = false
    return FileManager.default.fileExists(atPath: url.path, isDirectory: &dir) && dir.boolValue
}

// nil when this isn't a World of Warcraft folder.
func gameFolder(at root: URL) -> GameFolder? {
    for flavor in FLAVORS where isDir(root.appendingPathComponent(flavor)) {
        return GameFolder(root: root.standardizedFileURL, flavor: flavor)
    }
    return nil
}

// What the player picked in the folder dialog: the game's folder, its AddOns folder or the World of Warcraft folder.
func normalizePickedFolder(_ picked: URL) -> GameFolder? {
    var url = picked.standardizedFileURL
    if url.lastPathComponent.lowercased() == "addons" {
        url = url.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    }
    if FLAVORS.contains(url.lastPathComponent) { url = url.deletingLastPathComponent() }
    return gameFolder(at: url)
}

private func productDatabasePaths() -> [String] {
    // Battle.net's agent database names the install folder. /Users/Shared isn't a protected folder.
    guard let data = FileManager.default.contents(atPath: "/Users/Shared/Battle.net/Agent/product.db") else { return [] }
    let text = String(decoding: data.map { (0x20...0x7e).contains($0) ? $0 : 0x0a }, as: UTF8.self)
    var out: [String] = []
    guard let regex = try? NSRegularExpression(pattern: #"/(?:Applications|Users|Volumes)/[^\n":]{0,200}?World of Warcraft"#) else { return [] }
    for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
        if let range = Range(match.range, in: text) { out.append(String(text[range])) }
    }
    return out
}

func findGames() -> [GameFolder] {
    var candidates = ["/Applications/\(WOW)", NSHomeDirectory() + "/Applications/\(WOW)", "/Applications/Games/\(WOW)"]
    candidates += productDatabasePaths()
    let disks = (try? FileManager.default.contentsOfDirectory(atPath: "/Volumes")) ?? []
    for disk in disks.sorted() where !disk.hasPrefix(".") && disk != "Install Lore Forever" {
        let base = "/Volumes/\(disk)"
        candidates += ["\(base)/\(WOW)", "\(base)/Applications/\(WOW)", "\(base)/Games/\(WOW)"]
    }
    var seen = Set<String>(), out: [GameFolder] = []
    for path in candidates {
        let url = URL(fileURLWithPath: path).resolvingSymlinksInPath()
        guard !seen.contains(url.path), let game = gameFolder(at: url) else { continue }
        seen.insert(url.path)
        out.append(game)
    }
    return out
}

// "Macintosh HD › Applications › World of Warcraft", as the design page shows it.
func breadcrumb(_ url: URL) -> String {
    var parts = url.standardizedFileURL.pathComponents.filter { $0 != "/" }
    #if QA
    if let scratch = parts.firstIndex(of: "lf-render") { parts = Array(parts[(scratch + 1)...]) }
    #endif
    if parts.first == "Volumes", parts.count > 1 {
        parts.removeFirst()
    } else {
        let disk = (try? URL(fileURLWithPath: "/").resourceValues(forKeys: [.volumeNameKey]))?.volumeName ?? "Macintosh HD"
        parts.insert(disk, at: 0)
    }
    return parts.joined(separator: " \u{203a} ")
}

func freeBytes(at url: URL) -> Int64 {
    #if QA
    if let forced = ProcessInfo.processInfo.environment["LF_FREE_BYTES"], let n = Int64(forced) { return n }
    #endif
    let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeAvailableCapacityKey])
    if let important = values?.volumeAvailableCapacityForImportantUsage, important > 0 { return important }
    return Int64(values?.volumeAvailableCapacity ?? 0)
}
