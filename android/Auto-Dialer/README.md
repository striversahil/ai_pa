# Mini Auto Dialer (Android)

An offline calling assistant and mini CRM for sales and support teams. Import your customers, call them one after another, record the outcome of every call, keep the call recordings linked to each customer, and never miss a callback.

- **Platform:** Android 8.0 (API 26) to Android 15 (API 35)
- **Tech:** Kotlin, Jetpack Compose (Material 3), Room, Navigation Compose
- **Package:** `com.miniautodialer.app` · version 1.2.1
- **Home → "All phone calls" (1.2.1):** the agent's own totals for the chosen range read from the phone's call log, so normal-dialer calls count too: all calls, connected, outgoing, incoming answered, missed / rejected, talk time.
- **Bottom bar:** Home · Callbacks · **Dialer** (big centre button, opens first) · Records · Settings. Lists and Customers are no longer tabs (Home still links to them).
- **Founder OS:** once paired, the **Dialer** tab auto-dials leads pushed from Founder OS (Sales → Controller → Auto Dialer) and syncs calls, dispositions, breaks and recordings back. Unpaired, the app works fully offline as before.
  - **Phone-dialer calls (1.2.0):** calls made or received in the phone's own dialer are read from the call log and reported too (Controller switch "Phone dialer calls"; report column *Phone dialer*). Their recordings upload like dialer calls.
  - **Scheduled breaks (1.2.0):** windows the sales head sets in the Controller (everyone or chosen agents) lock auto-dial and manual dial until they end.
  - **Retry cap:** a busy / not-answered lead comes back until the Controller's "Stop re-queuing after N tries"; then it is marked not reachable and never dialed again.
  - **Reinstall keeps the connection (1.2.0):** a phone still paired in Founder OS reconnects by itself after a reinstall (same phone id, no new code), as long as the APK is signed with the shared key (below). Unpairing in the Controller stops this.
  - **Recordings** need the phone's own auto call recording switched on; the Dialer tab warns when calls connect but no recordings appear.
