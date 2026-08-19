# Agent Note: `dsh web start|stop|restart|status` background lifecycle

Status: implemented

English | [中文](2026-08-19-dsh-web-background-lifecycle.zh.md)

## Problem

Running the GUI meant holding a terminal open for `dsh web`, or re-implementing daemonization outside the product. Long-running web servers need exactly four operations — start detached, stop, restart, status — and nothing in the CLI offered them.

## Decision

Four subcommands nest under the existing `web` alias in [`args.ts`](../../../../apps/cli/src/args.ts); the runner lives in [`web-daemon.ts`](../../../../apps/cli/src/web-daemon.ts).

**The action token routes to the daemon, never the app.** `web` already forwarded every unrecognized token to the web app verbatim; naming `start|stop|restart|status` now claims them. Any other token still forwards (`dsh web serve` boots the app with a positional argument). Commander checks registered subcommands before variadic arguments, so the routing is explicit, not a string prefix guess.

**A daemon re-launches the very invocation that ran the CLI.** The child is `spawn(process.execPath, [...process.execArgv, process.argv[1], 'web', ...])`, so a source checkout's tsx loader and entry stay attached to the daemon too — the GUI a source-launcher manages serves rebuilt-from-source bundles, while an installer's daemon serves installed bundles. `detached: true` makes the POSIX child a process-group leader, and `stop` signals the group (problem: the tsx loader process isn't the server process; signalling the leader alone would orphan the server) with a Windows-safe fallback to the leader pid.

**State is two files under one log directory.** `dsh-web.log` appends every run's output; `dsh-web.pid` records the group leader; both default to `$DSH_HOME/logs` and `--log-dir` overrides them. `start` refuses a second run while the recorded pid is alive, clears a stale pid file, and probes `--port` before forking so an occupied port fails loud on the command, not inside the booted fiber. `stop` escalates SIGTERM → SIGKILL after ten seconds.

## Alternatives considered

- **A top-level `dsh daemon` command for any profile.** Deferred: only the web profile has a product reason to run headless-long; the other profiles are interactive or one-shot. Widening the grammar claims a namespace before a second consumer exists.
- **Flat commands (`dsh web:start`).** Rejected: colons are package-script vocabulary; the CLI already reads `dsh web`, so `dsh web start` follows the product's own grammar.
- **systemd/launchd integration.** Rejected: platform service managers answer a different question (boot persistence), need root-shaped configuration on some systems, and would put the pid story outside the product's reach.
- **Logging under the invoking directory.** Rejected: the user's cwd is not stable between `start` and `stop`, and `$DSH_HOME` is where every other durable runtime artifact already lives.

## Consequences

`dsh web start --port 3080` detaches a server the user then manages with `dsh web status`, `dsh web restart`, and `dsh web stop`. The pid files are the single source of truth — a server started through `dsh web` (foreground) is invisible to `status`, by design.

The behavior locks in only where the process runs: the four routing cases are unit-tested in `args.spec.ts`, and the daemon's refusal branches, pid-file handling, stale-pid cleanup, and port probe are unit-tested in `apps/cli/tests/web-daemon.spec.ts`. A real start/stop round-trip boots the whole web profile and belongs to the built-bin e2e surface when it next extends.
