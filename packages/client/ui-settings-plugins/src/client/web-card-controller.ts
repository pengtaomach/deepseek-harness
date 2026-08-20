/**
 * The web seam's card: the provider that serves `web_search`. One staged
 * select field over the `web` settings namespace, no credential — provider
 * keys live on their owning provider cards.
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the web seam. Spelled here rather than imported: a client
 * package must not depend on a Host package.
 */
export const WEB_NS = 'web'

/** The provider-selection field this card edits. */
export interface WebSettings {
  /** Provider id serving `web_search`; blank resolves to the seam's auto-select. */
  searchProvider?: string
}

/** What the web card renders. */
export interface WebCardState extends CardShell {
  /** The selected search provider id, or blank for auto-select. */
  searchProvider: CardFieldState
}

/** The registration-side face the web card's slot entry injects. */
export interface WebCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useWebCard. */
    webCard: SnapshotStore<WebCardState>
  }
}

/** Bridges the `web` scope onto the card. */
export class WebCardController {
  private readonly form: CardForm<WebSettings>
  private readonly store: SnapshotStore<WebCardState>

  /**
   * @param scope - the bound settings scope for the `web` namespace.
   */
  constructor(scope: SettingsScope<WebSettings>) {
    this.form = new CardForm(scope, [textField('searchProvider')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): WebCardState {
    return {
      ...this.form.shell(),
      searchProvider: this.form.field('searchProvider'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): WebCardFace {
    return { hooks: { webCard: this.store }, ...this.form.actions() }
  }
}
