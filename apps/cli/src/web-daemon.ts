/**
 * `dsh web start|stop|restart|status` — background lifecycle for a `dsh web`
 * server.
 *
 * start re-launches the very invocation that ran this CLI — the same Node
 * binary, exec flags (a tsx source loader stays loaded), and bin entry — with
 * `web` and the chosen port, detached with output appended to the log, so a
 * daemon launched from a source checkout serves built-from-source bundles and
 * an installed daemon serves its installed bundles. stop signals the recorded
 * process group, because a detached POSIX child is its own group leader.
 *
 * Two files carry the state: `dsh-web.log` receives output across runs and
 * `dsh-web.pid` names the group leader, both under the log directory. The
 * default log directory is `$DSH_HOME/logs`.
 * @module @deepseek-ai/dsh/web-daemon
 */

import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Absolute path to the compiled CLI entry, sibling of this source module. */
const CLI_BIN = fileURLToPath(new URL('../lib/bin.js', import.meta.url))

/** The web daemon lifecycle actions `dsh web <action>` accepts. */
export type WebDaemonAction = 'start' | 'stop' | 'restart' | 'status'

/** Options forwarded from the launcher parse; every field is optional. */
export interface WebDaemonOptions {
  /** `--port` value: validated here, forwarded to the child server. */
  port?: string
  /** `--log-dir` value: overrides the `$DSH_HOME/logs` default. */
  logDir?: string
}

/** The files one daemon deployment owns. */
export interface WebDaemonPaths {
  /** Directory holding the log and pid files. */
  dir: string
  /** Appending log of every server run's output. */
  logFile: string
  /** Pid file naming the running server's process-group leader. */
  pidFile: string
}

/**
 * Resolve where this daemon's log and pid files live.
 * @param logDir - explicit directory override, or absent for `$DSH_HOME/logs`.
 * @returns the daemon's file paths.
 */
export function webDaemonPaths(logDir?: string): WebDaemonPaths {
  const dir = logDir ?? join(resolveDshHome(), 'logs')
  return { dir, logFile: join(dir, 'dsh-web.log'), pidFile: join(dir, 'dsh-web.pid') }
}

/**
 * Read the pid file, treating a missing or unparseable file as "no daemon".
 * @param paths - the daemon's file paths.
 * @returns the recorded pid, or null when none is recorded.
 */
export function readPid(paths: WebDaemonPaths): number | null {
  try {
    const pid = Number(readFileSync(paths.pidFile, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/**
 * Whether a process the current user may signal is running under this pid.
 * @param pid - the pid to probe.
 * @returns true when the pid is alive.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Whether something already accepts loopback connections on this port.
 * @param port - the port to probe.
 * @returns true when a live listener answered.
 */
export function portListening(port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.end(); resolveProbe(true) })
    socket.once('error', () => { resolveProbe(false) })
  })
}

/** Report a refusal line and return the process exit code. */
function fail(message: string): 1 {
  process.stderr.write(`dsh web: ${message}\n`)
  return 1
}

/**
 * Spawn the child server: the compiled `apps/cli/lib/bin.js` (where const
 * enums are already inlined as numbers, avoiding the tsx/esbuild limitation
 * that strips them at runtime) with the web boot and its port.
 * @param paths - the daemon's file paths.
 * @param port - explicit listen port, or undefined to keep the composed default.
 * @returns 0 when the daemon spawned, 1 when start was refused.
 */
async function startServer(paths: WebDaemonPaths, port: number | undefined): Promise<number> {
  const pid = readPid(paths)
  if (pid !== null && alive(pid)) {
    return fail(`a server is already running (pid ${pid}); use "dsh web restart" or stop it first`)
  }
  if (pid !== null) rmSync(paths.pidFile, { force: true })
  if (port !== undefined && await portListening(port)) {
    return fail(`port ${port} is already in use by another process; pass --port <n> or stop that process first`)
  }

  mkdirSync(paths.dir, { recursive: true })
  const out = openSync(paths.logFile, 'a')
  try {
    const child = spawn(process.execPath, [
      CLI_BIN,
      'web',
      ...port === undefined ? [] : ['--port', String(port)],
    ], {
      detached: true,
      stdio: ['ignore', out, out],
    })
    child.unref()
    if (child.pid === undefined) return fail('spawn reported no process id')
    writeFileSync(paths.pidFile, `${child.pid}\n`)
    process.stdout.write([
      `dsh web: started (pid ${child.pid}${port === undefined ? '' : `, port ${port}`})`,
      `dsh web: logs ${paths.logFile}`,
      '',
    ].join('\n'))
    return 0
  } finally {
    closeSync(out)
  }
}

/**
 * Stop the recorded server: graceful SIGTERM on the process group, escalating
 * to SIGKILL after a ten-second deadline.
 * @param paths - the daemon's file paths.
 * @returns 0 when nothing is left running, 1 when there was nothing to stop.
 */
async function stopServer(paths: WebDaemonPaths): Promise<number> {
  const pid = readPid(paths)
  if (pid === null) {
    process.stderr.write('dsh web: not running (no pid file)\n')
    return 1
  }
  if (alive(pid)) {
    // A detached POSIX child is its own group leader; the negative pid stops
    // the loader and the server together. Windows has no process groups, so a
    // group-kill failure falls back to signalling the leader alone.
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
    }
    const deadline = Date.now() + 10_000
    while (alive(pid) && Date.now() < deadline) await delay(100)
    if (alive(pid)) {
      try { process.kill(-pid, 'SIGKILL') } catch { /* best effort */ }
    }
    process.stdout.write(`dsh web: stopped (pid ${pid})\n`)
  } else {
    process.stderr.write(`dsh web: pid ${pid} is not running; clearing the stale pid file\n`)
  }
  rmSync(paths.pidFile, { force: true })
  return 0
}

/**
 * Print whether the daemon is running.
 * @param paths - the daemon's file paths.
 * @returns 0 when running, 1 otherwise.
 */
function statusServer(paths: WebDaemonPaths): number {
  const pid = readPid(paths)
  if (pid !== null && alive(pid)) {
    process.stdout.write([
      `dsh web: running (pid ${pid})`,
      `dsh web: logs ${paths.logFile}`,
      '',
    ].join('\n'))
    return 0
  }
  process.stdout.write('dsh web: not running\n')
  return 1
}

/**
 * Run one web daemon lifecycle action.
 * @param action - the lifecycle action.
 * @param options - the launcher's `--port` and `--log-dir` values.
 * @returns the process exit code.
 */
export async function runWebDaemon(action: WebDaemonAction, options: WebDaemonOptions): Promise<number> {
  const paths = webDaemonPaths(options.logDir)
  let port: number | undefined
  if (options.port !== undefined) {
    const parsed = Number(options.port)
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return fail(`invalid --port: ${options.port}`)
    port = parsed
  }
  switch (action) {
    case 'start': return startServer(paths, port)
    case 'stop': return stopServer(paths)
    case 'restart': {
      if (readPid(paths) !== null) await stopServer(paths)
      return startServer(paths, port)
    }
    case 'status': return statusServer(paths)
    default:
      action satisfies never
      return fail(`unhandled action: ${String(action)}`)
  }
}
