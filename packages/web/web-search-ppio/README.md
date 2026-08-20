# @deepseek-ai/dsh-web-search-ppio

English | [中文](README.zh.md)

A PPIO-proxy-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls the proxy's dedicated `POST /web-search` retrieval endpoint and maps a Tavily-shaped response (an optional `answer` plus `results[]`) into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the key and it does not register a model-facing tool. Like `@deepseek-ai/dsh-web-search-deepseek`, it is a function/namespace plugin (`inject: ['web']`). The `/web-search` wire shape is a provider-private detail — it does **not** make this provider depend on `ctx.llm`.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | (unset) | Literal proxy API key. Empty/absent falls through to `apiKeyEnv` resolution. |
| `apiKeyEnv` | `PPIO_API_KEY` | Credential reference resolved per search through the credentials seam, then the launching environment. |
| `baseURL` | `https://apiproxy.paigod.work/v1` | Endpoint base; `/web-search` is appended. An unparseable value makes the provider unavailable. |
| `model` | `ppio-tavily-search` | Search model name; the proxy returns a Tavily-shaped body for it. |

```yaml
- id: web-search-ppio
  name: '@deepseek-ai/dsh-web-search-ppio'
  config:
    apiKeyEnv: PPIO_API_KEY
    baseURL: https://apiproxy.paigod.work/v1
    model: ppio-tavily-search
```

The provider is selected through the web seam's `searchProvider` config (or `$DSH_WEB_SEARCH_PROVIDER`), so mounting it beside another search provider never changes the default. The `baseURL` and `model` fields also resolve from the `web-search-ppio` settings section, so a configuration surface can edit them in the browser without a restart.

## Mapping

`content` ← `answer` (the proxy's optional generated answer). `sources[]` ← `results[]` (`url`, `title`, `snippet` ← `content`). Blank fields are omitted rather than set empty. Provider failures surface as `WebError` `WEB_PROVIDER_ERROR`; a missing key surfaces as `WEB_PROVIDER_CREDENTIAL_MISSING`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`. The proxy has no result-count control, so `maxResults` is enforced by the seam (truncating `sources[]` and setting `truncated`).

## Model Experience

### Auxiliary PPIO request

#### What the model sees

A separate PPIO search model receives `<query>` verbatim through the `/web-search` endpoint. This request is not part of the conversation model's context.

#### Token effect

The retrieval is not an LLM call; no conversation-model tokens are incurred by the search itself.

#### KV Cache effect

Independent of the conversation request cache.

### Conversation tool result, indirectly

#### What the model sees

Through [`dsh-tool-web`](../tool-web/README.md), the conversation model sees the optional answer plus structured source metadata. This provider's exact failures are `PPIO search aborted`, `PPIO search request failed: <error>`, `PPIO search credential resolution failed: <error>`, `PPIO search has no API key for "<ref>"; ...`, and `PPIO returned an unprocessable response body: <error>`; HTTP failures preserve the provider message. The consumer owns the error wrapper.

#### Token effect

Zero direct conversation tokens from registration. Answer and source tokens are data-dependent, source count is service-bounded, and the retained result or error is resent until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Tavily-shaped responses only** — the proxy's `ppio-web-search` model returns a Bing-shaped body (`data.webPages.value[]`) that this provider does not parse; only the Tavily-shaped `ppio-tavily-search` model is supported.
- **Result-count is post-hoc** — with no count control on the wire, `maxResults` is enforced only by seam truncation.
