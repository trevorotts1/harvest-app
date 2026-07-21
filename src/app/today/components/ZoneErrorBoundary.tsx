// uiux AC-5.2-6 / master-spec §9.5 — independent-zone-failure, defense in depth. The Today page's
// data layer already isolates FETCH failures per zone (each zone's server-side query is wrapped in
// its own try/catch — see today.service.ts's `safeZone`, and the zone components below render a
// dedicated error/empty state when a zone's `status` is `'error'`). This boundary is the SECOND,
// independent layer: it catches a RENDER-time exception inside one zone's component tree (a bug in
// that zone's own JSX, not a data problem) so it can never blank the other five zones on the same
// page — an architectural guarantee, not a hope, exactly as the WP04 build unit requires.

import { Component, type ReactNode } from 'react';

import styles from '../today.module.css';
import { t } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

interface Props {
  zoneName: string;
  children: ReactNode;
  /** T-R32b (§17.5 locale-aware copy) — optional, defaults to EN, so every existing caller keeps
   *  compiling and rendering byte-identical output. A class component's `render()` can't call a
   *  hook (`useT()`/`useLocale()`) — this uses the pure `t(locale, key, vars)` catalog function
   *  instead, the same pattern `ActionQueue`'s own `locale` prop uses for the identical reason. */
  locale?: Locale;
}

interface State {
  hasError: boolean;
}

export default class ZoneErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      const locale = this.props.locale ?? DEFAULT_LOCALE;
      return (
        <section className={styles.zoneCard} data-zone-error={this.props.zoneName}>
          <p className={styles.zoneErrorText}>
            {t(locale, 'today.zoneErrorBoundary.message', { zone: this.props.zoneName })}
          </p>
        </section>
      );
    }
    return this.props.children;
  }
}
