// uiux §5.4 Layer 2 — Qualities Flip. The paper flips (3D, `--dur-flip`) to the qualities face: the
// SIX master-spec clusters (not five — §8.1 reconciliation, AC-5.4-2) as cards; the rep picks 2-3
// that resonate; then each seed contact is a swipe card assigned >= 1 cluster XOR `needsTime`. The
// framing caption stays doctrine-clean per §8.1's service-first reframe.

'use client';

import {
  ALL_QUALITY_CLUSTERS,
  QUALITY_CLUSTER_DEFINITIONS,
  clusterLabel,
} from '@/services/harvest-method/clusters';
import { MAX_SELECTED_CLUSTERS, MIN_SELECTED_CLUSTERS, QualityCluster } from '@/types/harvest-method';

import styles from '../ritual.module.css';

export interface QualitiesFlipSeed {
  contactId: string;
  name: string;
}

export interface QualitiesFlipAssignmentDraft {
  clusters: QualityCluster[];
  needsTime: boolean;
}

export interface QualitiesFlipLayerProps {
  selectedClusters: QualityCluster[];
  onToggleSelectedCluster: (cluster: QualityCluster) => void;
  seeds: QualitiesFlipSeed[];
  assignments: Record<string, QualitiesFlipAssignmentDraft>;
  onToggleAssignedCluster: (contactId: string, cluster: QualityCluster) => void;
  onToggleNeedsTime: (contactId: string) => void;
  onContinue: () => void;
  flipping?: boolean;
}

export default function QualitiesFlipLayer({
  selectedClusters,
  onToggleSelectedCluster,
  seeds,
  assignments,
  onToggleAssignedCluster,
  onToggleNeedsTime,
  onContinue,
  flipping = false,
}: QualitiesFlipLayerProps) {
  const everyoneCovered = seeds.every((s) => {
    const a = assignments[s.contactId];
    return a && (a.needsTime || a.clusters.length > 0);
  });
  const selectionValid =
    selectedClusters.length >= MIN_SELECTED_CLUSTERS && selectedClusters.length <= MAX_SELECTED_CLUSTERS;

  return (
    <section
      className={`${styles.paper} ${flipping ? styles.paperFlipping : ''}`}
      aria-label="Qualities Flip — Layer 2 of 3"
    >
      <p className={styles.eyebrow}>Layer 2 of 3 &middot; Qualities Flip</p>

      <p className={styles.framingCaption}>Service first: who has the qualities that thrive in this business?</p>

      <h2 className={styles.sectionPrompt}>Which of these live in your list?</h2>

      <div className={styles.clusterGrid} role="group" aria-label="The six quality clusters">
        {QUALITY_CLUSTER_DEFINITIONS.map((def) => {
          const isSelected = selectedClusters.includes(def.key);
          return (
            <button
              key={def.key}
              type="button"
              aria-pressed={isSelected}
              className={`${styles.clusterCard} ${isSelected ? styles.clusterCardSelected : ''}`}
              onClick={() => onToggleSelectedCluster(def.key)}
            >
              <span className={styles.clusterCardTitle}>{def.label}</span>
              <span className={styles.clusterCardDesc}>{def.description}</span>
            </button>
          );
        })}
      </div>

      {seeds.map((seed) => {
        const a = assignments[seed.contactId] ?? { clusters: [], needsTime: false };
        return (
          <div key={seed.contactId} className={styles.swipeCard}>
            <p className={styles.swipeName}>{seed.name}</p>
            <div className={styles.chipRow} role="group" aria-label={`Assign a quality to ${seed.name}`}>
              {ALL_QUALITY_CLUSTERS.map((cluster) => {
                const chosen = a.clusters.includes(cluster);
                return (
                  <button
                    key={cluster}
                    type="button"
                    aria-pressed={chosen}
                    className={`${styles.chip} ${chosen ? styles.chipSelected : ''}`}
                    onClick={() => onToggleAssignedCluster(seed.contactId, cluster)}
                  >
                    {clusterLabel(cluster)}
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={a.needsTime}
                className={`${styles.needsTimeBtn} ${a.needsTime ? styles.needsTimeSelected : ''}`}
                onClick={() => onToggleNeedsTime(seed.contactId)}
              >
                Need more time
              </button>
            </div>
          </div>
        );
      })}

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={!selectionValid || !everyoneCovered}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </section>
  );
}
