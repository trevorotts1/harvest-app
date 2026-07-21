// T-53 — i18n public barrel (master-spec §17.5, uiux §6.2).
export {
  type Locale,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  LOCALE_LABEL,
  LOCALE_BCP47,
  isLocale,
  detectLocaleFromAcceptLanguage,
  resolveLocale,
} from './locale';
export { t, tFrom, CATALOGS, flattenCatalog, pluralCategory, type CatalogTree, type TVars, type PluralCategory } from './catalog';
export { computeGrowthReport, type GrowthReport, type KeyGrowth } from './growth';
export { formatDate, formatDateTime, formatNumber, formatCurrencyUSD } from './format';
