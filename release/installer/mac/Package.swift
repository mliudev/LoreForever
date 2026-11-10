// swift-tools-version:5.7
// Install Lore Forever for Mac (LOR-1348): the one-button installer, doing on a Mac what LoreForever-Setup.exe does on
// Windows. build.sh builds this into "Install Lore Forever.app"; no Python and no third-party code.
import PackageDescription

let package = Package(
    name: "InstallLoreForever",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "InstallLoreForever", path: "Sources/InstallLoreForever", swiftSettings: [
            // Compiled in only by build.sh --qa: a local catalog, a scratch game folder, the state renders.
            .define("QA", .when(configuration: .debug)),
        ]),
    ],
    swiftLanguageVersions: [.v5]
)
