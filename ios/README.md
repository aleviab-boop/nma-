# Maison · Madame — iPad App

A native iPadOS shell around the **NMA Mam (Madame)** view from the Maison
Wardrobe Intelligence SPA. Built as a SwiftUI app that hosts the live web
deployment (`digitalwardrobe-eta.vercel.app`) inside a `WKWebView`.

**Why a wrapper, not a full Swift rewrite:**
- Updates ship instantly — push to Vercel and the iPad picks it up on next
  launch, no App Store re-submission.
- Single codebase — every fix you make in `index.html` benefits both web
  and iPad.
- Camera / VTO / Realtime / localStorage all work natively in WKWebView.
- Lets you put it on a real iPad in under 15 minutes.

---

## What's in this folder

```
ios/
  MaisonMadame/
    MaisonMadameApp.swift   ← App entry point (SwiftUI)
    ContentView.swift       ← Main view with launch + offline overlays
    WebView.swift           ← WKWebView UIViewRepresentable wrapper
    Info.plist              ← App permissions, iPad-only, orientation
    LaunchScreen.storyboard ← Splash screen ("MAISON · Wardrobe Intelligence")
  README.md                 ← This file
```

You'll add an `Assets.xcassets` and `AppIcon` set in Xcode (see step 4).

---

## Setup in Xcode (one-time, ~15 min)

### 1. Create the project

1. Open **Xcode** → **File → New → Project…**
2. Choose **iOS → App** → Next
3. Fill in:
   - **Product Name**: `MaisonMadame`
   - **Team**: pick yours (Personal Team is fine for testing)
   - **Organization Identifier**: `com.aleviab` (or anything unique to you)
   - **Bundle Identifier** auto-fills as `com.aleviab.MaisonMadame`
   - **Interface**: SwiftUI
   - **Language**: Swift
   - **Storage**: None
   - Uncheck "Include Tests"
4. Save the project anywhere (e.g. Documents/Maison-iPad).

### 2. Replace the auto-generated files

Xcode created stub files like `MaisonMadameApp.swift` and `ContentView.swift`.
Open this folder in Finder:

```
/Users/aleviabandyopadhyay/Downloads/maison-project/ios/MaisonMadame/
```

For each `.swift` file:
1. Open the file in Xcode (`MaisonMadameApp.swift`, `ContentView.swift`)
2. **Select all** in Xcode (⌘A) → delete
3. Open the matching file from this folder in any text editor
4. Paste the contents into Xcode

Then add the new files:
1. Drag `WebView.swift` from Finder into Xcode's project navigator (left panel)
2. Drag `LaunchScreen.storyboard` in too
3. When prompted, leave "Copy items if needed" **checked** and add to the
   `MaisonMadame` target.

### 3. Configure Info.plist

Xcode generates a default Info.plist. Either:

**(a) Replace it wholesale** — drag the `Info.plist` from this folder over
the Xcode one (replace when prompted).

**(b) Merge by hand** — in Xcode, select the project root in the navigator,
go to the **Info** tab, and add these keys:

| Key | Type | Value |
|-----|------|-------|
| `NSCameraUsageDescription` | String | Maison uses the camera so Madame can try on garments with Virtual Try-On. |
| `NSPhotoLibraryUsageDescription` | String | Maison can use a photo from your library as the VTO canvas. |
| `NSMicrophoneUsageDescription` | String | Maison uses voice search to find pieces. |
| `UIStatusBarHidden` | Boolean | YES |
| `UIRequiresFullScreen` | Boolean | YES |
| `UILaunchStoryboardName` | String | LaunchScreen |

Under **General → Deployment Info**:
- Targets: **iPad** only (uncheck iPhone)
- Minimum Deployments: iOS 15.0+
- Status Bar Style: **Default (Hidden)**
- Orientation: check all 4 (landscape L/R + portrait + upside-down)
- Requires Full Screen: **checked**

### 4. App icon (optional but nice)

1. Open `Assets.xcassets` in the project navigator
2. Click `AppIcon`
3. Drag your 1024×1024 icon PNG into the 1024pt iOS slot
4. Xcode auto-generates the smaller sizes