- **Get the APK:** built in the cloud by GitHub Actions; see [Building in the cloud (recommended)](#building-in-the-cloud-recommended).

---

## Contents

1. [Features](#features)
2. [How call recording works](#how-call-recording-works)
3. [Supported phones](#supported-phones)
4. [Installing on a phone](#installing-on-a-phone)
5. [First-time setup (per phone)](#first-time-setup-per-phone)
6. [Daily use](#daily-use)
7. [Call outcomes](#call-outcomes)
8. [Settings reference](#settings-reference)
9. [Permissions](#permissions)
10. [Building in the cloud (recommended)](#building-in-the-cloud-recommended) · [Building from source](#building-from-source)
11. [Project structure](#project-structure)
12. [Troubleshooting](#troubleshooting)
13. [Known limitations](#known-limitations)

---

## Features

### Customers
- Import from **Excel (.xlsx)**, **CSV**, or the **phone's contacts**. Columns (name, phone, company, city, remarks…) are detected automatically.
- Duplicate numbers are merged: `+91 98123 45678`, `098123 45678` and `9812345678` are treated as the same customer.
- Search, filter, add, edit and delete customers. Each customer page shows their calls, recordings and follow-ups.

### Calling lists (campaigns)
- Group customers into lists (six default lists are created on first launch).
- The calling screen shows one customer at a time with a large **Call** button, then **Save & next customer**.
- The app remembers where you stopped and shows pending versus called customers.
- Re-queue customers who were busy or did not answer, and export a list's results.

### Dial pad (manual dialing)
- Built-in dial pad (Home → **Dial a number**, or the dial-pad button on Home and Customers).
- Recognises existing customers as you type. An unknown number is saved as a new customer, with an optional name.
- Optional: **track calls made from the phone's own dialer** too (Settings → Manual dialing).

### Call logging
- After every call the app reads Android's call log to get the real **talk time** and status.
- It **suggests an outcome**: 0 seconds means *Not answered*, and a long call means *Connected*. For short calls (default under 30s) it asks you to choose. In India a declined or unanswered call is often connected to a network announcement, which counts as talk time, so the app cannot know.
- Add remarks and schedule a callback in the same screen. You can edit or delete any past call later.

### Recordings
- Finds the phone's own call recordings **automatically, in any folder**, with no folder setup. New recordings are picked up within seconds of being saved.
- Links each recording to the right customer and call (see [How call recording works](#how-call-recording-works)).
- Play at 1x/1.5x/2x, search, rename, re-assign, share/export, save to device, and delete.
- Recordings shared to the app from another app (for example Google Phone) are imported and linked as well.

### Follow-ups and reminders
- Today, Upcoming, Overdue and Completed views.
- Exact-time reminder notifications with a **Call now** action.
- Reminders survive a phone restart.

### Dashboard and reports
- KPIs for today, week, month and all time: contacts, calls, connected, busy, not answered, interested, callbacks, pending follow-ups, connected time and recordings.
- Daily, weekly and monthly reports, plus the full customer calling history, export to **Excel, CSV or PDF**.

### Backup and restore
- One `.zip` file (database + recordings) saved wherever you choose: phone storage, a USB drive, Google Drive via the file picker, and so on.
- Restore it on the same phone or a new one.

---

## How call recording works

**Android does not allow normal apps to record phone calls.** Since Android 9, only the phone maker's built-in dialer can record call audio, and no permission changes that. So this app does not record calls itself. Instead:

1. **The phone's own dialer records the call.** Auto-record is turned on once in the dialer's settings.
2. **The app finds the recording automatically.** It watches Android's media index (MediaStore) for new audio files in *any* folder, so it does not need to know where each brand saves its files. Music, ringtones and WhatsApp voice notes are ignored.
3. **The app links it to the customer**, trying in order:
   1. a **phone number in the file name** (for example Lava: `sim2-Name-+9198…-voicecall-2026-11-19_12.46.35.amr`);
   2. a **contact name in the file name** (for example Samsung and Realme: `Name_241118_143005`);
   3. **the call time**: the recording's time (from the file name or the file's save time) is matched to a call logged at that moment. This works whatever the file is called, including Google Phone's `record-<timestamp>.m4a`.
4. Anything that cannot be matched appears under **Records → Not linked to a customer**. Tap it and choose **Assign**.

Recordings are **copied** into the app's private storage. The originals in the phone's recorder folder are never changed or deleted.

By default only recordings that match a customer are imported, so personal calls stay out of the app. To import everything, turn on Settings → *Also import recordings that don't match a customer*.

> **Legal note:** inform customers that calls may be recorded wherever the law requires it.

---

## Supported phones

| Phone / dialer | Built-in auto-record | Works automatically with this app? |
|---|---|---|
| Xiaomi / Redmi / Poco (MIUI / HyperOS dialer) | Yes | **Yes** |
| Samsung (One UI dialer) | Yes | **Yes** |
| Realme / Oppo / OnePlus (ColorOS dialer) | Yes | **Yes** |
| Vivo, Lava, Unisoc-based and most Indian brands | Yes | **Yes** |
| Phones using **Google Phone** (Nokia, Motorola, Pixel, some others) | Only unknown or selected numbers, stored inside Google Phone | **Partly.** Share each recording to the app (see below). |
| Phones without any call recorder | No | No recordings (calls, outcomes and follow-ups still work) |

Tested on: Realme RMX3933 (Android 15), Realme 1, OnePlus 7, Lava LZX409 (Android 13), Nokia 5.3 (Android 12).

### Google Phone phones
Google Phone keeps recordings inside its own app, where other apps cannot read them. After a call:
**Phone → Recents → tap the call → Share audio file → Mini Auto Dialer.**
The app imports the recording and links it to the call by time.

---

## Installing on a phone

The app is installed directly (sideloaded) as an APK. See [Known limitations](#known-limitations) about the Play Store.

### Option A: copy the APK to the phone
1. Copy `app-debug.apk` (or your release APK) to the phone.
2. Open it, allow **Install unknown apps** for your file manager when asked, and install.

### Option B: over USB with adb
1. On the phone: **Settings → About phone → tap Build number 7 times**, then **Developer options → USB debugging: On**.
2. Connect over USB and accept the "Allow USB debugging" prompt.
3. Install, granting all permissions in one step:
   ```powershell
   C:\Users\LENOVO\AndroidDev\sdk\platform-tools\adb.exe install -r -g app\build\outputs\apk\debug\app-debug.apk
   ```

---

## First-time setup (per phone)

1. **Open the app** and allow the permissions it asks for (notifications, audio files; phone and call log on the first call).
2. **Turn on auto call recording in the phone's dialer**, for example:
   - Xiaomi: Phone → ⋮ → Settings → Call recording → Record calls automatically
   - Samsung: Phone → ⋮ → Settings → Record calls → Auto record calls
   - Realme / Oppo / OnePlus: Phone → ⋮ → Settings → Call recording → Record all calls
   - Lava and other AOSP dialers: Phone → ⋮ → Settings → Call recording → Auto record
   - Google Phone: Phone → ☰ → Settings → Call recording → Automatically record unknown numbers / these numbers
3. **Battery:** Settings → Apps → Mini Auto Dialer → Battery → **Unrestricted**, so reminders arrive on time and new recordings are picked up promptly.
4. **Exact alarms** (Android 12+): if Settings in the app shows *Allow exact alarms*, tap it and allow.
5. **Import customers:** Home → Import Excel/CSV, or Phone contacts.
6. **Past recordings (optional):** Settings → **Find older recordings** links recordings already on the phone to your customers.
7. **Test:** call a test number from the app, save the outcome, and check that the recording appears under **Records** linked to that customer.

---

## Daily use

1. **Lists** → open a list → **Start calling** (or **Resume calling**).
2. Tap **Call**. The phone dials, and you talk.
3. When you return to the app, the **Call outcome** screen opens with the talk time filled in. Pick an outcome, add remarks, and set a callback if needed.
4. **Save & next customer** moves to the next customer.
5. Callbacks appear under **Callbacks** and as notifications at the set time.
6. Check **Home** for today's numbers and **Reports** for exports.

---

## Call outcomes

| Outcome | Counts as reached |
|---|---|
| Connected | ✓ |
| Interested | ✓ |
| Not Interested | ✓ |
| Callback Required | ✓ |
| Follow-up Required | ✓ |
| Busy | |
| Wrong Number | |
| Not Answered | |
| Rejected | |
| Call Failed | |

Reports count a call as *connected* from the chosen outcome, not from the talk time, because network announcements make unanswered calls show talk time.

---

## Settings reference

| Setting | What it does |
|---|---|
| Permissions list | Shows each permission and lets you grant missing ones |
| Allow exact alarms | Needed for on-time reminders on Android 12+ |
| Open dial pad | Opens the built-in dial pad |
| Track calls made from the phone's dialer | Also logs calls you make outside the app, for numbers that are customers |
| Also track numbers that aren't customers | With the above, creates customers for unknown numbers you call |
| Call outcome: Off / 15 / 30 / 45 / 60s | Calls shorter than this ask you to choose the outcome instead of assuming *Connected* |
| Recordings: Scan now | Checks for new recordings immediately (normally automatic) |
| Find older recordings | Searches all existing recordings on the phone for your customers |
| Also import recordings that don't match a customer | Imports every call recording, not only customers' |
| Extra folder (optional) | Adds a folder for a recorder whose files are not found automatically |
| Back up / Restore | Saves or restores all data and recordings as a .zip |
| Reports | Daily / weekly / monthly reports and exports |

---

## Permissions

| Permission | Why |
|---|---|
| `CALL_PHONE` | Place calls directly from the app |
| `READ_CALL_LOG` | Read talk time and status after each call; optional tracking of dialer calls |
| `READ_CONTACTS` | Import customers from phone contacts |
| `READ_MEDIA_AUDIO` (Android 13+) / `READ_EXTERNAL_STORAGE` (Android 12 and lower) | Find call recordings in any folder (read-only) |
| `POST_NOTIFICATIONS` | Follow-up reminders |
| `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` | Reminders at the exact time |
| `RECEIVE_BOOT_COMPLETED` | Restore reminders after a restart |
| `VIBRATE` | Reminder vibration |
| `INTERNET` / `ACCESS_NETWORK_STATE` | Founder OS pairing and sync (only after the phone is paired) |

Nothing is sent anywhere until the phone is paired with Founder OS. Android auto-backup is disabled; use the app's own Backup.

---

## Building in the cloud (recommended)

A local Android build needs a JDK, the Android SDK and Gradle (about 2 GB) and several GB of RAM;
on a small machine or inside WSL it can freeze the system. GitHub builds the APK for you instead:
workflow [`.github/workflows/android-apk.yml`](../../.github/workflows/android-apk.yml).

### When it runs
- Automatically on every push that changes `android/Auto-Dialer/**` (any branch).
- Manually: GitHub → **Actions → Android APK → Run workflow** → pick the branch.

It takes about 4–6 minutes and also runs the unit tests.

### Getting the APK
- **Founder OS (easiest):** Sales → Controller → Auto Dialer shows the newest version with
  **Download APK**. The file is served by Founder OS itself (`/api/dialer/app/download`, sales head /
  root only), so the browser never sees the GitHub address. Open the Controller on the agent's phone
  and tap Download to install directly.
- **Fixed link:** every build on `main` or a `feat/auto-dialer*` branch is published to the rolling
  release `auto-dialer-latest`, so this link always serves the newest APK:
  `https://github.com/striversahil/ai_pa/releases/download/auto-dialer-latest/auto-dialer.apk`
  (version details: `.../auto-dialer-latest/auto-dialer.json`). The repository is public, so the link needs no login.
- **Browser:** open the finished run under **Actions → Android APK** and download the
  **auto-dialer-apk** artifact (a zip containing `auto-dialer-<version>.apk`; kept 30 days).
- **Command line** (with the GitHub CLI logged in):
  ```bash
  gh run download --repo striversahil/ai_pa -n auto-dialer-apk -D ./apk-download
  ```
  This downloads the latest run's APK. Add a run id (`gh run list --workflow android-apk.yml`) to pick a specific one.

Then install it with [Option A or B](#installing-on-a-phone), e.g.
`adb install -r -g apk-download/auto-dialer-1.1.0.apk`.

### Signing key (one-time setup)
Android only installs an update over an existing app if both are signed with the **same key**.
The workflow signs with the key in the repository secret **`ANDROID_DEBUG_KEYSTORE_BASE64`**
(a base64-encoded `debug.keystore`, password `android`, alias `androiddebugkey`).

- Set it once from a machine that has the keystore:
  ```bash
  base64 -w0 ~/.android/debug.keystore | gh secret set ANDROID_DEBUG_KEYSTORE_BASE64 --repo striversahil/ai_pa
  ```
  If no keystore exists yet, create one:
  `keytool -genkeypair -keystore ~/.android/debug.keystore -storepass android -keypass android -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -validity 10000`.
- Without the secret, each run uses a throwaway key (the run shows a warning, the release JSON says
  `"stableKey": false` and the Controller's Download card warns) and phones must **uninstall** the
  old app first, which deletes its local data.
- The shared key also keeps the phone id (Android's `ANDROID_ID` is per signing key), which is how a
  reinstalled app reconnects to Founder OS without a new pairing code.
- If an install fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, the phone has an APK signed
  with a different key: back up in the app (Settings → Back up), uninstall, install, restore.

### Releasing a new version
Bump `versionCode` (+1) and `versionName` in `app/build.gradle.kts`, push, and download the new artifact.

---

## Building from source

Prefer the [cloud build](#building-in-the-cloud-recommended); build locally only on a machine with 8 GB+ RAM free.

### Requirements
- JDK 17
- Android SDK with platform 35 and build-tools
- No Android Studio required (Android Studio also works: open the folder as a project)

### Configure the SDK path
Create `local.properties` in the project root (not included in the zip, because it is machine-specific):
```properties
sdk.dir=C\:/Users/<you>/AndroidDev/sdk
```
Alternatively, set the `ANDROID_HOME` environment variable.

### Build and test
```powershell
$env:JAVA_HOME="C:\Users\LENOVO\AndroidDev\jdk\jdk-17.0.21.1+2"
.\gradlew assembleDebug testDebugUnitTest
```
Output APK: `app\build\outputs\apk\debug\app-debug.apk`

### Release build
1. Create a keystore:
   ```powershell
   keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias minidialer
   ```
2. Add a `signingConfigs` block to `app/build.gradle.kts` that points to it, and use it in `buildTypes.release`.
3. `.\gradlew assembleRelease` produces `app\build\outputs\apk\release\app-release.apk`.

Keep the keystore safe: updates must be signed with the same key.

### Stack
Kotlin 2.0.21 · AGP 8.7.3 · Compose (Material 3) · Room 2.6.1 (KSP) · Navigation Compose · minSdk 26 · targetSdk 35

---

## Project structure

```
app/src/main/java/com/miniautodialer/app/
├── MiniDialerApp.kt          App start-up; watches MediaStore for new recordings
├── data/
│   ├── Entities.kt           Customer, Campaign, CallRecord, Recording, FollowUp; Outcome rules
│   ├── Daos.kt               Room queries
│   ├── AppDatabase.kt        Room database
│   ├── Prefs.kt              Settings
│   └── Repo.kt               Business operations (save call, find/create customer, …)
├── notify/Notify.kt          Reminder alarms, notifications, boot receiver
├── remote/                   Founder OS: Session (token), Api, Outbox + SyncRunner (WorkManager),
│                             DialerConfig, AutoDialer (dial loop, disposition timer, breaks)
├── ui/
│   ├── MainActivity.kt       Navigation, permissions, share-import, post-call handling
│   ├── Components.kt         Shared UI pieces (audio player, dialogs, cards)
│   └── screens/              Dashboard, Lists, Customers, Dial pad, Calling/outcome,
│                             Follow-ups, Recordings, Import, Reports & Settings
└── util/
    ├── CallManager.kt        Places calls, reads the call log, pending-call state
    ├── DialerSync.kt         Tracks calls made from the phone's own dialer
    ├── RecordingImporter.kt  Finds, imports and matches recordings
    ├── PhoneUtil.kt          Phone number normalisation
    ├── TableReader.kt        .xlsx / .csv reader
    ├── XlsxWriter.kt, PdfWriter.kt, Reports.kt   Exports and reports
    ├── Backup.kt             Backup / restore .zip
    └── Fmt.kt                Date, time and size formatting
app/src/test/.../ParsingTest.kt   Unit tests (file-name parsing, outcomes, phone numbers)
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Recordings don't appear | Check that auto-record is on in the phone's dialer and that **Audio files** is allowed (Settings → Permissions). Then use Records → ⟳ (Find new recordings). |
| Recording shows "Unassigned" | The number or time didn't match a customer. Tap it → **Assign**. Make sure the call was saved in the app. |
| Google Phone recordings missing | Expected: share them from Phone → Recents → Share audio file → Mini Auto Dialer. |
| Outcome screen doesn't open after a call | Allow **Call log** permission. Return to the app after the call ends. |
| Unanswered call shown with talk time | Network announcement. Pick *Not Answered*; adjust the threshold in Settings → Call outcome. |
| Reminders late or missing | Battery → Unrestricted, and allow exact alarms and notifications. |
| OnePlus/Oppo: `adb install -g` permissions rejected | Enable *Developer options → Disable permission monitoring*, or grant permissions in the app. |
| Contacts import shows 0 | Allow **Contacts** permission. |

---

## Known limitations

- **Call audio cannot be recorded by the app itself** (an Android restriction). Recording depends on the phone's built-in recorder.
- **Google Phone** keeps recordings private, so each one must be shared to the app manually.
- **Google Play:** `READ_CALL_LOG` is restricted on the Play Store to apps that are the default dialer, so the app is meant to be **sideloaded or deployed through MDM**, not published on Play as-is.
- Brand dialers sometimes change their file naming in updates. Time-based matching covers most cases, and unmatched files can be assigned by hand.
- Data lives only on the phone. Use **Backup** regularly.
