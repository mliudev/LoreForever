import Foundation
import Network

// The install itself, the same job as Setup's on Windows (release/installer/LoreForever.iss): each ZIP lands in a
// stage folder on the game's own disk, then each part moves into AddOns only once it's whole, and a part that fails
// leaves the rest and whatever was there before. A stopped download picks up where it left off.
enum EngineEvent {
    case progress(done: Int64, total: Int64, etaMinutes: Int?)
    case waiting(done: Int64, total: Int64)
    case placing
}

// What went wrong, when something did, so the failure screen can say it (LOR-1398): a damaged ZIP or a full disk isn't
// "couldn't download".
struct InstallResult {
    var failedNames: [String] = []
    var installedAny = false
    var writeProblem = false
    var diskFull = false
    var damaged = false
    var unreachable = false
    var stillNeeded: [Zip] = []
}

private enum Fetched { case ok, failed, diskFull, unreachable }

// "1.6.0" is at least "1.5.2". A version that isn't dotted numbers only matches itself.
func versionAtLeast(_ have: String, _ want: String) -> Bool {
    func parts(_ s: String) -> [Int]? {
        let p = s.trimmingCharacters(in: CharacterSet(charactersIn: "vV ")).split(separator: ".").map { Int($0) }
        return p.isEmpty || p.contains(where: { $0 == nil }) ? nil : p.map { $0! }
    }
    guard let a = parts(have), let b = parts(want) else { return have == want }
    for i in 0..<max(a.count, b.count) {
        let x = i < a.count ? a[i] : 0, y = i < b.count ? b[i] : 0
        if x != y { return x > y }
    }
    return true
}

private func isDiskFull(_ error: Error) -> Bool {
    let ns = error as NSError
    if ns.domain == NSCocoaErrorDomain && ns.code == NSFileWriteOutOfSpaceError { return true }
    if ns.domain == NSPOSIXErrorDomain && (ns.code == Int(ENOSPC) || ns.code == Int(EDQUOT)) { return true }
    if let under = ns.userInfo[NSUnderlyingErrorKey] as? Error { return isDiskFull(under) }
    return false
}

private func toc(_ dir: URL, _ folder: String) -> URL { dir.appendingPathComponent(folder).appendingPathComponent(folder + ".toc") }

func tocVersion(in addOns: URL, folder: String) -> String? {
    guard let text = try? String(contentsOf: toc(addOns, folder), encoding: .utf8) else { return nil }
    for line in text.split(whereSeparator: \.isNewline) where line.hasPrefix("## Version:") {
        return line.dropFirst("## Version:".count).trimmingCharacters(in: .whitespaces)
    }
    return nil
}

// Installed ZIPs, by game folder, so an update asks only for what's new: a language pack's ZIP keeps its own version.
// Each keeps the folders that really came out of it: the site's list of a ZIP's folders can run a release ahead of the
// ZIP itself (LOR-1408 named the starting zones' quest givers in the main ZIP the day before a release carried them).
final class Receipts {
    struct Entry: Codable { var bytes: Int64; var folders: [String] }
    private let file: URL
    private var data: [String: [String: Entry]] = [:]
    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("LoreForever/Install")
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        file = base.appendingPathComponent("receipts.json")
        // A receipts file from a test build before this shape is simply started again.
        if let raw = try? Data(contentsOf: file), let decoded = try? JSONDecoder().decode([String: [String: Entry]].self, from: raw) { data = decoded }
    }
    // The folders this exact ZIP put in, when it's the one installed here.
    func folders(_ game: GameFolder, _ zip: Zip) -> [String]? {
        guard let entry = data[game.root.path]?[zip.file], entry.bytes == zip.bytes else { return nil }
        return entry.folders
    }
    func record(_ game: GameFolder, _ zip: Zip, folders: [String]) {
        data[game.root.path, default: [:]][zip.file] = Entry(bytes: zip.bytes, folders: folders)
        if let raw = try? JSONEncoder().encode(data) { try? raw.write(to: file, options: .atomic) }
    }
}

// Whether this ZIP is in, for "You have Storyteller": the folders it put in last time are all there, or, never
// installed by us, its first folder (the main ZIP's is the add-on itself; a voice pack's ZIP holds just its own).
func zipPresent(_ zip: Zip, game: GameFolder, receipts: Receipts) -> Bool {
    let folders = receipts.folders(game, zip) ?? Array(zip.folders.prefix(1))
    return !folders.isEmpty && folders.allSatisfy { tocVersion(in: game.addOns, folder: $0) != nil }
}

