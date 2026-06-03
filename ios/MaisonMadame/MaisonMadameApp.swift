//
//  MaisonMadameApp.swift
//  Maison · Madame
//
//  Entry point for the iPad app. Just hosts the ContentView which loads
//  the NMA Madame web experience in a WKWebView. The web app remains the
//  source of truth — this shell only provides the native chrome (status
//  bar handling, orientation lock, app icon, splash).
//

import SwiftUI

@main
struct MaisonMadameApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .ignoresSafeArea()           // full-bleed; the web app has its own header
                .preferredColorScheme(.dark) // matches the gold-on-black palette
                .statusBarHidden(true)       // immersive — no system status bar
        }
    }
}
