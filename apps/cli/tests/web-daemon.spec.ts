import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  portListening, readPid, runWebDaemon, webDaemonPaths,
} from '../src/web-daemon.ts'

describe('webDaemonPaths', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('defaults under the resolved harness home and honors an override', () => {
    vi.stubEnv('DSH_HOME', '/tmp/dsh-home-env')
    const defaults = webDaemonPaths()
    expect(defaults.dir).toBe(join('/tmp/dsh-home-env', 'logs'))
    expect(defaults.logFile).toBe(join('/tmp/dsh-home-env', 'logs', 'dsh-web.log'))
    expect(defaults.pidFile).toBe(join('/tmp/dsh-home-env', 'logs', 'dsh-web.pid'))

    const custom = webDaemonPaths('/tmp/my-logs')
    expect(custom.dir).toBe('/tmp/my-logs')
    expect(custom.logFile).toBe(join('/tmp/my-logs', 'dsh-web.log'))
  })
})

describe('readPid', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dsh-web-daemon-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('roundtrips a recorded pid and treats missing or junk content as absent', () => {
    const paths = webDaemonPaths(dir)
    expect(readPid(paths)).toBeNull()

    writeFileSync(paths.pidFile, 'garbage\n')
    expect(readPid(paths)).toBeNull()

    writeFileSync(paths.pidFile, ` ${process.pid} \n`)
    expect(readPid(paths)).toBe(process.pid)
  })
})

describe('portListening', () => {
  let server: Server | undefined
  afterEach(async () => {
    if (server === undefined) return
    await new Promise<void>((done) => { server?.close(() => { done() }) })
    server = undefined
  })

  it('sees a live listener and reports a refused port as free', async () => {
    server = createServer()
    const s = server
    await new Promise<void>((resolveListen) => { s.listen(0, '127.0.0.1', resolveListen) })
    const address = s.address()
    if (address === null || typeof address === 'string') throw new Error('no address')
    await expect(portListening(address.port)).resolves.toBe(true)
    const c = server
    await new Promise<void>((resolveClose) => { c.close(() => { resolveClose() }) })
    server = undefined
    await expect(portListening(address.port)).resolves.toBe(false)
  })
})

describe('runWebDaemon', () => {
  let dir: string
  let out: string[]
  let err: string[]
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-web-daemon-'))
    out = []
    err = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk)); return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err.push(String(chunk)); return true
    })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('status reports not running and stop refuses without a pid file', async () => {
    await expect(runWebDaemon('status', { logDir: dir })).resolves.toBe(1)
    expect(out.join('')).toContain('not running')

    await expect(runWebDaemon('stop', { logDir: dir })).resolves.toBe(1)
    expect(err.join('')).toContain('no pid file')
  })

  it('rejects an invalid port before touching the filesystem', async () => {
    await expect(runWebDaemon('start', { logDir: dir, port: 'soon' })).resolves.toBe(1)
    await expect(runWebDaemon('start', { logDir: dir, port: '0' })).resolves.toBe(1)
    await expect(runWebDaemon('start', { logDir: dir, port: '70000' })).resolves.toBe(1)
    expect(err.join('')).toContain('invalid --port')
    expect(existsSync(join(dir, 'dsh-web.pid'))).toBe(false)
  })

  it('refuses to start when the recorded pid is alive', async () => {
    // The test process itself is a live pid that belongs to no server.
    writeFileSync(join(dir, 'dsh-web.pid'), `${process.pid}\n`)
    await expect(runWebDaemon('start', { logDir: dir })).resolves.toBe(1)
    expect(err.join('')).toContain('already running')
    expect(readFileSync(join(dir, 'dsh-web.pid'), 'utf8').trim()).toBe(String(process.pid))
  })

  it('stop clears a stale pid file without signalling anything', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('no such process') })
    const paths = webDaemonPaths(dir)
    writeFileSync(paths.pidFile, '99999999\n')
    await expect(runWebDaemon('stop', { logDir: dir })).resolves.toBe(0)
    expect(existsSync(paths.pidFile)).toBe(false)
    expect(err.join('')).toContain('stale pid file')
  })
})
