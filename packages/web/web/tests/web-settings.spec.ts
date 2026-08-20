/** The `web` settings section switching the search provider without a restart. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime, {
  WEB_SETTINGS_NAMESPACE,
  type WebSearchProvider,
  type WebSearchResult,
} from '@deepseek-ai/dsh-web'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

function provider(id: string): WebSearchProvider {
  return {
    id,
    available: () => true,
    search: () => Promise.resolve({ content: id, sources: [], truncated: false } satisfies WebSearchResult),
  }
}

async function boot(): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber }> {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(WebRuntime, { searchProvider: 'deepseek-official' })
  await pluginFiber.await()
  ctx.web.registerSearchProvider(provider('deepseek-official'))
  ctx.web.registerSearchProvider(provider('ppio'))
  return { ctx, settingsFiber, pluginFiber }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('web settings section', () => {
  it('serves a stored provider selection to the next search without re-registering', async () => {
    const bench = await boot()
    await expect(bench.ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'deepseek-official' })

    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'ppio' })

    await expect(bench.ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'ppio' })
    await bench.ctx.fiber.dispose()
  })

  it('clears back to the composition entry when the stored section is replaced empty', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'ppio' })
    await expect(bench.ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'ppio' })

    await bench.ctx.settings.replace(WEB_SETTINGS_NAMESPACE, {})

    await expect(bench.ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'deepseek-official' })
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'ppio' })
    await expect(bench.ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'ppio' })

    await bench.settingsFiber.dispose()

    await expect(bench.ctx.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'deepseek-official' })
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the plugin unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('web')

    await bench.pluginFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('web')
    await bench.ctx.fiber.dispose()
  })
})
