import AppKit
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
        hosting.sizingOptions = [.intrinsicContentSize]
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

    private var titleTimer: Timer?
    private func observeTitle() {
        titleTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self else { return }
            let title = self.model.screen == .ready && self.model.isUpdate ? "Update Lore Forever" : "Install Lore Forever"
            if self.window.title != title { self.window.title = title }
        }
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
