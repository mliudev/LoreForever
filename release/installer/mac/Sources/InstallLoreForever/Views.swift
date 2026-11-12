import AppKit
import SwiftUI

let GOLD = Color(red: 0.878, green: 0.659, blue: 0.290)
let ROW = Color(red: 0.212, green: 0.208, blue: 0.231)
let SOFT = Color(red: 0.663, green: 0.655, blue: 0.690)
let WARN = Color(red: 1, green: 0.706, blue: 0.659)
let INK = Color(red: 0.110, green: 0.078, blue: 0.039)

struct GoButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 13, weight: .semibold)).foregroundColor(INK)
            .padding(.horizontal, 18).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 6).fill(GOLD.opacity(configuration.isPressed ? 0.8 : 1)))
    }
}

struct PlainButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 13, weight: .medium)).foregroundColor(.white)
            .padding(.horizontal, 11).padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color(red: 0.333, green: 0.329, blue: 0.361).opacity(configuration.isPressed ? 0.7 : 1)))
    }
}

struct Emblem: View {
    var body: some View {
        Group {
            if let icon = NSImage(named: "AppIcon") ?? NSApp?.applicationIconImage {
                Image(nsImage: icon).resizable().interpolation(.high)
            }
        }.frame(width: 42, height: 42)
    }
}

struct TopRow: View {
    let title: String
    var detail: String? = nil
    var body: some View {
        HStack(spacing: 12) {
            Emblem()
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 16, weight: .semibold))
                if let detail { Text(detail).font(.system(size: 13)).foregroundColor(SOFT).fixedSize(horizontal: false, vertical: true) }
            }
            Spacer(minLength: 0)
        }
    }
}

struct InfoRow<Button: View>: View {
    let title: String
    let detail: String
    let button: Button
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 13))
                Text(detail).font(.system(size: 12)).foregroundColor(SOFT).lineLimit(2).truncationMode(.middle)
            }
            Spacer(minLength: 0)
            button
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 7).fill(ROW))
    }
}

struct Bar: View {
    let value: Double
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 4).fill(Color(red: 0.333, green: 0.329, blue: 0.361))
                RoundedRectangle(cornerRadius: 4).fill(GOLD).frame(width: max(0, geo.size.width * value))
            }
        }.frame(height: 7)
    }
}

