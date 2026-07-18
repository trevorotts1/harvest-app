// uiux AC-5.2-6 / master-spec §9.5 — independent-zone-failure, defense in depth. The Today page's
// data layer already isolates FETCH failures per zone (each zone's server-side query is wrapped in
// its own try/catch — see today.service.ts's `safeZone`, and the zone components below render a
// dedicated error/empty state when a zone's `status` is `'error'`). This boundary is the SECOND,
// independent layer: it catches a RENDER-time exception inside one zone's component tree (a bug in
// that zone's own JSX, not a data problem) so it can never blank the other five zones on the same
// page — an architectural guarantee, not a hope, exactly as the WP04 build unit requires.

import { Component, type ReactNode } from 'react';

import styles from '../today.module.css';

interface Props {
  zoneName: string;
  children: ReactNode;
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
      return (
        <section className={styles.zoneCard} data-zone-error={this.props.zoneName}>
          <p className={styles.zoneErrorText}>
            We could not show your {this.props.zoneName} right now — the rest of Today is unaffected.
          </p>
        </section>
      );
    }
    return this.props.children;
  }
}
