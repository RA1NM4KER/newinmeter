# Newinmeter Setup

This guide now covers both local ingestion paths:

1. recommended: fetch ledger data from the LiveMopay web app API
2. fallback: capture ledger data from the Android app with ADB

The ADB path still works, but it is no longer the recommended setup out of the box.

If you are setting up the full dashboard, make sure you also apply all Supabase migrations from `README.md`. The local steps here are only for capture and refresh.

Both paths below write into the same multi-user Supabase schema the hosted app uses, scoped to
one `connection_id`. Set `NEWINMETER_LEGACY_TARGET_USER_ID` in `.env.local` to your own Supabase
Auth user id before running either -- the sync script refuses to run without it, and refuses to
guess if it doesn't resolve to exactly one non-demo connection. See
[legacy/adb-ingestion/README.md](./legacy/adb-ingestion/README.md).

## Recommended: Web API Refresh

The recommended local refresh path is:

    python3 legacy/adb-ingestion/refresh_and_sync.py --source web

This path does not need Android Studio, an emulator, or USB debugging.

It:

1. signs into the LiveMopay web stack
2. reuses or refreshes a saved auth session
3. fetches ledger rows from the web API
4. writes `livemopay_energy.csv`
5. syncs the rows to Supabase

Add these to `.env.local`:

    SUPABASE_URL=...
    SUPABASE_SERVICE_ROLE_KEY=...
    NEWINMETER_LEGACY_TARGET_USER_ID=uuid-of-your-own-supabase-auth-user
    NEWINMETER_WEB_EMAIL=you@example.com
    NEWINMETER_WEB_PASSWORD=your-livewallet-password
    NEWINMETER_FIREBASE_API_KEY=your-firebase-web-api-key
    NEWINMETER_ACCOUNT_ID=your-account-id

Optional overrides:

    NEWINMETER_COMPANY_ID=your-company-id
    NEWINMETER_PROPERTY_ID=your-property-id
    NEWINMETER_WEB_BASE_URL=https://app.propertywallet.co.za
    NEWINMETER_WEB_PORTAL_ORIGIN=https://app.livewalletportal.co.za
    NEWINMETER_WEB_SESSION_PATH=.secrets/livemopay_auth.json
    NEWINMETER_WEB_AUTH_HEADER=Authorization
    NEWINMETER_WEB_AUTH_SCHEME=Bearer
    NEWINMETER_WEB_APP_FLAVOR=livemopay
    NEWINMETER_WEB_REFRESH_BUFFER_SECONDS=300
    NEWINMETER_WEB_START_DATE=2026-01-01
    NEWINMETER_TIMEZONE=Africa/Johannesburg

Run it:

    python3 legacy/adb-ingestion/refresh_and_sync.py --source web

For a full historical rebuild:

    python3 legacy/adb-ingestion/refresh_and_sync.py --source web --full

To sync the existing CSV without refetching:

    python3 legacy/adb-ingestion/refresh_and_sync.py --skip-capture

The session file at `NEWINMETER_WEB_SESSION_PATH` stores auth tokens locally so refreshes can reuse them.

The deployed dashboard does **not** use this script. Its in-app sync action calls `/api/sync`, which runs the sync
directly in the Next.js backend (`src/lib/newinmeter-sync.ts` and `src/lib/newinmeter-web.ts`, pure TypeScript, no
Python involved). This script is only for the legacy single-user local CLI described in `README.md`'s "Legacy Local
Setup" section.

## Legacy: Android / ADB Refresh

Use this only if you specifically want the old Android capture flow or the web path stops working for your account.

Capture is local-only. The deployed dashboard reads Supabase and does not run Android/ADB commands.

The easiest Android path is the emulator wrapper:

    npm run refresh:emulator

It starts the configured Android emulator if needed, opens LiveMopay, runs capture and sync, then shuts the emulator down by default.

To keep the emulator open after refresh:

    npm run refresh:emulator -- --no-shutdown

To fully rebuild the CSV from the scrollable ledger history:

    npm run refresh:emulator -- --full

You can also run the lower-level refresh directly on a local machine with Android/ADB access:

    python3 legacy/adb-ingestion/refresh_and_sync.py --source adb

The refresh script runs:

    python3 legacy/adb-ingestion/capture_livemopay.py

This assumes local execution with Android platform tools available. The capture script looks for `adb` in this order:

1. `ADB_PATH`, if you set it
2. `adb` on your shell path
3. Android Studio's default macOS SDK path: `~/Library/Android/sdk/platform-tools/adb`

## Install ADB

ADB is the small Android command line tool that lets this project read and scroll the LiveMopay screen from your computer.

On macOS, the lightest setup is:

    brew install android-platform-tools

On Linux, install the platform tools package from your distro:

    sudo apt install android-sdk-platform-tools

For Fedora:

    sudo dnf install android-tools

For Arch:

    sudo pacman -S android-tools

