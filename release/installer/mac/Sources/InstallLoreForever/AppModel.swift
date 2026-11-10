import AppKit
import SwiftUI

enum Screen: Equatable {
    case loading
    case couldNotLoad
    case findGame(warn: String?)        // can't find it, or the wrong folder was picked
    case whichCopy([GameFolder])        // two copies: asks which
    case ready
    case installing
    case done
    case partial(names: [String])       // one part failed; the rest is in
    case failed(title: String, detail: String)   // nothing could be installed
    case noSpace(need: Int64, free: Int64)
}

final class AppModel: ObservableObject {
    @Published var screen: Screen = .loading
    @Published var catalog: Catalog?
    @Published var game: GameFolder?
    @Published var pick = Pick(narrator: "male", lang: "en", bundle: "everything")
    @Published var showChange = false
    @Published var askCancel = false
    @Published var placing = false
    @Published var waitingForConnection = false
    @Published var doneBytes: Int64 = 0
    @Published var totalBytes: Int64 = 0
    @Published var etaMinutes: Int?
    @Published var needed: [Zip] = []
    @Published var freeSpace: Int64 = 0

    private let receipts = Receipts()
    private var engine: Engine?
    private var mountPoint: String?
    private var pickedOnSite = false

    var progress: Double { totalBytes > 0 ? min(1, Double(doneBytes) / Double(totalBytes)) : 0 }
    var isUpdate: Bool { game.map { tocVersion(in: $0.addOns, folder: "LoreForever") != nil } ?? false }

    // The current selection, falling back to what the catalog has.
    var lang: Lang? { catalog?.langs.first { $0.code == pick.lang } ?? catalog?.langs.first }
    var narrator: Narrator? { lang?.narrators.first { $0.id == pick.narrator } ?? lang?.narrators.first }
    var card: Card? { narrator?.cards[pick.bundle] }
    var bundleTitle: String { BUNDLE_TITLE[pick.bundle] ?? "Everything" }
    var sizeText: String { formatBytes(needed.reduce(0) { $0 + $1.bytes }) }
    var cardSizeText: String { formatBytes(card?.bytes ?? 0) }
    var pickLine: String { "\(lang?.name ?? ""), \(narrator?.name ?? "")" }

    // What they have now, for "You have Storyteller. Your voices stay.".
    var installedBundle: String? {
        guard let game, let cards = narrator?.cards else { return nil }
        return BUNDLES.first { key in
            guard let zips = cards[key]?.zips, cards[key]?.ok == true else { return false }
            return zips.allSatisfy { $0.folders.allSatisfy { tocVersion(in: game.addOns, folder: $0) != nil } }
        }
    }

    func start() {
        if let image = imageFromEnvironment() ?? Optional(downloadedImage(appPath: Bundle.main.bundlePath)) {
            mountPoint = image.mountPoint
            if let name = image.imageName, let parsed = parsePick(fileName: name) {
                pick = parsed
                pickedOnSite = true
            }
        }
        Task { await load() }
    }

    private func imageFromEnvironment() -> (imageName: String?, mountPoint: String?)? {
        #if QA
        if let name = ProcessInfo.processInfo.environment["LF_DMG_NAME"] { return (name, nil) }
        #endif
        return nil
    }

    private var catalogURL: URL {
        #if QA
        if let url = ProcessInfo.processInfo.environment["LF_CATALOG_URL"] { return URL(string: url)! }
        #endif
        return URL(string: "https://loreforeverwow.com/api/installer/catalog")!
    }

    @MainActor func load() async {
        screen = .loading
        do {
            var request = URLRequest(url: catalogURL)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            catalog = try JSONDecoder().decode(Catalog.self, from: data)
        } catch {
            screen = .couldNotLoad
            return
        }
        detect()
    }

    @MainActor private func detect() {
        var games: [GameFolder]
        #if QA
        if let root = ProcessInfo.processInfo.environment["LF_ROOT"], let g = gameFolder(at: URL(fileURLWithPath: root)) {
            games = [g]
        } else { games = findGames() }
        #else
        games = findGames()
        #endif
        switch games.count {
        case 0: screen = .findGame(warn: nil)
        case 1: choose(games[0])
        default: screen = .whichCopy(games)
        }
    }