// Whether this ZIP still has to come: its folders are missing, or they're older than this version. A newer copy (the
// site's facts can lag a release by a few minutes) is left alone, never replaced by an older one.
func zipNeeded(_ zip: Zip, game: GameFolder, catalog: Catalog, receipts: Receipts) -> Bool {
    if let installed = receipts.folders(game, zip) {
        return !installed.allSatisfy { tocVersion(in: game.addOns, folder: $0) != nil }
    }
    let versions = zip.folders.map { tocVersion(in: game.addOns, folder: $0) }
    if versions.contains(where: { $0 == nil }) { return true }
    return !(zip.isCurrentRelease(catalog.tag) && versions.allSatisfy { versionAtLeast($0 ?? "", catalog.version) })
}

// What Install has to fit: the parts, plus the largest ZIP, since a ZIP and its unpacked copy are both on disk for a moment.
func spaceNeeded(_ zips: [Zip]) -> Int64 {
    zips.reduce(0) { $0 + $1.bytes } + (zips.map(\.bytes).max() ?? 0)
}

final class Downloader: NSObject, URLSessionDataDelegate {
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.waitsForConnectivity = false
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 7 * 24 * 3600
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    private let lock = NSLock()
    private var handle: FileHandle?
    private var written: Int64 = 0
    private var part: URL?
    private var resumed = false
    private var finish: CheckedContinuation<Void, Error>?
    private var httpError: Int?
    private var writeError: Error?
    var onBytes: ((Int64) -> Void)?
    private var task: URLSessionDataTask?

    func cancel() { task?.cancel() }

    func fetch(_ url: URL, to part: URL) async throws {
        let existing = (try? FileManager.default.attributesOfItem(atPath: part.path)[.size] as? Int64) ?? 0
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if existing > 0 { request.setValue("bytes=\(existing)-", forHTTPHeaderField: "Range") }
        if !FileManager.default.fileExists(atPath: part.path) { FileManager.default.createFile(atPath: part.path, contents: nil) }
        self.part = part
        written = existing
        resumed = existing > 0
        httpError = nil
        writeError = nil
        handle = try FileHandle(forWritingTo: part)
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            finish = c
            let dataTask = session.dataTask(with: request)
            task = dataTask
            dataTask.resume()
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code == 200 && resumed {
            // The server didn't honour Range: start this file over.
            try? handle?.truncate(atOffset: 0)
            try? handle?.seek(toOffset: 0)
            written = 0
            resumed = false
            onBytes?(0)
        } else if code == 206 {
            _ = try? handle?.seekToEnd()
        } else if !(200...299).contains(code) {
            httpError = code
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        do {
            try handle?.write(contentsOf: data)
            written += Int64(data.count)
            onBytes?(written)
        } catch {
            // Usually a full disk: say so, rather than the cancel this causes.
            writeError = error
            dataTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        try? handle?.close()
        handle = nil
        let c = finish
        finish = nil
        if let writeError {
            c?.resume(throwing: writeError)
        } else if let code = httpError {
            c?.resume(throwing: NSError(domain: "HTTP", code: code))
        } else if let error {
            c?.resume(throwing: error)
        } else {
            c?.resume()
        }
    }
}

final class Connection {
    private let monitor = NWPathMonitor()
    private var online = true
    private let lock = NSLock()
    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            self?.lock.lock(); self?.online = path.status == .satisfied; self?.lock.unlock()
        }
        monitor.start(queue: .global(qos: .utility))
    }
    var isOnline: Bool { lock.lock(); defer { lock.unlock() }; return online }
}

private func isConnectionError(_ error: Error) -> Bool {
    let ns = error as NSError
    guard ns.domain == NSURLErrorDomain else { return false }
    return [NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut, NSURLErrorCannotFindHost,
            NSURLErrorCannotConnectToHost, NSURLErrorDNSLookupFailed, NSURLErrorDataNotAllowed, NSURLErrorInternationalRoamingOff,
            NSURLErrorCallIsActive, NSURLErrorSecureConnectionFailed, NSURLErrorResourceUnavailable].contains(ns.code)
}

final class Engine {
    private let downloader = Downloader()
    private let connection = Connection()
    private let fm = FileManager.default
    private(set) var cancelled = false

    func cancel() { cancelled = true; downloader.cancel() }

