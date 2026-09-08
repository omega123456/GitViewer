# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Use `pnpm` only. Run Rust commands with `--manifest-path src-tauri/Cargo.toml`.

- Run the app: `pnpm dev`. This starts the Tauri desktop runtime.
- Run the frontend alone: `pnpm dev:web`. Repository operations do not work in this mode.
- Typecheck: `pnpm typecheck`. Lint: `pnpm lint`. Format check: `pnpm run format`.
- Clippy: `pnpm clippy`. It checks the production feature set and the test feature set.
- Frontend tests: `pnpm test`. Coverage: `pnpm test:coverage`.
- Run one frontend test file: `pnpm exec vitest run src/tests/features.test.tsx`.
- Filter frontend tests by name: `pnpm exec vitest run -t "pattern"`.
- The verbose reporter shows console output. Use it to find React `act(...)` warnings.
- Rust tests: `pnpm test:rust`. This uses `cargo nextest` with the `test-utils` feature.
- Run one Rust test: `cargo nextest run --manifest-path src-tauri/Cargo.toml --features test-utils -E 'test(name)'`.
- Rust coverage: `pnpm test:rust:coverage`. It needs `cargo-llvm-cov` and `llvm-tools-preview`.
- End-to-end tests: `pnpm test:e2e`. First run `pnpm exec playwright install chromium`.
- Production desktop build check: `cargo build --manifest-path src-tauri/Cargo.toml --no-default-features`.

The full verification list is in `README.md`.

## Architecture

GitViewer2 is a Tauri 2 desktop Git client. Rust owns data and Git. React owns the interface.

**One IPC command.** The frontend calls `invoke(command, args)` in `src/lib/ipc.ts`. This calls the single Tauri command `execute`, which routes by string match in `dispatch` in `src-tauri/src/ipc.rs`. To add a command, add one entry to the `Commands` map in `src/lib/types.ts` and one match arm in `ipc.rs`. Do not write a per-command wrapper.

**Data and state split.** `src/lib/query.ts` holds the TanStack Query client. `useBackend` reads backend data. `perform` runs a mutation and tracks busy and error state. Zustand stores in `src/stores/` hold interface state that Rust does not know about, for example selection, tabs, and the command palette.

**Events.** Rust emits events named `domain://event`: `repo://status-changed`, `repo://head-changed`, `repo://closed`, `settings://changed`, and `sync://progress`. `connectEvents` and `handleEvent` in `src/lib/query.ts` form the one bridge that invalidates Query. Nothing else invalidates by hand.

**Permissions.** The capability file is `src-tauri/capabilities/default.json`. A permission error almost always means a missing entry there or a name mismatch with a registered Rust command.

**Rust backend.** `src-tauri/src/lib.rs` registers the handler and the `gitblob://` protocol. `repo::Registry` holds one `Arc<Mutex<Repo>>` per open repository, keyed by id. `Repo` runs Git as a subprocess through `git::run` and `git::text`, keeps a status snapshot, holds filesystem watchers from `watch/`, and holds streaming history sessions from `history.rs`. `git::detect` checks the Git binary and requires version 2.38 or newer. Binary blobs are served over the `gitblob://` URI scheme in `blob/`, with a 20 MB ceiling.

**The `test-utils` feature.** Any code path that can touch machine-global state compiles to a fake or an unsupported result under this feature. This covers OS-open actions and global settings. The production build must be checked without this feature, because that feature alone cannot verify the shipping application.

**Frontend modules.** Components live under `src/components/` by area: `sidebar`, `diff`, `history`, `stash`, `image`, `settings`, `shell`, `shared`, and `states`. `src/providers/` wires the Query client, theme, layout, and commands.

**Tests.** All Rust tests live in `src-tauri/tests/integration/` and compile into one binary through the module list in `main.rs`. All frontend IPC mocking is centralized in `src/tests/harness.ts`. End-to-end tests live in `e2e/`. Screenshot baselines are macOS captures only.

**Architectural decisions.** `.agent/adr/` is an append-only decision ledger. Read the relevant ADR before you change an area it governs. Never edit or delete an ADR. To reverse a decision, add a new ADR per `.agent/ADR_POLICY.md`. The current plan is `.agent/plans/2026-09-07_gitviewer_plan.md`.

