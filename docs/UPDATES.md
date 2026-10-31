# ClipCraft updates — how a release reaches users

ClipCraft never updates itself and never checks in the background. In **About**, the user
clicks **Check for updates**; the app fetches one small JSON file from Hamza's site and,
if it names a newer version, offers a **Download** button (the installer link opens in the
user's browser — installing stays a manual, user-controlled step).

## The feed

- URL the app reads: `https://hamzaabika.com/clipcraft/version.json`
  (override for testing with the `CLIPCRAFT_UPDATE_URL` environment variable)
- Format: see `version.sample.json` next to this file.
  - `version` — required, `MAJOR.MINOR.PATCH` (a `-beta.1` suffix sorts before its release)
  - `download_url` — the installer link. Only links on `hamzaabika.com` or `github.com`
    are accepted; anything else is replaced by the site root, so a compromised feed
    cannot send users to an arbitrary host.
  - `notes_url`, `notes`, `release_date`, `size` — optional, shown in the dialog.
- Until the file exists, the server answers 404 and the app simply says
  "You're up to date — no newer version has been published yet."

## Publishing an update

1. Bump `version` in `package.json`, rebuild, package the installer.
2. Upload the installer (to hamzaabika.com or a GitHub release).
3. Upload the edited `version.json` (with the new version + installer URL) to
   `https://hamzaabika.com/clipcraft/version.json`.
4. Users who click **Check for updates** now see the new version and can download it.

Verified by `scripts/test-updates.mjs` (version ordering, feed states, link gating).
