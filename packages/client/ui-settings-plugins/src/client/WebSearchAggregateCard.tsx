/**
 * The aggregated web-search card: one provider select plus the controls of the
 * selected provider. Choosing the empty value stages auto-select and shows the
 * DeepSeek controls (the shipped default); choosing PPIO swaps to its controls.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { WebSearchAggregateFace } from './web-search-aggregate-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the aggregated web-search card. */
export type WebSearchAggregateCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WebSearchAggregateFace>

/**
 * Render the aggregated web-search card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function WebSearchAggregateCard(props: WebSearchAggregateCardProps) {
  const { t } = props
  const state = props.useWebSearchAggregate(snapshot => snapshot)
  const showPpio = state.provider.text === 'ppio'
  const fields = showPpio ? state.ppio : state.deepseek
  const prefix = showPpio ? 'ppio.' : 'deepseek.'
  return (
    <PluginCard
      t={t}
      titleKey="webSearchTitle"
      descriptionKey="webSearchAggregateDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-web-search-provider"
        label={t('webSearchProvider')}
        hint={t('webSearchProviderHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={!state.writable}
        options={[
          { value: '', label: t('webSearchProviderAuto') },
          { value: 'deepseek-official', label: 'DeepSeek' },
          { value: 'ppio', label: 'PPIO' },
        ]}
        {...state.provider}
        onEdit={(text) => { props.edit('searchProvider', text) }}
        onReset={() => { props.resetField('searchProvider') }}
      />
      <SecretField
        id="plugin-config-web-search-key"
        label={t('webSearchApiKey')}
        hint={t('webSearchApiKeyHint')}
        disabled={!fields.apiKeyWritable}
        text={fields.apiKey.text}
        configured={fields.apiKeyConfigured}
        stateLabel={fields.apiKeyConfigured ? t('webSearchApiKeySet') : t('webSearchApiKeyUnset')}
        onEdit={(text) => { props.edit(`${prefix}apiKey`, text) }}
      />
      <ValueField
        id="plugin-config-web-search-endpoint"
        label={t('webSearchBaseUrl')}
        hint={t('webSearchBaseUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={!state.writable}
        {...fields.baseURL}
        onEdit={(text) => { props.edit(`${prefix}baseURL`, text) }}
        onReset={() => { props.resetField(`${prefix}baseURL`) }}
      />
      <ValueField
        id="plugin-config-web-search-model"
        label={t('webSearchModel')}
        hint={t('webSearchModelHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={!state.writable}
        {...fields.model}
        onEdit={(text) => { props.edit(`${prefix}model`, text) }}
        onReset={() => { props.resetField(`${prefix}model`) }}
      />
      {!showPpio && fields.maxUses !== undefined
        ? (
          <ValueField
            id="plugin-config-web-search-max-uses"
            label={t('webSearchMaxUses')}
            hint={t('webSearchMaxUsesHint')}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('invalidNumber')}
            numeric
            disabled={!state.writable}
            {...fields.maxUses}
            onEdit={(text) => { props.edit(`${prefix}maxUses`, text) }}
            onReset={() => { props.resetField(`${prefix}maxUses`) }}
          />
        )
        : null}
    </PluginCard>
  )
}