# GitViewer2 conventions


**Architecture**

- Rust owns data, process control, persistence and business logic. React owns presentation and interaction state.
- TanStack Query owns anything from Rust. Zustand owns anything the user did that Rust does not know about. Rust events reach Query through one bridge layer, and nothing invalidates by hand outside it.
- One generic invoke function keyed on a central command map. Adding a command means a map entry and a Rust handler, never a per-command wrapper. Events are named `domain://event`.
- A permission error almost always means a missing entry in the capabilities file or a name mismatch with the registered Rust command.

**Code**

- **No comments and no docblocks.** Do not write `//`, `/* */`, `///`, `//!`, `#`, JSDoc, TSDoc or Rust doc comments in any production or test file. Names, types and small functions carry the meaning instead. If something needs explaining, rename it or split it until it does not. Rationale and rejected alternatives belong in the commit message, the pull request, or an ADR under `.agent/adr/`, never in the source. This applies to new code and to any code touched during a change. The only exceptions are machine-read directives that must be in the file to work: `#!` shebangs, `#[...]` and `@ts-*` attributes, and license headers where they are legally required.
- **All date and time work goes through the date library.** Use `date-fns` in TypeScript and `chrono` in Rust, in production code **and** in tests, with no exception for simple cases. Forbidden: manual millisecond or second arithmetic, hand-rolled formatting from date parts, ad hoc parsing of date strings, and hand-written relative-time or duration logic. This rule matters here because history rows, blame blocks and stash rows all render relative timestamps, which is exactly the path it guards.

**Styling**

- Pure Tailwind utility classes. No custom CSS rules, no `@apply`, no bracket values. Every custom value is a named `@theme` token.
- `index.css` holds only the Tailwind import, the dark variant, and the `@theme` block.
- The sole exception is an inline CSS custom property for a genuinely dynamic value.
- **The radius scale is redefined**, matching the sibling project: `--radius` is `0.5rem` and `--radius-md` is `0.75rem`, alongside the named product radii. This matters because the plan permits only named tokens, so a component cannot reach for an arbitrary radius.

**Testing**

- **Coverage gates, stated per side because the tools measure different things.** Vitest: 90% lines, 90% functions, 90% statements. `cargo-llvm-cov`: 90% lines, 90% functions, 80% regions — it exposes no statements metric, so asking for one is unverifiable. Excluding functions or files from coverage is prohibited on both sides: no ignore comments, no coverage include or exclude tweaks that skip production code, and no configuration attribute used to dodge the gate.
- Every test lives in a dedicated test root. Production files contain only shipping code.
- Never embed a test attribute or a test module inside `src-tauri/src/`. All Rust tests live in `src-tauri/tests/`.
- All Rust integration tests compile into one binary through a single module list, because each additional test target relinks the whole dependency graph.
- Rust tests run with a test-utils feature. Any code path that can touch machine-global state compiles to a fake or returns an unsupported result under it.
- Vitest IPC mocking is centralized in one shared harness. Ad hoc per-test mocks are prohibited, and the intentional unmocked-command failure is part of the contract.
- **Vitest must run without React `act(...)` warnings.** Treat any `act(...)` output as unfinished work and fix the test, rather than ignoring the warning. The default reporter hides console output for passing tests, so a run can look clean while warnings still fire. Surface them with the verbose reporter and search the error stream for `not wrapped in act`. A common source is a test calling a Zustand store setter directly while a component from that test is still mounted and subscribed.
- **Tests must never hit real machine-global state.** Any code path that can touch the user's own git configuration, credential helpers or global OS settings compiles to a fake or returns an unsupported result under the test-utils feature. No test may accept "the real thing succeeded" as a passing branch.
- No fixed delay over five seconds in any test. Each unit suite completes in under one second, and each screenshot in under two.
- Playwright screenshot tolerance is never increased to make a test pass. Any regenerated baseline is inspected before it is accepted.

**Process**

- `pnpm` only.
- Every change works on both macOS and Windows.
- Lint is genuinely clean, with no suppressions.

