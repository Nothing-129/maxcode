# macOS Developer ID Signing

The release workflow signs and notarizes the Electron desktop app outside the
App Store. Electron Builder imports the certificate into a temporary keychain,
signs the app and bundled Rust executables, and submits the app to Apple.

## Required GitHub secrets

Existing Apple secret names are preserved; the workflow maps them to Electron
Builder's environment variables.

| GitHub secret | Build environment | Value |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | `CSC_LINK` | Base64 contents of an exported Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | `CSC_KEY_PASSWORD` | Password used to export the `.p12` |
| `APPLE_ID` | `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | `APPLE_APP_SPECIFIC_PASSWORD` | Apple app-specific password |
| `APPLE_TEAM_ID` | `APPLE_TEAM_ID` | Developer Team ID |

`KEYCHAIN_PASSWORD` is no longer used; Electron Builder manages its temporary
keychain. `TAURI_SIGNING_PRIVATE_KEY` and its password are only required when
`SERVER_TARGETS` is enabled, for the existing server update signatures.
They are independent of Apple signing. Do not delete server keys during desktop
migration.

## Prepare credentials

1. In Keychain Access, create a Certificate Signing Request.
2. In Apple Developer Certificates, IDs & Profiles, create a Developer ID
   Application certificate for distribution outside the App Store.
3. Install the downloaded certificate, then export its private key as a
   password-protected `.p12` from Keychain Access > My Certificates.
4. Convert it with the local helper:

```bash
scripts/prepare-macos-signing-secrets.sh /path/to/DeveloperIDApplication.p12
```

The helper writes a local Base64 file and prints secret-setting commands; it
never uploads credentials itself. Keep the certificate and exported file private.
Set secrets only on `Nothing-129/maxcode`. `APPLE_PASSWORD` must be an app-specific
password; find `APPLE_TEAM_ID` in Apple Developer membership details.

## Local builds

A regular build uses ad-hoc signing without notarization and does not discover
release identities automatically:

```bash
corepack pnpm desktop:build:dmg
```

For a signed and notarized build, supply credentials in your local environment:

```bash
export CSC_LINK="/path/to/DeveloperIDApplication.p12"
export CSC_KEY_PASSWORD="<p12 password>"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific password>"
export APPLE_TEAM_ID="<team ID>"
export CODEG_ELECTRON_RELEASE=1
corepack pnpm desktop:build
```

`CODEG_ELECTRON_RELEASE=1` requires all credentials and code signing. Build on the
target OS and architecture; do not pass Cargo `--target` or set `CARGO_BUILD_TARGET`.
The backend reuses `src-tauri/target/release`. Installers are written to
`electron/dist/MaxCode-<version>-mac-<arch>.dmg` and `.zip`.
Local builds never upload or publish.

Verify an Apple Silicon application and run its packaged smoke test:

```bash
codesign --verify --deep --strict --verbose=2 electron/dist/mac-arm64/maxcode.app
xcrun stapler validate electron/dist/mac-arm64/maxcode.app
spctl --assess --type execute --verbose=2 electron/dist/mac-arm64/maxcode.app
corepack pnpm desktop:smoke
```

On Intel, use `electron/dist/mac/maxcode.app`.

## CI gates and legacy migration

The release workflow verifies credentials before creating the draft. macOS
builds require Developer ID signing and notarization, verify the signed app and
stapled ticket, and smoke-test the packaged application. It uploads DMG, ZIP and
SHA-256 files only after those checks pass. Publication requires every selected
desktop and server build to succeed and every required release asset to exist.

New releases do not contain a Tauri `latest.json` feed. Existing Tauri users must
install Electron manually; the app continues using their database and native
keyring. Signed Electron releases support differential ZIP downloads with a
verified full-download fallback. Publish the architecture-specific YAML and ZIP
blockmap along with the installers. Ad-hoc local macOS builds disable automatic
installation; users first install a Developer ID signed release containing the
updater. See [differential updates](../maintenance/electron-differential-updates.md).

References:

- [Electron Builder macOS signing](https://www.electron.build/code-signing-mac.html)
- [Apple Developer ID](https://developer.apple.com/support/developer-id/)
- [Runtime migration checklist](../maintenance/desktop-runtime-migration.md)