struct Footer<Content: View>: View {
    var note: String? = nil
    @ViewBuilder let content: Content
    var body: some View {
        HStack(spacing: 8) {
            if let note {
                Text(note).font(.system(size: 12)).foregroundColor(SOFT).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            content
        }
    }
}

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        // Change opens in the window itself, which grows to fit it: as a sheet it was cut off by the short window.
        VStack(alignment: .leading, spacing: 13) {
            if model.showChange { ChangeSheet(model: model, draft: model.pick) } else { screen }
        }
            .padding(.top, 18).padding(.horizontal, 20).padding(.bottom, 16)
            .frame(width: 520, alignment: .topLeading)
            .sheet(isPresented: $model.askCancel) { CancelSheet(model: model) }
    }

    @ViewBuilder var screen: some View {
        switch model.screen {
        case .loading:
            TopRow(title: "Install Lore Forever", detail: "Getting the latest details…")
            Bar(value: 0).opacity(0.4)
            Footer { Button("Cancel") { NSApp.terminate(nil) }.buttonStyle(PlainButton()) }
        case .couldNotLoad:
            TopRow(title: "Can't reach Lore Forever", detail: "Check your connection, then try again.")
            Footer {
                Button("Cancel") { NSApp.terminate(nil) }.buttonStyle(PlainButton())
                Button("Try Again") { Task { await model.load() } }.buttonStyle(GoButton()).keyboardShortcut(.defaultAction)
            }
        case let .findGame(warn):
            TopRow(title: "Where's your game?", detail: "Lore Forever couldn't find World of Warcraft: Forever.")
            if let warn { Text(warn).font(.system(size: 12)).foregroundColor(WARN) }
            Footer {
                Button("Cancel") { NSApp.terminate(nil) }.buttonStyle(PlainButton())
                Button("Choose Folder") { model.chooseFolder() }.buttonStyle(GoButton()).keyboardShortcut(.defaultAction)
            }
        case let .whichCopy(games):
            TopRow(title: "Which copy of the game?", detail: "You have more than one World of Warcraft: Forever.")
            ForEach(games, id: \.self) { game in
                InfoRow(title: game.root.lastPathComponent, detail: breadcrumb(game.root),
                        button: Button("Use This") { model.choose(game) }.buttonStyle(PlainButton()))
            }
        case .ready:
            ready
        case .installing:
            installing
        case .done:
            TopRow(title: "Lore Forever is installed", detail: doneText)
            Footer { Button("Done") { model.quitAndTidy() }.buttonStyle(GoButton()).keyboardShortcut(.defaultAction) }
        case let .partial(names):
            TopRow(title: names.count == 1 ? "Installed, except one part" : "Installed, except \(names.count) parts",
                   detail: "\(names.joined(separator: ", ")) didn't install. Everything else is in place.")
            Footer {
                Button("Done") { model.quitAndTidy() }.buttonStyle(PlainButton())
                Button("Try Again") { model.tryAgainAfterPartial() }.buttonStyle(GoButton()).keyboardShortcut(.defaultAction)
            }
        case let .failed(title, detail):
            TopRow(title: title, detail: detail)
            Footer {
                Button("Close") { model.quitAndTidy() }.buttonStyle(PlainButton())
                Button("Try Again") { model.install() }.buttonStyle(GoButton()).keyboardShortcut(.defaultAction)
            }
        case let .noSpace(need, free):
            TopRow(title: "Not enough space", detail: "\(model.bundleTitle) needs \(formatBytes(need)). You have \(formatBytes(free)) free.")
            Footer {
                Button("Change") { model.showChange = true }.buttonStyle(PlainButton())
                Button("Try Again") { model.install() }.buttonStyle(GoButton()).keyboardShortcut(.defaultAction)
            }
        }
    }

    var doneText: String {
        var text = "Start WoW Forever and choose a keybind when it asks, or type /lore in chat."
        if let note = model.lang?.note, !note.isEmpty { text += " " + note }
        return text
    }

    @ViewBuilder var ready: some View {
        if model.isUpdate {
            let have = BUNDLE_TITLE[model.installedBundle ?? ""] ?? "Lore Forever"
            TopRow(title: "Update Lore Forever", detail: "You have \(have). Your voices stay.")
            InfoRow(title: model.needed.isEmpty ? "You're up to date" : "Add what's new, \(model.sizeText)", detail: model.pickLine,
                    button: Button("Change") { model.showChange = true }.buttonStyle(PlainButton()))
            Footer {
                Button(model.needed.isEmpty ? "Done" : "Update") { model.needed.isEmpty ? model.quitAndTidy() : model.install() }
                    .buttonStyle(GoButton()).keyboardShortcut(.defaultAction)
            }
        } else {
            TopRow(title: "Install Lore Forever")
            InfoRow(title: "\(model.bundleTitle), \(model.cardSizeText)", detail: model.pickLine,
                    button: Button("Change") { model.showChange = true }.buttonStyle(PlainButton()))
            InfoRow(title: "Your game", detail: model.game.map { breadcrumb($0.root) } ?? "",
                    button: Button("Change") { model.chooseFolder() }.buttonStyle(PlainButton()))
            Footer(note: "You have \(formatBytes(model.freeSpace)) free. If WoW is open, close it first, or type /reload in the game afterwards.") {
                Button("Install") { model.install() }.buttonStyle(GoButton()).keyboardShortcut(.defaultAction).disabled(model.needed.isEmpty)
            }
        }
    }

    @ViewBuilder var installing: some View {
        if model.waitingForConnection {
            TopRow(title: "Waiting for your connection",
                   detail: "\(ofText(model.doneBytes, model.totalBytes)). It'll pick up where it left off.")
        } else {
            let verb = model.updating ? "Updating" : "Installing"
            TopRow(title: "\(verb) \(model.bundleTitle)", detail: installingDetail)
        }
        Bar(value: model.progress)
        if !model.waitingForConnection {
            Text("You can keep using your Mac. Your game doesn't change until this finishes.").font(.system(size: 12)).foregroundColor(SOFT)
        }
        Footer {
            if !model.placing { Button("Cancel") { model.askCancel = true }.buttonStyle(PlainButton()) }
        }
    }

    var installingDetail: String {
        if model.placing { return "Putting it in place…" }
        var text = ofText(model.doneBytes, model.totalBytes)
        if let eta = model.etaMinutes {
            text += eta <= 1 ? ", about a minute left" : ", about \(eta) minutes left"
        }
        return text
    }
}

// The same three sizes as the site, in the window, so nobody has to go back to pick.
struct ChangeSheet: View {
    @ObservedObject var model: AppModel
    @State var draft: Pick
    func dismiss() { model.showChange = false }

