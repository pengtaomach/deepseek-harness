# Agent Note: PPIO proxy search provider over a dedicated `/web-search` endpoint

Status: implemented

English | [中文](2026-08-19-ppio-proxy-web-search.zh.md)

## Problem

A deployment whose search runs through a PPIO proxy (apiproxy.paigod.work) cannot use `web-search-deepseek`: that provider depends on DeepSeek's native `web_search_20250305` server tool, which the proxy does not relay. The proxy instead exposes a plain retrieval operation, `POST /web-search`, returning Tavily-shaped or Bing-shaped bodies — a shape no existing `WebSearchProvider` reads.

## Decision

`@deepseek-ai/dsh-web-search-ppio` registers a `WebSearchProvider` (`id: 'ppio'`) that calls the proxy's `/web-search` endpoint and maps a Tavily-shaped response. It is mounted in the base bundle beside the shipped DeepSeek provider, but selected through the web seam's `searchProvider` config or `$DSH_WEB_SEARCH_PROVIDER` — so the shipped default stays `deepseek-official` unless a deployment opts in.

**The retrieval is not an LLM call.** The provider posts `{ model, query }` and parses the response directly; it imports no `ctx.llm` face, matching perplexity's provider-private wire shape.

**Credentials resolve per search, like the DeepSeek provider.** The key is a `credentialRef` resolved through the credentials seam (falling back to the launching environment), never a literal retained on the provider, so a stored or rotated `PPIO_API_KEY` needs no restart and no secret rides a response.

**A settings section, not just cordis config.** The `web-search-ppio` namespace resolves `baseURL`/`model`/`apiKeyEnv`, so a configuration surface edits the endpoint and model in the browser; the provider projects the section per search, so a committed change needs no re-registration.

**One response shape, deliberately.** The proxy's `ppio-tavily-search` model answers in Tavily's shape (`answer` + `results[]` with `url`/`title`/`content`), which maps directly onto `content` and `sources[]`. The Bing-shaped `ppio-web-search` body is left unparsed and recorded as deferred work rather than guessed at.

## Alternatives considered

- **Reusing `web-search-deepseek` with a proxy base URL.** Rejected: the proxy's Messages endpoint ignores the native `web_search` tool and returns prose that claims no search ran (verified against the live endpoint), so the DeepSeek provider's strict mode correctly fails.
- **Routing search through `ctx.llm` with the proxy's `ppio-web-search` model.** Rejected: that model is a retrieval name in a settings catalog, not an LLM route the harness can stream; the `/web-search` operation is the only working surface.
- **Parsing both Tavily and Bing shapes.** Deferred: Bing's `webPages.value[]` maps cleanly too, but a second shape doubles the response contract before a consumer exists; the note's deferred-work entry records it.

## Consequences

A PPIO-proxy deployment can select `ppio` as its search provider and get structured `web_search` results. The mapping, error surface, and settings-section behavior are unit-tested in `packages/web/web-search-ppio/tests/`; the provider is mounted in the base bundle but unselected, so every other deployment's default search is untouched.
