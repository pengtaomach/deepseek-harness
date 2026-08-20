/**
 * The aggregated web-search card's controller. One card edits three settings
 * namespaces — the web seam's provider selection plus the DeepSeek and PPIO
 * provider sections — behind one form. The provider field decides which
 * provider's controls the card renders; the member controllers keep their own
 * staging, credentials, and revision fencing, and this controller republishes
 * one combined snapshot and one save/discard over all three.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { CardActions, CardFieldState, CardShell } from './card-form.ts'
import { WebCardController, type WebSettings } from './web-card-controller.ts'
import { WebSearchCardController, type WebSearchSettings } from './web-search-card-controller.ts'
import { WebSearchPpioCardController, type WebSearchPpioSettings } from './web-search-ppio-card-controller.ts'

/** One provider's controls as the aggregate card renders them. */
export interface ProviderFields {
  baseURL: CardFieldState
  model: CardFieldState
  /** Present only for the DeepSeek provider. */
  maxUses?: CardFieldState
  apiKey: CardFieldState
  apiKeyConfigured: boolean
  apiKeyWritable: boolean
}

/** What the aggregated web-search card renders. */
export interface WebSearchAggregateState extends CardShell {
  /** The selected provider id, or blank for auto-select. */
  provider: CardFieldState
  /** DeepSeek provider controls. */
  deepseek: ProviderFields
  /** PPIO provider controls. */
  ppio: ProviderFields
}

/** The registration-side face the aggregated web-search card's slot entry injects. */
export interface WebSearchAggregateFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useWebSearchAggregate. */
    webSearchAggregate: SnapshotStore<WebSearchAggregateState>
  }
}

/** Composite field name prefixes routing an edit to the owning controller. */
const DEEPSEEK_PREFIX = 'deepseek.'
const PPIO_PREFIX = 'ppio.'

/** Bridges the `web`, `web-search-deepseek`, and `web-search-ppio` scopes onto one card. */
export class WebSearchAggregateController {
  private readonly web: WebCardController
  private readonly deepseek: WebSearchCardController
  private readonly ppio: WebSearchPpioCardController
  private readonly store: SnapshotStore<WebSearchAggregateState>

  /**
   * @param webScope - the bound scope for the `web` namespace.
   * @param deepseekScope - the bound scope for the `web-search-deepseek` namespace.
   * @param ppioScope - the bound scope for the `web-search-ppio` namespace.
   * @param api - wire face used for the two providers' credentials.
   */
  constructor(
    webScope: SettingsScope<WebSettings>,
    deepseekScope: SettingsScope<WebSearchSettings>,
    ppioScope: SettingsScope<WebSearchPpioSettings>,
    api: Pick<IApiClient, 'credentials'>,
  ) {
    this.web = new WebCardController(webScope)
    this.deepseek = new WebSearchCardController(deepseekScope, api)
    this.ppio = new WebSearchPpioCardController(ppioScope, api)
    this.store = createSnapshotStore(this.projection())
    this.web.inject().hooks.webCard.subscribe(() => { this.store.set(this.projection()) })
    this.deepseek.inject().hooks.webSearchCard.subscribe(() => { this.store.set(this.projection()) })
    this.ppio.inject().hooks.webSearchPpioCard.subscribe(() => { this.store.set(this.projection()) })
  }

  private projection(): WebSearchAggregateState {
    const web = this.web.inject().hooks.webCard.getSnapshot()
    const deepseek = this.deepseek.inject().hooks.webSearchCard.getSnapshot()
    const ppio = this.ppio.inject().hooks.webSearchPpioCard.getSnapshot()
    return {
      // The card renders only when every section it edits is served, and is
      // dirty/invalid/saving/failed when any member is.
      available: web.available && deepseek.available && ppio.available,
      writable: web.writable && deepseek.writable && ppio.writable,
      dirty: web.dirty || deepseek.dirty || ppio.dirty,
      invalid: web.invalid || deepseek.invalid || ppio.invalid,
      saving: web.saving || deepseek.saving || ppio.saving,
      failed: web.failed || deepseek.failed || ppio.failed,
      provider: web.searchProvider,
      deepseek: {
        baseURL: deepseek.baseURL,
        model: deepseek.model,
        maxUses: deepseek.maxUses,
        apiKey: deepseek.apiKey,
        apiKeyConfigured: deepseek.apiKeyConfigured,
        apiKeyWritable: deepseek.apiKeyWritable,
      },
      ppio: {
        baseURL: ppio.baseURL,
        model: ppio.model,
        apiKey: ppio.apiKey,
        apiKeyConfigured: ppio.apiKeyConfigured,
        apiKeyWritable: ppio.apiKeyWritable,
      },
    }
  }

  /**
   * Re-read the provider whose reference the Host reports changed.
   * @param ref - the credential reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    this.deepseek.refreshCredential(ref)
    this.ppio.refreshCredential(ref)
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's combined snapshot and routed actions.
   */
  inject(): WebSearchAggregateFace {
    const web = this.web.inject()
    const deepseek = this.deepseek.inject()
    const ppio = this.ppio.inject()
    return {
      hooks: { webSearchAggregate: this.store },
      edit: (field, text) => {
        if (field === 'searchProvider') web.edit('searchProvider', text)
        else if (field.startsWith(DEEPSEEK_PREFIX)) deepseek.edit(field.slice(DEEPSEEK_PREFIX.length), text)
        else if (field.startsWith(PPIO_PREFIX)) ppio.edit(field.slice(PPIO_PREFIX.length), text)
        else throw new Error(`aggregated web-search card has no field ${field}`)
      },
      resetField: (field) => {
        if (field === 'searchProvider') web.resetField('searchProvider')
        else if (field.startsWith(DEEPSEEK_PREFIX)) deepseek.resetField(field.slice(DEEPSEEK_PREFIX.length))
        else if (field.startsWith(PPIO_PREFIX)) ppio.resetField(field.slice(PPIO_PREFIX.length))
        else throw new Error(`aggregated web-search card has no field ${field}`)
      },
      save: () => {
        web.save()
        deepseek.save()
        ppio.save()
      },
      discard: () => {
        web.discard()
        deepseek.discard()
        ppio.discard()
      },
    }
  }
}