    var lang: Lang? { model.catalog?.langs.first { $0.code == draft.lang } ?? model.catalog?.langs.first }
    var narrator: Narrator? { lang?.narrators.first { $0.id == draft.narrator } ?? lang?.narrators.first }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(BUNDLES, id: \.self) { key in radio(key) }
            InfoRow(title: "Language and narrator", detail: "\(lang?.name ?? ""), \(narrator?.name ?? "")", button: languageMenu)
            Footer {
                Button("Cancel") { dismiss() }.buttonStyle(PlainButton()).keyboardShortcut(.cancelAction)
                Button("Done") { model.applyChange(draft); dismiss() }
                    .buttonStyle(GoButton()).keyboardShortcut(.defaultAction).disabled(narrator?.cards[draft.bundle]?.ok != true)
            }
        }
    }

    @ViewBuilder func radio(_ key: String) -> some View {
        let card = narrator?.cards[key]
        let ok = card?.ok == true
        let on = draft.bundle == key
        let line = lang?.code == "en" ? ENGLISH_LINE[key] : (card?.lines?.first ?? card?.why)
        // A button over the whole row, so a click anywhere on it (and VoiceOver) picks it.
        Button { if ok { draft.bundle = key } } label: { HStack(alignment: .top, spacing: 9) {
            Circle().strokeBorder(on ? GOLD : SOFT, lineWidth: on ? 4 : 1.5).frame(width: 14, height: 14).padding(.top, 2)
            VStack(alignment: .leading, spacing: 1) {
                Text(ok ? "\(BUNDLE_TITLE[key] ?? key), \(formatBytes(card?.bytes ?? 0))" : (BUNDLE_TITLE[key] ?? key))
                    .font(.system(size: 13, weight: .semibold))
                Text((ok ? line : card?.why) ?? "").font(.system(size: 12)).foregroundColor(SOFT).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 7).fill(ROW))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(on ? GOLD : Color.clear, lineWidth: 1.5))
        .opacity(ok ? 1 : 0.5)
        .contentShape(Rectangle()) }
        .buttonStyle(.plain)
        .disabled(!ok)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    var languageMenu: some View {
        Menu("Choose") {
            ForEach(model.catalog?.langs ?? []) { lang in
                if lang.narrators.count == 1 {
                    Button(lang.name) { set(lang, lang.narrators[0]) }
                } else {
                    Menu(lang.name) {
                        ForEach(lang.narrators) { narrator in
                            Button(narrator.name) { set(lang, narrator) }
                        }
                    }
                }
            }
        }
        .menuStyle(.borderlessButton).fixedSize()
    }

    func set(_ lang: Lang, _ narrator: Narrator) {
        draft.lang = lang.code
        draft.narrator = narrator.id
        if narrator.cards[draft.bundle]?.ok != true {
            draft.bundle = BUNDLES.first { narrator.cards[$0]?.ok == true } ?? "addon"
        }
    }
}

// The bar on the Dock icon while it installs.
final class DockProgress {
    static let shared = DockProgress()
    private let view = BarView()
    func show(_ value: Double) {
        view.value = value
        if NSApp.dockTile.contentView !== view { NSApp.dockTile.contentView = view }
        NSApp.dockTile.display()
    }
    func hide() {
        NSApp.dockTile.contentView = nil
        NSApp.dockTile.display()
    }
    private final class BarView: NSView {
        var value = 0.0
        override func draw(_ dirtyRect: NSRect) {
            NSApp.applicationIconImage?.draw(in: bounds)
            let track = NSRect(x: bounds.width * 0.12, y: bounds.height * 0.1, width: bounds.width * 0.76, height: bounds.height * 0.1)
            NSColor.black.withAlphaComponent(0.7).setFill()
            NSBezierPath(roundedRect: track, xRadius: track.height / 2, yRadius: track.height / 2).fill()
            NSColor(red: 0.878, green: 0.659, blue: 0.290, alpha: 1).setFill()
            var filled = track
            filled.size.width = max(track.height, track.width * value)
            NSBezierPath(roundedRect: filled, xRadius: track.height / 2, yRadius: track.height / 2).fill()
        }
    }
}

// "1.2 of 3.2 GB", or "240 MB of 3.2 GB" when the units differ.
func ofText(_ done: Int64, _ total: Int64) -> String {
    let d = formatBytes(done), t = formatBytes(total)
    let dUnit = d.split(separator: " ").last, tUnit = t.split(separator: " ").last
    if dUnit == tUnit, let n = d.split(separator: " ").first { return "\(n) of \(t)" }
    return "\(d) of \(t)"
}

// Cancel asks first, and says what's downloaded is kept. A sheet in the same look as Change.
struct CancelSheet: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            TopRow(title: "Cancel the install?", detail: "What's downloaded so far is kept for next time.")
            Footer {
                Button("Cancel Install") { dismiss(); model.confirmCancel() }.buttonStyle(PlainButton())
                Button("Keep Installing") { dismiss() }.buttonStyle(GoButton()).keyboardShortcut(.defaultAction)
            }
        }
        .padding(20).frame(width: 420)
    }
}
