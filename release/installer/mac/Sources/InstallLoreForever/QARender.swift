#if QA
import AppKit
import SwiftUI

// QA builds only (build.sh --qa): renders every screen to a PNG, and drives a real install against a local catalog.
// A shipped installer has none of this.
//   --render <dir>       each state as the real window draws it
//   LF_AUTORUN=1         press Install, then exit 0 when installed, 3 for one part failed, 4 for not enough room, 1 otherwise
enum QARender {
    static func runIfAsked(model: AppModel) -> Bool {
        guard let index = CommandLine.arguments.firstIndex(of: "--render"), CommandLine.arguments.count > index + 1 else { return false }
        NSApp.appearance = NSAppearance(named: .darkAqua)
        render(model: model, to: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
        NSApp.terminate(nil)
        return true
    }

    static func autorunIfAsked(model: AppModel) {
        guard ProcessInfo.processInfo.environment["LF_AUTORUN"] == "1" else { return }
        var pressed = false
        Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { timer in
            switch model.screen {
            case .ready where !pressed && ProcessInfo.processInfo.environment["LF_CHECK_CHANGE"] == "1":
                // The real window with Change open: it must be as tall as what it shows (LOR-1398: it was cut off).
                pressed = true
                timer.invalidate()
                model.showChange = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    let window = NSApp.windows.first { $0.isVisible && $0.contentView is NSHostingView<ContentView> }
                    let shown = window.map { $0.contentRect(forFrameRect: $0.frame).height } ?? 0
                    let needs = window?.contentView?.fittingSize.height ?? 0
                    print("change: window \(Int(shown)) needs \(Int(needs))")
                    exit(needs > 0 && shown + 1 >= needs ? 0 : 5)
                }
            case .ready where !pressed:
                pressed = true
                model.install()
            case .done:
                timer.invalidate()
                exit(0)
            case .partial:
                timer.invalidate()
                exit(3)
            case .noSpace:
                timer.invalidate()
                exit(4)
            case let .failed(title, _):
                timer.invalidate()
                print("failed: \(title)")
                exit(1)
            case .couldNotLoad, .findGame:
                timer.invalidate()
                exit(1)
            default: break
            }
        }
    }

    private static func zip(_ name: String, _ bytes: Int64, _ folders: [String]) -> Zip {
        Zip(url: "https://example.invalid/v1/\(name).zip", name: name, bytes: bytes, folders: folders)
    }

    private static func demoCatalog() -> Catalog {
        let json = #"""
        {"schema":1,"tag":"v1.4.0","version":"1.4.0","langs":[
         {"code":"en","name":"English","narrators":[
          {"id":"male","name":"Male narrator","cards":{
           "everything":{"ok":true,"lines":[],"zips":[{"url":"https://example.invalid/download/v1.4.0/a.zip","name":"All","bytes":3200000000,"folders":["LoreForever","LoreForever_Voice_Default_Quests"]}]},
           "storyteller":{"ok":true,"lines":[],"zips":[{"url":"https://example.invalid/download/v1.4.0/b.zip","name":"Storyteller","bytes":1900000000,"folders":["LoreForever"]}]},
           "addon":{"ok":true,"lines":[],"zips":[{"url":"https://example.invalid/download/v1.4.0/c.zip","name":"Add-on","bytes":299000000,"folders":["LoreForever"]}]}}},
          {"id":"female","name":"Female narrator","cards":{"addon":{"ok":true,"zips":[]}}}]}]}
        """#
        return try! JSONDecoder().decode(Catalog.self, from: Data(json.utf8))
    }

    private static func snapshot(_ view: some View, width: CGFloat, to file: URL) {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 200), styleMask: [.titled, .closable, .miniaturizable],
                              backing: .buffered, defer: false)
        window.title = file.deletingPathExtension().lastPathComponent.contains("update") ? "Update Lore Forever" : "Install Lore Forever"
        window.appearance = NSAppearance(named: .darkAqua)
        let hosting = NSHostingView(rootView: view.environment(\.colorScheme, .dark))
        window.contentView = hosting
        hosting.layoutSubtreeIfNeeded()
        let size = hosting.fittingSize
        window.setContentSize(NSSize(width: width, height: max(size.height, 40)))
        hosting.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        guard let frame = window.contentView?.superview, let rep = frame.bitmapImageRepForCachingDisplay(in: frame.bounds) else { return }
        frame.cacheDisplay(in: frame.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: file)
    }

    private static func render(model: AppModel, to dir: URL) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        model.catalog = demoCatalog()
        let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("lf-render/Applications/World of Warcraft")
        let game = GameFolder(root: scratch, flavor: "_forever_")
        try? FileManager.default.createDirectory(at: game.addOns, withIntermediateDirectories: true)
        model.game = game
        model.needed = [zip("a", 3_200_000_000, ["LoreForever"])]
        model.freeSpace = 41_000_000_000
        model.doneBytes = 1_200_000_000
        model.totalBytes = 3_200_000_000
        model.etaMinutes = 12
        func shot(_ name: String, _ screen: Screen, waiting: Bool = false) {
            model.screen = screen
            model.waitingForConnection = waiting
            snapshot(ContentView(model: model), width: 520, to: dir.appendingPathComponent(name + ".png"))
        }
        shot("02-install", .ready)
        model.showChange = true
        shot("03-change", .ready)
        model.showChange = false
        shot("04-installing", .installing)
        shot("05-waiting", .installing, waiting: true)
        shot("06-done", .done)
        let toc = game.addOns.appendingPathComponent("LoreForever")
        try? FileManager.default.createDirectory(at: toc, withIntermediateDirectories: true)
        try? "## Version: 1.3.0\n".write(to: toc.appendingPathComponent("LoreForever.toc"), atomically: true, encoding: .utf8)
        model.pick.bundle = "storyteller"
        model.needed = [zip("a", 240_000_000, ["LoreForever"])]
        shot("07-update", .ready)
        try? FileManager.default.removeItem(at: toc)
        model.pick.bundle = "everything"
        shot("08-one-part-failed", .partial(names: ["Quest dialogue"]))
        shot("09-where-is-game", .findGame(warn: nil))
        shot("10-wrong-folder", .findGame(warn: "That folder doesn't hold _forever_. Try the World of Warcraft folder."))
        shot("11-not-enough-space", .noSpace(need: 3_200_000_000, free: 1_100_000_000))
        shot("12-two-copies", .whichCopy([game, GameFolder(root: URL(fileURLWithPath: "/Volumes/Games SSD/World of Warcraft"), flavor: "_forever_")]))
        shot("13-cannot-reach", .couldNotLoad)
        shot("14-cannot-write", .cannotWrite)
        shot("16-could-not-download", .couldNotDownload)
        shot("17-damaged", .damaged)
        shot("18-wont-connect", .unreachable)
        snapshot(CancelSheet(model: model), width: 420, to: dir.appendingPathComponent("15-cancel-asks.png"))
    }
}
#endif
