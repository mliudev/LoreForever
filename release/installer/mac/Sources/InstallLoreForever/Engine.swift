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

struct InstallResult {
    var failedNames: [String] = []
    var installedAny = false
    var writeProblem = false
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
final class Receipts {
    private let file: URL
    private var data: [String: [String: Int64]] = [:]
    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("LoreForever/Install")
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        file = base.appendingPathComponent("receipts.json")
        if let raw = try? Data(contentsOf: file), let decoded = try? JSONDecoder().decode([String: [String: Int64]].self, from: raw) { data = decoded }
    }
    func has(_ game: GameFolder, _ zip: Zip) -> Bool { data[game.root.path]?[zip.file] == zip.bytes }
    func record(_ game: GameFolder, _ zip: Zip) {
        data[game.root.path, default: [:]][zip.file] = zip.bytes
        if let raw = try? JSONEncoder().encode(data) { try? raw.write(to: file, options: .atomic) }
    }
}

// Whether this ZIP still has to come: its folders are missing, or they aren't this version.
func zipNeeded(_ zip: Zip, game: GameFolder, catalog: Catalog, receipts: Receipts) -> Bool {
    let versions = zip.folders.map { tocVersion(in: game.addOns, folder: $0) }
    if versions.contains(where: { $0 == nil }) { return true }
    if receipts.has(game, zip) { return false }
    return !(zip.isCurrentRelease(catalog.tag) && versions.allSatisfy { $0 == catalog.version })
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
            dataTask.cancel()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        try? handle?.close()
        handle = nil
        let c = finish
        finish = nil
        if let code = httpError {
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
        let total = zips.reduce(0) { $0 + $1.bytes }
        var finishedBefore: Int64 = 0
        var downloaded: [(Zip, URL)] = []
        var speed = Speed()
        for zip in zips {
            if cancelled { return result }
            let part = zipsDir.appendingPathComponent(zip.file + ".part"), done = zipsDir.appendingPathComponent(zip.file)
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
            let ok = await download(zip, part: part, to: done, before: before, total: total, events: events)
            if cancelled { return result }
            if ok {
                downloaded.append((zip, done))
                finishedBefore += zip.bytes
            } else {
                result.failedNames.append(zip.name)
            }
        }
        // All here: now the game changes, a part at a time.
        events(.placing)
        for (zip, file) in downloaded {
            if cancelled { return result }
            let unpacked = stage.appendingPathComponent("unpacked").appendingPathComponent(zip.file)
            try? fm.removeItem(at: unpacked)
            if let folders = unpack(file, to: unpacked, expected: zip.folders), promote(folders, from: unpacked, into: game.addOns, old: old) {
                receipts.record(game, zip)
                result.installedAny = true
            } else {
                result.failedNames.append(zip.name)
            }
            try? fm.removeItem(at: unpacked)
            try? fm.removeItem(at: file)
        }
        if result.failedNames.isEmpty && !cancelled { try? fm.removeItem(at: stage) }
        return result
    }

    private func fileSize(_ url: URL) -> Int64 { (try? fm.attributesOfItem(atPath: url.path)[.size] as? Int64) ?? -1 }

    private func download(_ zip: Zip, part: URL, to done: URL, before: Int64, total: Int64, events: @escaping (EngineEvent) -> Void) async -> Bool {
        guard let url = URL(string: zip.url) else { return false }
        var failures = 0
        while !cancelled {
            do {
                try await downloader.fetch(url, to: part)
                if cancelled { return false }
                // A short file means the connection ended early: carry on from there.
                if zip.bytes > 0 && fileSize(part) != zip.bytes {
                    if fileSize(part) > zip.bytes { try? fm.removeItem(at: part) }
                    failures += 1
                    if failures > 5 { try? fm.removeItem(at: part); return false }
                    continue
                }
                try? fm.removeItem(at: done)
                try fm.moveItem(at: part, to: done)
                return true
            } catch {
                if cancelled { return false }
                if isConnectionError(error) || !connection.isOnline {
                    // No connection, or a Mac that just woke up: wait and carry on.
                    events(.waiting(done: before + max(fileSize(part), 0), total: total))
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    while !connection.isOnline && !cancelled {
                        try? await Task.sleep(nanoseconds: 2_000_000_000)
                    }
                    continue
                }
                failures += 1
                if failures > 3 { return false }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
        return false
    }

    // The add-on folders inside, once it's unzipped and checked: nothing but add-on folders, each with its .toc, and at
    // least the ones the catalog named. A damaged or wrong ZIP never reaches AddOns. nil when it isn't right.
    private func unpack(_ zip: URL, to dest: URL, expected: [String]) -> [String]? {
        try? fm.createDirectory(at: dest, withIntermediateDirectories: true)
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        task.arguments = ["-x", "-k", zip.path, dest.path]
        guard (try? task.run()) != nil else { return nil }
        task.waitUntilExit()
        guard task.terminationStatus == 0 else { return nil }
        let top = ((try? fm.contentsOfDirectory(atPath: dest.path)) ?? []).filter { !$0.hasPrefix(".") && $0 != "__MACOSX" }
        guard !top.isEmpty, Set(expected).isSubset(of: Set(top)),
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
