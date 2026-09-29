// swift-tools-version: 5.9
import PackageDescription

// Capacitor 8 يربط ملحقات iOS عبر Swift Package Manager افتراضياً؛
// الـ podspec المجاور يبقى لمن يستخدم CocoaPods.
let package = Package(
    name: "DawaatContactPicker",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "DawaatContactPicker",
            targets: ["ContactPickerPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "ContactPickerPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/ContactPickerPlugin",
            linkerSettings: [
                .linkedFramework("Contacts"),
                .linkedFramework("ContactsUI")
            ])
    ]
)