On Windows:

1. download `SDK Platform-Tools for Windows` from Google's Android developer site
2. extract it somewhere simple, for example `C:\platform-tools`
3. add that folder to your Windows `Path`
4. or set `ADB_PATH` to the full executable path, for example `C:\platform-tools\adb.exe`

After installing, connect the phone and run:

    adb devices

If the phone asks whether to allow USB debugging, tap `Allow`. The device should show as `device`, not `unauthorized`.

## Android Studio Emulator

Use this if you want the most repeatable Android fallback flow.

1. install Android Studio
2. create an Android virtual device
3. install LiveMopay inside the emulator and log in
4. copy `.env.example` to `.env.local`
5. set `NEWINMETER_AVD_NAME` in `.env.local` to your emulator's AVD name
6. run `npm run refresh:emulator`

The wrapper uses these optional `.env.local` values:

    NEWINMETER_AVD_NAME=Your_AVD_Name
    NEWINMETER_PACKAGE_NAME=livemopay.co.za
    NEWINMETER_ACTIVITY_NAME=com.example.property_wallet.MainActivity
    EMULATOR_CMD=/path/to/emulator
    ADB_PATH=/path/to/adb
    ADB_SERIAL=emulator-5554

Most people should only need `NEWINMETER_AVD_NAME`. The package and activity are configurable in case LiveMopay changes its Android entry point. `ADB_SERIAL` is useful when you have more than one Android device or emulator connected.

If you also want the in-app dashboard assistant, add these optional server-side values to `.env.local`:

    OPENAI_API_KEY=your-openai-api-key
    OPENAI_MODEL=gpt-4.1-mini

The assistant is optional. Capture, sync, and the dashboard itself still work without it.

The capture script also reads `.env.local` directly. These optional values control output locations (defaults live under `legacy/adb-ingestion/data/`) and scan behavior:

    NEWINMETER_CSV_PATH=legacy/adb-ingestion/data/livemopay_energy.csv
    NEWINMETER_DUMPS_DIR=legacy/adb-ingestion/data/livemopay_dumps
    NEWINMETER_CAPTURE_LOG=legacy/adb-ingestion/data/livemopay_capture.log
    NEWINMETER_MAX_ITERATIONS=500
    NEWINMETER_MAX_STAGNANT_ROUNDS=4
    NEWINMETER_SCREEN_WAIT_ATTEMPTS=15
    NEWINMETER_SCREEN_WAIT_SECONDS=2.0

Once capture starts, do not touch the emulator until it finishes.

## Android Phone

1. install LiveMopay on your Android phone and log in
2. connect the phone to your computer with USB
3. turn on Developer Options on the phone
4. turn on USB debugging
5. unlock the phone and tap `Allow` if it asks about USB debugging
6. open LiveMopay
7. tap the bottom `Ledger` tab
8. leave the app on the Ledger summary page, where the orange `Ledger` button is visible
9. run `python3 legacy/adb-ingestion/refresh_and_sync.py --source adb`

Once capture starts, do not touch the phone until it finishes. The script is reading and scrolling the Android UI, so manual taps or scrolling can make it capture the wrong screen or miss rows.

## Starting Screen

It is okay if you already tapped the orange `Ledger` button and are looking at the list of individual electricity rows. The script tries to reset the app into the right place automatically:

1. if it starts inside the list of individual electricity rows, it taps the top-left back arrow
2. it opens the Ledger tab if needed
3. it taps the orange `Ledger` button
4. it verifies that transaction rows are visible before scanning

If the phone, emulator, permissions, or ADB path are not ready, the local refresh command reports the capture failure and the deployed dashboard keeps showing the last data that reached Supabase.

## Android Refresh Modes

The capture script loads the existing CSV before scanning, skips rows that are already present, appends newly discovered rows, and stops after several scrolls without new entries.

For a full recapture followed by sync, run:

    python3 legacy/adb-ingestion/refresh_and_sync.py --source adb --full

That passes `--full` to:

    python3 legacy/adb-ingestion/capture_livemopay.py --full

Full recapture ignores the existing CSV and rebuilds it from the Android history it can scroll through.

To run capture manually without syncing:

    python3 legacy/adb-ingestion/capture_livemopay.py

To sync the existing CSV without touching Android/ADB:

    python3 legacy/adb-ingestion/refresh_and_sync.py --skip-capture

To rebuild the CSV from existing XML dumps without connecting to Android:

    python3 legacy/adb-ingestion/capture_livemopay.py --from-dumps

## How Android Capture Works

The Android app exposes transaction rows through the UI hierarchy, so this project does not rely on screenshots or OCR for the main extraction flow.

Instead, the capture script:

1. dumps the visible Android UI
2. parses transaction rows from the view XML
3. scrolls the history list
4. deduplicates overlapping rows
5. appends newly found entries to the CSV

This makes it possible to build and refresh a structured dataset from the in-app history screen.
