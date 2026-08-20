/**
 * Wire types for the PPIO proxy search endpoint (`POST {baseURL}/web-search`).
 * The `ppio-tavily-search` model answers in Tavily's shape: an optional generated
 * `answer` plus a `results[]` list whose entries already carry `url`, `title`,
 * and `content` (the snippet). The provider-private wire shape does not depend on
 * `ctx.llm`.
 * @module @deepseek-ai/dsh-web-search-ppio/types
 */

/** Request body sent to the proxy's `/web-search` operation. */
export interface PpioSearchRequest {
  /** Search model name (e.g. `ppio-tavily-search`). */
  model: string
  /** The user's search query. */
  query: string
}

/** One search result in a Tavily-shaped response. */
export interface PpioSearchResult {
  url: string
  title?: string | null
  /** Snippet text; the Tavily field this adapter maps to `snippet`. */
  content?: string | null
}

/** Tavily-shaped response envelope the proxy returns. */
export interface PpioSearchResponse {
  /** Optional provider-generated answer text. */
  answer?: string | null
  results?: PpioSearchResult[]
}

/** The proxy's error envelope (best-effort; fields vary). */
export interface PpioSearchError {
  error?: { message?: string } | string
  message?: string
}
