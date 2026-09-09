# GitViewer2

A Tauri 2 Git client for macOS and Windows with lazy file browsing, text and image diffs, file and hunk staging, branches, synchronization, history, blame, and stashes.

## Development

Install Node.js with pnpm 11.25.0, a current Rust toolchain, and Git 2.38 or newer. Native development also requires the platform's Tauri build prerequisites.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev:web` starts the presentation layer only. Repository operations require the desktop runtime.

## Saved state and logs

Settings are saved as soon as they change. Open repository tabs, their order, the active tab, commit drafts, and window position, size, and maximized state are restored on startup. Sessions autosave every five minutes. Closing the window or quitting requests the final frontend snapshot before saving and exiting; if the frontend does not respond within two seconds, the last native snapshot is saved. A failed final save keeps the application open.

Debug builds use `com.gitviewer.desktop.dev`; release builds use `com.gitviewer.desktop`. Tauri uses these separate identifiers for settings, session, webview data, and log directories, matching LatentMail's development isolation. `settings.json` and `session.json` live in the application's configuration directory: `~/Library/Application Support/<identifier>` on macOS and `%APPDATA%/<identifier>` on Windows.

Logs go to `~/Library/Logs/<identifier>` on macOS and `%LOCALAPPDATA%/<identifier>/logs` on Windows. They rotate daily as `gitviewer.YYYY-MM-DD.log`; startup removes dated application logs older than seven days. Startup, shutdown, persistence failures, failed IPC commands, and uncaught frontend errors are logged. Log buffers are flushed on exit. Text fields disable browser autocomplete, autocorrect, capitalization, and spellcheck.

## Verification

Run `pnpm test:all` to run frontend coverage, Rust coverage, and end-to-end tests in sequence, stopping at the first failure. The screenshot suite currently requires macOS.

```sh
pnpm lint
pnpm typecheck
pnpm run format
cargo fmt --manifest-path src-tauri/Cargo.toml --check
pnpm clippy
pnpm test:coverage
pnpm test:rust:coverage
pnpm test:e2e
pnpm build
cargo build --manifest-path src-tauri/Cargo.toml --no-default-features
```

Rust coverage requires stable Rust, `cargo-nextest`, `cargo-llvm-cov`, and `llvm-tools-preview`. It runs `cargo llvm-cov nextest --no-clean`, resetting raw profiles and pruning stale coverage executables while preserving compiled dependencies. Browser tests require `pnpm exec playwright install chromium`. Native filesystem events and Chromium startup need normal macOS process permissions; a restrictive process sandbox can prevent those tests from running.

Clippy checks both production and test features. CI also builds the production desktop binary: the `test-utils` feature deliberately replaces OS-opening and global-settings operations, so testing that feature alone cannot verify the shipping application.

## Implementation notes

Hunk actions re-read the diff using its displayed context and compare the patch before applying it. CRLF bytes and missing-final-newline markers survive patch construction. Expanded context can combine nearby changes into one displayed hunk; applying that hunk applies all changes shown in it.

Text limits can be overridden per selection. The 20 MB image ceiling also applies at the custom protocol endpoint; oversized images can be opened in the system application.

Ordinary working-tree edits preserve history pagination. HEAD and reference changes invalidate it. Closing a repository removes its frontend cache and drops its backend watcher and history process.

Changes-tree directory checkboxes are indeterminate when a descendant is partly staged. Tree identifiers support filenames such as `root`, `constructor`, and `__proto__` without colliding with internal nodes.

## Remaining platform verification

The automated suites and native build have been verified locally on macOS. The CI matrix includes Windows, but a Windows run has not been verified from this workspace. Windows-specific Playwright screenshot baselines still need to be captured and visually reviewed on Windows; the checked-in baselines are macOS captures. No screenshot tolerance was increased.

The live-credential smoke check remains pending in `CLAUDE.md`. Automated Git tests use isolated repositories and local bare remotes, without the user's credential helpers or global Git configuration.