    @MainActor func choose(_ g: GameFolder) {
        game = g
        // Update keeps at least what's there: a smaller pick never removes voices, so show the larger of the two.
        if let have = installedBundle, !pickedOnSite || (BUNDLES.firstIndex(of: have) ?? 9) < (BUNDLES.firstIndex(of: pick.bundle) ?? 9) {
            pick.bundle = have
        }
        refreshPlan()
        screen = .ready
    }

    @MainActor func refreshPlan() {
        guard let catalog, let game, let zips = card?.zips, card?.ok == true else {
            needed = []
            return
        }
        needed = zips.filter { zipNeeded($0, game: game, catalog: catalog, receipts: receipts) }
        freeSpace = freeBytes(at: game.root)
    }

    @MainActor func applyChange(_ newPick: Pick) {
        pick = newPick
        pickedOnSite = true
        refreshPlan()
    }

    @MainActor func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: "/Applications")
        panel.prompt = "Choose"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        if let g = normalizePickedFolder(url) {
            choose(g)
        } else {
            screen = .findGame(warn: "That folder doesn't hold _forever_. Try the World of Warcraft folder.")
        }
    }

    @MainActor func install() {
        guard let game else { return }
        refreshPlan()
        guard !needed.isEmpty else {
            finish()
            return
        }
        let need = spaceNeeded(needed)
        freeSpace = freeBytes(at: game.root)
        if freeSpace < need {
            // Stops before downloading anything.
            screen = .noSpace(need: need, free: freeSpace)
            return
        }
        begin(needed, game: game)
    }

    @MainActor private func begin(_ zips: [Zip], game: GameFolder) {
        let engine = Engine()
        self.engine = engine
        doneBytes = 0
        totalBytes = zips.reduce(0) { $0 + $1.bytes }
        etaMinutes = nil
        waitingForConnection = false
        placing = false
        screen = .installing
        DockProgress.shared.show(0)
        Task {
            let result = await engine.install(zips: zips, game: game, receipts: receipts) { [weak self] event in
                DispatchQueue.main.async {
                    guard let self else { return }
                    switch event {
                    case let .progress(done, total, eta):
                        self.doneBytes = done
                        self.totalBytes = total
                        if let eta { self.etaMinutes = eta }
                        self.waitingForConnection = false
                        DockProgress.shared.show(self.progress)
                    case let .waiting(done, total):
                        self.doneBytes = done
                        self.totalBytes = total
                        self.waitingForConnection = true
                    case .placing:
                        self.placing = true
                        self.waitingForConnection = false
                    }
                }
            }
            await MainActor.run {
                DockProgress.shared.hide()
                if engine.cancelled { NSApp.terminate(nil); return }
                if result.writeProblem {
                    self.screen = .failed(title: "Can't write to that folder",
                                          detail: "macOS won't let Lore Forever save to your game folder. Try the ZIP at loreforeverwow.com/downloads.")
                } else if !result.failedNames.isEmpty && !result.installedAny {
                    self.screen = .failed(title: "That didn't work", detail: "Lore Forever couldn't download. Your game hasn't changed.")
                } else if !result.failedNames.isEmpty {
                    self.screen = .partial(names: result.failedNames)
                } else {
                    self.finish()
                }
            }
        }
    }

    @MainActor private func finish() { screen = .done }

    @MainActor func tryAgainAfterPartial() {
        refreshPlan()
        install()
    }

    func confirmCancel() {
        engine?.cancel()
        if engine == nil { NSApp.terminate(nil) }
    }

    // Eject the disk this app runs from once it has quit. The .dmg itself stays in Downloads: moving it to the Trash would
    // make macOS ask permission for the Downloads folder (LOR-1348: tested on Silver 11/9).
    func quitAndTidy() {
        if let mount = mountPoint {
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/bin/sh")
            task.arguments = ["-c", "(sleep 1; /usr/bin/hdiutil detach \"$1\" -quiet -force) >/dev/null 2>&1 &", "sh", mount]
            try? task.run()
        }
        NSApp.terminate(nil)
    }
}