    func install(zips: [Zip], game: GameFolder, receipts: Receipts, events: @escaping (EngineEvent) -> Void) async -> InstallResult {
        var result = InstallResult()
        let stage = game.stage, zipsDir = stage.appendingPathComponent("zips"), old = stage.appendingPathComponent("old")
        do {
            try fm.createDirectory(at: zipsDir, withIntermediateDirectories: true)
            try fm.createDirectory(at: game.addOns, withIntermediateDirectories: true)
            recover(old: old, into: game.addOns)
        } catch {
            result.writeProblem = true
            return result
        }
        // Stage files are named by release and file (LoreForever.zip is the name in every release), so a part left from
        // another release is never resumed into this one; anything this install doesn't want is cleared first.
        let wanted = Set(zips.flatMap { [$0.stageFile, $0.stageFile + ".part"] })
        for name in (try? fm.contentsOfDirectory(atPath: zipsDir.path)) ?? [] where !wanted.contains(name) {
            try? fm.removeItem(at: zipsDir.appendingPathComponent(name))
        }
        let total = zips.reduce(0) { $0 + $1.bytes }
        var finishedBefore: Int64 = 0
        var downloaded: [(Zip, URL)] = []
        var speed = Speed()
        for (index, zip) in zips.enumerated() {
            if cancelled { return result }
            let part = zipsDir.appendingPathComponent(zip.stageFile + ".part"), done = zipsDir.appendingPathComponent(zip.stageFile)
            if fm.fileExists(atPath: done.path) && fileSize(done) == zip.bytes {
                downloaded.append((zip, done))
                finishedBefore += zip.bytes
                continue
            }
            let before = finishedBefore
            downloader.onBytes = { soFar in
                let shown = before + soFar
                events(.progress(done: shown, total: total, etaMinutes: speed.update(done: shown, total: total)))
            }
            let fetched = await download(zip, part: part, to: done, before: before, total: total, events: events)
            if cancelled { return result }
            switch fetched {
            case .ok:
                downloaded.append((zip, done))
                finishedBefore += zip.bytes
            case .failed:
                result.failedNames.append(zip.name)
                result.stillNeeded.append(zip)
            case .diskFull, .unreachable:
                // The rest would go the same way: stop downloading, and put in what's already here.
                if fetched == .diskFull { result.diskFull = true } else { result.unreachable = true }
                result.failedNames += zips[index...].map(\.name)
                result.stillNeeded += zips[index...]
            }
            if result.diskFull || result.unreachable { break }
        }
        // All here: now the game changes, a part at a time.
        events(.placing)
        for (zip, file) in downloaded {
            if cancelled { return result }
            let unpacked = stage.appendingPathComponent("unpacked").appendingPathComponent(zip.file)
            try? fm.removeItem(at: unpacked)
            if let folders = unpack(file, to: unpacked, expected: zip.folders) {
                if promote(folders, from: unpacked, into: game.addOns, old: old) {
                    receipts.record(game, zip, folders: folders)
                    result.installedAny = true
                } else {
                    result.writeProblem = true
                    result.failedNames.append(zip.name)
                    result.stillNeeded.append(zip)
                }
            } else {
                // ditto fails the same way on a full disk as on a damaged ZIP: the free space tells them apart.
                if freeBytes(at: stage) < zip.bytes { result.diskFull = true } else { result.damaged = true }
                result.failedNames.append(zip.name)
                result.stillNeeded.append(zip)
            }
            try? fm.removeItem(at: unpacked)
            try? fm.removeItem(at: file)
        }
        if result.failedNames.isEmpty && !cancelled { try? fm.removeItem(at: stage) }
        return result
    }

    private func fileSize(_ url: URL) -> Int64 { (try? fm.attributesOfItem(atPath: url.path)[.size] as? Int64) ?? -1 }

    // How long the Mac can say it's online while every try fails to connect (a proxy, a VPN, a wrong clock breaking TLS)
    // before the player gets the failure screen and Try Again instead of waiting forever. Offline waits as long as it takes.
    private var stuckLimit: TimeInterval {
        #if QA
        if let s = ProcessInfo.processInfo.environment["LF_STUCK_SECONDS"], let n = TimeInterval(s) { return n }
        #endif
        return 180
    }