A starter icon idea: gold "M" monogram on `#0B0604` background. Free
generator: https://appicon.co — upload one 1024×1024 PNG, download the
.iconset, drag into Xcode.

### 5. Run it

- Plug in your iPad (or use the simulator: any iPad model, iOS 17+)
- Pick the device/simulator from the run-target dropdown at the top
- Press ⌘R

The app launches into the dark splash → fades into the Madame view.

---

## Installing on a real iPad

### TestFlight (best — official, no time limit)

1. In Xcode: **Product → Archive** (this signs the build)
2. In Window → Organizer → Archives, select your archive → **Distribute App**
3. Choose **App Store Connect** → Upload
4. Wait ~10 min for Apple to process
5. In https://appstoreconnect.apple.com → TestFlight → invite yourself by email
6. Install **TestFlight** on the iPad → tap the invite → install Maison

### Personal-team direct install (free, expires after 7 days)

1. Plug iPad into Mac
2. In Xcode top bar, pick your iPad as the run target
3. Press ⌘R → the app installs and runs
4. On the iPad: **Settings → General → VPN & Device Management** → trust
   your developer certificate
5. The app stays installed but stops launching after 7 days; rerun ⌘R to
   refresh it.

---

## How the app talks to the web app

| Concern | How it's handled |
|---------|------------------|
| Auto-Madame role | URL is `?role=madame&native=ipad`; SPA reads the param at boot and applies `role-madame` body class |
| Skipping role picker | The native shell injects `window.__MAISON_NATIVE__ = 'ipad'` at document-start; SPA's `_autoRoleFromShellOrQuery()` IIFE detects it and applies Madame mode |
| localStorage persistence | `WKWebsiteDataStore.default()` is disk-backed, so saved looks / hearts / pick list survive app restarts |
| Camera (VTO) | `WKWebViewConfiguration.allowsInlineMediaPlayback = true` + iOS permission grant on first prompt |
| Network failures | The Coordinator catches `didFail` / `didFailProvisionalNavigation`, shows the OfflineOverlay with a Try Again button |
| Status bar | Hidden via SwiftUI `.statusBarHidden(true)` AND `UIStatusBarHidden=YES` in Info.plist (belt-and-braces) |

If you want to lock the iPad app to a specific deploy URL (e.g. staging
vs prod), edit the `appURL` constant at the top of `ContentView.swift`.

---

## Common issues

**"Cannot find ContentView in scope"** — make sure all three Swift files
are added to the `MaisonMadame` target. Click the file in the navigator,
look at the right-side panel "Target Membership", check the box.

**Blank screen on first launch** — check that the deploy URL in
`ContentView.swift` matches your Vercel deployment. Default is
`https://digitalwardrobe-eta.vercel.app/?role=madame&native=ipad`.

**Camera prompt loops forever** — make sure
`NSCameraUsageDescription` is set in Info.plist. Apple rejects the
permission silently if the description string is missing.

**iPad split-view shows the app at half width** — that's
`UIRequiresFullScreen` not set in Info.plist. Add it as a boolean YES.

---

## Updating after deployment

You don't need to rebuild the app for content changes. Every time you
push to `main` and run `bash deploy_now.sh`, the next iPad launch picks
up the new code automatically (the WebView reloads on each app start).

You only need to rebuild + redistribute the iPad app when:
- The Vercel deploy URL changes
- You modify any `.swift` file or `Info.plist`
- You want to update the splash screen or app icon

---

## Project files at a glance

- **`MaisonMadameApp.swift`** — `@main` SwiftUI app, one window, dark scheme, status bar hidden.
- **`ContentView.swift`** — hosts the WebView; shows a Maison splash while the web app paints; offline overlay with retry button.
- **`WebView.swift`** — `UIViewRepresentable` wrapper around `WKWebView`. Sets up persistent storage, inline media, document-start `__MAISON_NATIVE__` marker, and auto-grants camera/mic.
- **`Info.plist`** — iPad-only, full-screen, status bar hidden, ATS enforcing HTTPS, camera/mic/photo strings.
- **`LaunchScreen.storyboard`** — dark gradient with gold "MAISON" + italic "Wardrobe Intelligence" subtitle.

That's it. Ship it.
