/**
 * `@deepseek-ai/dsh-web-search-ppio`: registers a PPIO proxy-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): it registers INTO the seam's provider registry, like
 * `@deepseek-ai/dsh-web-search-deepseek` registers a provider into `ctx.web`.
 *
 * The proxy's `/web-search` endpoint is a plain retrieval call, so the key
 * resolves from the credentials seam (or the launching environment) per search,
 * the same way the DeepSeek provider does — the literal never rides a response.
 * The `web-search-ppio` settings section lets a configuration surface edit the
 * endpoint and model; the provider projects the section per search, so a
 * committed change needs no re-registration.
 * @module @deepseek-ai/dsh-web-search-ppio
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  PPIO_DEFAULT_API_KEY_ENV,
  PPIO_DEFAULT_BASE_URL,
  PPIO_DEFAULT_MODEL,
  PpioSearchProvider,
} from './provider.ts'
import type { PpioSearchProviderOptions } from './provider.ts'

export {
  PPIO_DEFAULT_API_KEY_ENV,
  PPIO_DEFAULT_BASE_URL,
  PPIO_DEFAULT_MODEL,
  PPIO_PROVIDER_ID,
  PpioSearchProvider,
} from './provider.ts'
export type { PpioSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-ppio'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills constant defaults). */
export interface Config {
  /** Literal proxy API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `PPIO_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/web-search` is appended. */
  baseURL?: string
  /** Search model name. Defaults to `ppio-tavily-search`. */
  model?: string
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(PPIO_DEFAULT_API_KEY_ENV),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string(),
  model: z.string().default(PPIO_DEFAULT_MODEL),
})

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const WEB_SEARCH_PPIO_SETTINGS_NAMESPACE = settingsNamespace('web-search-ppio')

/**
 * Project one resolved section into the options the provider serves its next
 * search with.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx: Context, config: Config): PpioSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? PPIO_DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? PPIO_DEFAULT_BASE_URL,
    model: config.model ?? PPIO_DEFAULT_MODEL,
  }
}

/** Register the PPIO proxy search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_PPIO_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per search, so a committed change needs no re-registration.
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new PpioSearchProvider(() => resolveOptions(ctx, current())))
}
