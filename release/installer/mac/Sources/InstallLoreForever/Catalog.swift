import Foundation

// What the site offers, from GET /api/installer/catalog (site/functions/api/installer/catalog.js): the same three
// cards the Downloads page shows, per language and narrator, each with the exact ZIPs and their sizes, so the sizes
// here always match the page.
struct Catalog: Decodable {
    let schema: Int
    let tag: String
    let version: String
    let langs: [Lang]
}

struct Lang: Decodable, Identifiable {
    let code: String
    let name: String
    let english: String?
    let note: String?
    let narrators: [Narrator]
    var id: String { code }
}

struct Narrator: Decodable, Identifiable {
    let id: String
    let name: String
    let cards: [String: Card]
}

struct Card: Decodable {
    let ok: Bool
    let why: String?
    let lines: [String]?
    let zips: [Zip]?
    var bytes: Int64 { (zips ?? []).reduce(0) { $0 + $1.bytes } }
}

struct Zip: Decodable, Hashable {
    let url: String
    let name: String
    let bytes: Int64
    let folders: [String]
    var file: String { URL(string: url)?.lastPathComponent ?? name }
    // Assets of the release the catalog names carry its version in their .toc files.
    func isCurrentRelease(_ tag: String) -> Bool { url.contains("/download/\(tag)/") }
}

// The bundles, biggest first, as on the Downloads page.
let BUNDLES = ["everything", "storyteller", "addon"]
let BUNDLE_TITLE = ["everything": "Everything", "storyteller": "Storyteller", "addon": "The add-on"]
// The English cards' one line, as the design page words them; other languages use the card's first line from the site.
let ENGLISH_LINE = ["everything": "All the narration, quest dialogue and each quest giver's own voice",
                    "storyteller": "Zones, cities, dungeons, people, quest stories and item stories",
                    "addon": "Zones, cities and dungeons, and every lore entry"]

struct Pick: Equatable {
    var narrator: String
    var lang: String
    var bundle: String
}

// 3.2 GB, 299 MB: the site's own rule (formatBytes in site/lib/packs.js).
func formatBytes(_ bytes: Int64) -> String {
    if bytes >= 1_000_000_000 { return String(format: "%.1f GB", Double(bytes) / 1e9) }
    if bytes >= 1_000_000 { return "\(Int((Double(bytes) / 1e6).rounded())) MB" }
    return "\(max(1, Int((Double(bytes) / 1e3).rounded()))) KB"
}

// The pick from the file's name, "Install Lore Forever (female, en, storyteller).dmg", as Setup.exe reads its own
// (release/installer/LoreForever.iss ReadPick): the first "(...)" counts, since a browser adds its " (1)" after it.
// The .dmg stays the one notarized file: its name isn't part of the signature.
func parsePick(fileName: String) -> Pick? {
    guard let open = fileName.firstIndex(of: "("), let close = fileName[open...].firstIndex(of: ")") else { return nil }
    let parts = fileName[fileName.index(after: open)..<close].split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
    guard parts.count == 3, BUNDLES.contains(parts[2]) else { return nil }
    return Pick(narrator: parts[0], lang: parts[1], bundle: parts[2])
}

// The name of the disk image this app runs from, via hdiutil: that asks the system's disk-image helper rather than
// reading the Downloads folder, so macOS shows no permission box for it.
func downloadedImage(appPath: String) -> (imageName: String?, mountPoint: String?) {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/hdiutil")
    task.arguments = ["info", "-plist"]
    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = FileHandle.nullDevice
    guard (try? task.run()) != nil else { return (nil, nil) }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    task.waitUntilExit()
    guard let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
          let images = plist["images"] as? [[String: Any]] else { return (nil, nil) }
    var fallback: (String?, String?) = (nil, nil)
    for image in images {
        guard let path = image["image-path"] as? String else { continue }
        let mounts = ((image["system-entities"] as? [[String: Any]]) ?? []).compactMap { $0["mount-point"] as? String }
        for mount in mounts where appPath.hasPrefix(mount + "/") { return ((path as NSString).lastPathComponent, mount) }
        // A translocated app runs from a private path: fall back on the image named like ours.
        if let mount = mounts.first, (path as NSString).lastPathComponent.hasPrefix("Install Lore Forever") {
            fallback = ((path as NSString).lastPathComponent, mount)
        }
    }
    return fallback
}
