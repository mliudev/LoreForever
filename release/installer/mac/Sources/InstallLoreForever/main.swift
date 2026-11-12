import AppKit
import Combine
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let model = AppModel()
    var window: NSWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        #if QA
        if QARender.runIfAsked(model: model) { return }
        #endif
        NSApp.appearance = NSAppearance(named: .darkAqua)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 200), styleMask: [.titled, .closable, .miniaturizable],
                          backing: .buffered, defer: false)
        window.title = "Install Lore Forever"
        window.delegate = self
        window.isReleasedWhenClosed = false
        let hosting = NSHostingView(rootView: ContentView(model: model))
        hosting.sizingOptions = [.minSize, .intrinsicContentSize, .maxSize]
        window.contentView = hosting
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        model.start()
        observeTitle()
        #if QA
        QARender.autorunIfAsked(model: model)
        #endif
    }

    // After every change the window takes its title and the height of what it shows, keeping its top edge where it is:
    // a fixed window clipped the Change choices on Silver (LOR-1398).
    private var watch: AnyCancellable?
    private func observeTitle() {
        watch = model.objectWillChange.sink { [weak self] _ in
            DispatchQueue.main.async { DispatchQueue.main.async { self?.fit() } }
        }
        fit()
    }

    private func fit() {
        let title = model.updating ? "Update Lore Forever" : "Install Lore Forever"
        if window.title != title { window.title = title }
        guard let content = window.contentView else { return }
        content.layoutSubtreeIfNeeded()
        let height = content.fittingSize.height
        let current = window.contentRect(forFrameRect: window.frame)
        guard height > 0, abs(current.height - height) > 0.5 else { return }
        var frame = window.frameRect(forContentRect: NSRect(x: current.minX, y: current.maxY - height, width: current.width, height: height))
        frame.origin.x = window.frame.minX
        window.setFrame(frame, display: true, animate: false)
    }

    // Closing the window while it installs goes through Cancel's question.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if case .installing = model.screen {
            model.askCancel = true
            return false
        }
        NSApp.terminate(nil)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
