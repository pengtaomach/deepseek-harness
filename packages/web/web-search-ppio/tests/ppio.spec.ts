import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import WebRuntime from '@deepseek-ai/dsh-web'
import {
  PpioSearchProvider,
  PPIO_PROVIDER_ID,
} from '@deepseek-ai/dsh-web-search-ppio'
import * as ppioPlugin from '@deepseek-ai/dsh-web-search-ppio'
import { mapPpioResponse } from '../src/provider.ts'

const options = { apiKey: 'ppio-key', baseURL: 'https://proxy.test/v1', model: 'ppio-tavily-search' }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

function tavilyResponse(): Record<string, unknown> {
  return { answer: 'the answer', results: [{ url: 'https://a.test', title: 'A', content: 'snip' }] }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Ppio response mapping', () => {
  it('maps the answer and results[] with content as the snippet', () => {
    expect(mapPpioResponse({
      answer: 'the answer',
      results: [
        { url: 'https://a.test', title: 'A', content: 'snip' },
        { url: 'https://b.test' },
      ],
    })).toEqual({
      content: 'the answer',
      sources: [
        { url: 'https://a.test', title: 'A', snippet: 'snip' },
        { url: 'https://b.test' },
      ],
      truncated: false,
    })
  })

  it('omits content when the answer is empty or missing', () => {
    expect(mapPpioResponse({ answer: '', results: [] }).content).toBeUndefined()
    expect(mapPpioResponse({ answer: null, results: [] }).content).toBeUndefined()
    expect(mapPpioResponse({ results: [] }).content).toBeUndefined()
  })

  it('omits null/empty optional source fields', () => {
    expect(mapPpioResponse({ results: [{ url: 'https://a.test', title: null, content: '' }] }).sources)
      .toEqual([{ url: 'https://a.test' }])
  })

  it('yields no sources when results is absent', () => {
    expect(mapPpioResponse({ answer: 'a' }).sources).toEqual([])
  })
})

describe('PpioSearchProvider availability', () => {
  it('is available with a key and a parseable base URL', () => {
    expect(new PpioSearchProvider(() => options).available()).toBe(true)
  })

  it('is unavailable without a key or resolver', () => {
    expect(new PpioSearchProvider(() => ({ ...options, apiKey: '' })).available()).toBe(false)
  })

  it('is available with a resolver when no literal key is set', () => {
    expect(new PpioSearchProvider(() => ({ baseURL: options.baseURL, model: options.model, resolveApiKey: async () => 'k' })).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new PpioSearchProvider(() => ({ ...options, baseURL: 'not a url' })).available()).toBe(false)
  })

  it('is misconfigured when the model is empty', () => {
    expect(new PpioSearchProvider(() => ({ ...options, model: '' })).available()).toBe(false)
  })
})

describe('PpioSearchProvider request mapping', () => {
  it('posts to /web-search with the model and query', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(tavilyResponse()))
    vi.stubGlobal('fetch', fetchMock)
    await new PpioSearchProvider(() => options).search({ query: 'hello' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://proxy.test/v1/web-search')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer ppio-key')
    expect(JSON.parse(init.body as string)).toEqual({ model: 'ppio-tavily-search', query: 'hello' })
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(tavilyResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new PpioSearchProvider(() => options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('PpioSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'rate limited' } }, { status: 429 })))
    await expect(new PpioSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'rate limited' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream error', { status: 503 })))
    await expect(new PpioSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'PPIO API error (HTTP 503)' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new PpioSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new PpioSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new PpioSearchProvider(() => options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('reports a missing credential with the resolved reference', async () => {
    const prev = process.env.PPIO_API_KEY
    delete process.env.PPIO_API_KEY
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: PPIO_PROVIDER_ID })
      ppioPlugin.apply(ctx, {})
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
    } finally {
      await ctx.fiber.dispose()
      if (prev === undefined) delete process.env.PPIO_API_KEY
      else process.env.PPIO_API_KEY = prev
    }
  })
})

describe('web-search-ppio plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(tavilyResponse())))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: PPIO_PROVIDER_ID })
    const fiber = await ctx.plugin(ppioPlugin, { apiKey: 'ppio-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in ppioPlugin).toBe(false)
  })

  it('falls back to the env key and defaults when config omits them', async () => {
    const prev = process.env.PPIO_API_KEY
    process.env.PPIO_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse(tavilyResponse()))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: PPIO_PROVIDER_ID })
      const fiber = await ctx.plugin(ppioPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://apiproxy.paigod.work/v1/web-search')
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer env-key')
      expect(JSON.parse(init.body as string)).toMatchObject({ model: 'ppio-tavily-search' })
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.PPIO_API_KEY
      else process.env.PPIO_API_KEY = prev
    }
  })

  it('resolves the credential for each search from the credentials seam', async () => {
    const previous = process.env.PPIO_API_KEY
    delete process.env.PPIO_API_KEY
    const dir = await mkdtemp(join(tmpdir(), 'dsh-web-search-ppio-'))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(tavilyResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: PPIO_PROVIDER_ID })
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      await ctx.plugin(ppioPlugin, { baseURL: 'https://proxy.test/v1' })

      const ref = credentialRef('PPIO_API_KEY')
      await ctx.credentials.set(ref, 'stored-key')
      await ctx.web.search({ query: 'stored' })

      const headers = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>)
      expect(headers.map(value => value['authorization'])).toEqual(['Bearer stored-key'])
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
      if (previous === undefined) delete process.env.PPIO_API_KEY
      else process.env.PPIO_API_KEY = previous
    }
  })
})