    private func download(_ zip: Zip, part: URL, to done: URL, before: Int64, total: Int64, events: @escaping (EngineEvent) -> Void) async -> Fetched {
        guard let url = URL(string: zip.url) else { return .failed }
        var failures = 0
        var stuckSince: Date?
        while !cancelled {
            let sizeBefore = max(fileSize(part), 0)
            do {
                try await downloader.fetch(url, to: part)
                if cancelled { return .failed }
                // A short file means the connection ended early: carry on from there.
                if zip.bytes > 0 && fileSize(part) != zip.bytes {
                    if fileSize(part) > zip.bytes { try? fm.removeItem(at: part) }
                    failures += 1
                    if failures > 5 { try? fm.removeItem(at: part); return .failed }
                    stuckSince = nil
                    continue
                }
                try? fm.removeItem(at: done)
                try fm.moveItem(at: part, to: done)
                return .ok
            } catch {
                if cancelled { return .failed }
                if isDiskFull(error) { return .diskFull }
                let ns = error as NSError
                if ns.domain == "HTTP" && ns.code == 416 {
                    // The part is already as big as the file or bigger (the file was replaced): start it over.
                    try? fm.removeItem(at: part)
                    failures += 1
                    if failures > 3 { return .failed }
                    continue
                }
                if isConnectionError(error) || !connection.isOnline {
                    if connection.isOnline {
                        if fileSize(part) > sizeBefore { stuckSince = nil }
                        let since = stuckSince ?? Date()
                        stuckSince = since
                        if Date().timeIntervalSince(since) >= stuckLimit { return .unreachable }
                    } else {
                        stuckSince = nil
                    }
                    // No connection, or a Mac that just woke up: wait and carry on.
                    events(.waiting(done: before + max(fileSize(part), 0), total: total))
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    while !connection.isOnline && !cancelled {
                        stuckSince = nil
                        try? await Task.sleep(nanoseconds: 2_000_000_000)
                    }
                    continue
                }
                failures += 1
                if failures > 3 { return .failed }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
        return .failed
    }

    // The add-on folders inside, once it's unzipped and checked: nothing but add-on folders, each with its .toc, and at
    // least one the catalog named (not all: the site's list can name a folder the published ZIP gets only in the next
    // release, LOR-1398). The size already matched the catalog's to the byte. A damaged or wrong ZIP never reaches
    // AddOns. nil when it isn't right.
    private func unpack(_ zip: URL, to dest: URL, expected: [String]) -> [String]? {
        try? fm.createDirectory(at: dest, withIntermediateDirectories: true)
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        task.arguments = ["-x", "-k", zip.path, dest.path]
        guard (try? task.run()) != nil else { return nil }
        task.waitUntilExit()
        guard task.terminationStatus == 0 else { return nil }
        let top = ((try? fm.contentsOfDirectory(atPath: dest.path)) ?? []).filter { !$0.hasPrefix(".") && $0 != "__MACOSX" }
        guard !top.isEmpty, expected.isEmpty || !Set(expected).isDisjoint(with: top),
              top.allSatisfy({ $0.range(of: #"^LoreForever[A-Za-z0-9_-]*$"#, options: .regularExpression) != nil && fm.fileExists(atPath: toc(dest, $0).path) })
        else { return nil }
        return top
    }

    // Each folder goes in whole, with the old copy held until every folder of this part is in; any failure puts the old copies back.
    private func promote(_ folders: [String], from unpacked: URL, into addOns: URL, old: URL) -> Bool {
        try? fm.createDirectory(at: old, withIntermediateDirectories: true)
        var promoted: [(String, Bool)] = []
        for folder in folders {
            let dest = addOns.appendingPathComponent(folder), backup = old.appendingPathComponent(folder), new = unpacked.appendingPathComponent(folder)
            let hadOld = fm.fileExists(atPath: dest.path)
            do {
                try? fm.removeItem(at: backup)
                if hadOld { try fm.moveItem(at: dest, to: backup) }
                try fm.moveItem(at: new, to: dest)
                promoted.append((folder, hadOld))
            } catch {
                if hadOld && !fm.fileExists(atPath: dest.path) { try? fm.moveItem(at: backup, to: dest) }
                for (done, had) in promoted {
                    try? fm.removeItem(at: addOns.appendingPathComponent(done))
                    if had { try? fm.moveItem(at: old.appendingPathComponent(done), to: addOns.appendingPathComponent(done)) }
                }
                return false
            }
        }
        for (folder, _) in promoted { try? fm.removeItem(at: old.appendingPathComponent(folder)) }
        return true
    }

    // A crash mid-swap leaves the old copy in stage/old: put back any that didn't get replaced.
    private func recover(old: URL, into addOns: URL) {
        for name in (try? fm.contentsOfDirectory(atPath: old.path)) ?? [] {
            let dest = addOns.appendingPathComponent(name), backup = old.appendingPathComponent(name)
            if fm.fileExists(atPath: dest.path) { try? fm.removeItem(at: backup) } else { try? fm.moveItem(at: backup, to: dest) }
        }
    }
}

// Rough time left, smoothed so the line doesn't jump about.
struct Speed {
    private var lastDone: Int64 = -1
    private var lastTime = Date()
    private var bytesPerSec: Double = 0
    mutating func update(done: Int64, total: Int64) -> Int? {
        let now = Date()
        if lastDone >= 0, now.timeIntervalSince(lastTime) >= 1 {
            let rate = Double(done - lastDone) / now.timeIntervalSince(lastTime)
            bytesPerSec = bytesPerSec == 0 ? rate : bytesPerSec * 0.9 + rate * 0.1
            lastDone = done
            lastTime = now
        } else if lastDone < 0 {
            lastDone = done
            lastTime = now
        }
        guard bytesPerSec > 1 else { return nil }
        return Int((Double(total - done) / bytesPerSec / 60).rounded(.up))
    }
}
