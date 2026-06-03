//
//  ContentView.swift
//  Maison · Madame
//
//  Hosts the WebView, manages a launch overlay until the web app's first
//  paint, and handles offline / connection-failure states.
//

import SwiftUI

struct ContentView: View {
    // Live deployment URL. Append ?role=madame so the SPA auto-applies the
    // Madame role and skips the role-picker login on first load.
    private let appURL = URL(string: "https://digitalwardrobe-eta.vercel.app/?role=madame&native=ipad")!

    @State private var isLoading = true
    @State private var loadError: String?

    var body: some View {
        ZStack {
            // Web content
            WebView(url: appURL,
                    isLoading: $isLoading,
                    loadError: $loadError)
                .opacity(isLoading ? 0 : 1)
                .animation(.easeInOut(duration: 0.35), value: isLoading)

            // Launch overlay — shown until the web app fires its first
            // navigation success. Matches the dark/gold palette so the
            // transition into the web view feels seamless.
            if isLoading {
                LaunchOverlay()
                    .transition(.opacity)
            }

            // Error overlay — shown on offline / DNS / 5xx failures.
            // The user can retry without restarting the app.
            if let err = loadError {
                OfflineOverlay(message: err) {
                    loadError = nil
                    isLoading = true
                    // The WebView wrapper observes loadError and triggers
                    // a fresh load when it transitions to nil.
                    NotificationCenter.default.post(name: .maisonReload, object: nil)
                }
            }
        }
        .background(Color.black.ignoresSafeArea())
    }
}

// MARK: - Launch overlay (matches the Madame splash aesthetic)

private struct LaunchOverlay: View {
    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            Text("MAISON")
                .font(.system(size: 18, weight: .semibold, design: .default))
                .tracking(8)
                .foregroundColor(Color(red: 0.96, green: 0.83, blue: 0.47)) // gold-bright
            Text("Wardrobe Intelligence")
                .font(.system(size: 13, weight: .light, design: .serif))
                .italic()
                .foregroundColor(Color(white: 0.85))
            Spacer()
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: Color(red: 0.96, green: 0.83, blue: 0.47)))
            Text("Preparing your wardrobe…")
                .font(.system(size: 11, weight: .regular, design: .default))
                .tracking(2)
                .textCase(.uppercase)
                .foregroundColor(Color(white: 0.55))
                .padding(.bottom, 60)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(
                gradient: Gradient(colors: [
                    Color(red: 0.04, green: 0.025, blue: 0.02),
                    Color(red: 0.11, green: 0.07, blue: 0.05),
                    Color(red: 0.04, green: 0.025, blue: 0.02)
                ]),
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
        )
    }
}

// MARK: - Offline / load-error overlay

private struct OfflineOverlay: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 38, weight: .light))
                .foregroundColor(Color(red: 0.96, green: 0.83, blue: 0.47))
            Text("Can't reach the wardrobe")
                .font(.system(size: 22, weight: .light, design: .serif))
                .foregroundColor(.white)
            Text(message)
                .font(.system(size: 13))
                .foregroundColor(Color(white: 0.7))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button(action: onRetry) {
                Text("Try again")
                    .font(.system(size: 13, weight: .semibold))
                    .tracking(2)
                    .textCase(.uppercase)
                    .foregroundColor(.black)
                    .padding(.horizontal, 28)
                    .padding(.vertical, 12)
                    .background(
                        LinearGradient(
                            gradient: Gradient(colors: [
                                Color(red: 0.98, green: 0.85, blue: 0.50),
                                Color(red: 0.85, green: 0.68, blue: 0.30)
                            ]),
                            startPoint: .top, endPoint: .bottom
                        )
                    )
                    .clipShape(Capsule())
            }
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.92).ignoresSafeArea())
    }
}

extension Notification.Name {
    static let maisonReload = Notification.Name("MaisonReloadRequested")
}

#Preview {
    ContentView()
}
