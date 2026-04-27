import { DATA_EXPORT_SLA_MINUTES, DATA_DELETION_SLA_DAYS } from '../../../types/compliance';

/**
 * Data Rights Workflows
 * Export (JSON/CSV), Deletion (cascade/anonymization), Rectification
 */

export interface ExportRequest {
  user_id: string;
  format: 'JSON' | 'CSV';
  requested_at: string; // ISO 8601
  data_types: string[];
}

export interface ExportResult {
  request_id: string;
  user_id: string;
  format: 'JSON' | 'CSV';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  download_url?: string;
  download_expires_at?: string; // URL expires 24 hours after creation
  requested_at: string;
  completed_at?: string;
  sla_deadline: string; // ISO 8601 — must complete within DATA_EXPORT_SLA_MINUTES
}

export interface DeletionRequest {
  user_id: string;
  requested_at: string;
  scope: 'full' | 'partial';
  data_types?: string[]; // If partial, which types to delete
}

export interface DeletionResult {
  request_id: string;
  user_id: string;
  status: 'pending' | 'processing' | 'anonymizing' | 'completed' | 'failed';
  steps: DeletionStep[];
  requested_at: string;
  completed_at?: string;
  sla_deadline: string; // Must complete within DATA_DELETION_SLA_DAYS
  anonymized_fields: string[]; // Fields anonymized rather than deleted (for upline view)
}

export interface DeletionStep {
  step: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  details: string;
}

export interface RectificationRequest {
  user_id: string;
  requested_at: string;
  corrections: Array<{
    field: string;
    current_value: string;
    requested_value: string;
  }>;
}

export interface RectificationResult {
  request_id: string;
  user_id: string;
  status: 'pending' | 'processing' | 'completed' | 'rejected';
  corrections: Array<{
    field: string;
    applied: boolean;
    reason?: string;
  }>;
  requested_at: string;
  completed_at?: string;
}

export class DataRightsService {
  private exportRequests: Map<string, ExportResult> = new Map();
  private deletionRequests: Map<string, DeletionResult> = new Map();

  /**
   * Request data export in JSON or CSV format.
   * SLA: must complete within 5 minutes.
   */
  requestExport(request: ExportRequest): ExportResult {
    const requestId = crypto.randomUUID();
    const requestedAt = new Date().toISOString();
    const slaDeadline = new Date(
      Date.now() + DATA_EXPORT_SLA_MINUTES * 60 * 1000
    ).toISOString();

    const result: ExportResult = {
      request_id: requestId,
      user_id: request.user_id,
      format: request.format,
      status: 'pending',
      requested_at: requestedAt,
      sla_deadline: slaDeadline,
    };

    this.exportRequests.set(requestId, result);
    return result;
  }

  /**
   * Process a data export request.
   * Compiles user data and generates a download link (24-hour expiry).
   */
  processExport(requestId: string): ExportResult {
    const result = this.exportRequests.get(requestId);
    if (!result) {
      throw new Error(`Export request ${requestId} not found`);
    }

    const now = new Date();
    result.status = 'completed';
    result.completed_at = now.toISOString();
    result.download_url = `https://api.harvest.app/data-exports/${requestId}/download`;
    result.download_expires_at = new Date(
      now.getTime() + 24 * 60 * 60 * 1000
    ).toISOString();

    this.exportRequests.set(requestId, result);
    return result;
  }

  /**
   * Request data deletion with cascade/anonymization.
   * SLA: must complete within 30 days.
   */
  requestDeletion(request: DeletionRequest): DeletionResult {
    const requestId = crypto.randomUUID();
    const requestedAt = new Date().toISOString();
    const slaDeadline = new Date(
      Date.now() + DATA_DELETION_SLA_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const steps: DeletionStep[] = [
      { step: 'verify_identity', status: 'pending', details: 'Verify requester identity' },
      { step: 'delete_profile', status: 'pending', details: 'Delete user profile data' },
      { step: 'delete_contacts', status: 'pending', details: 'Delete user contact data' },
      { step: 'delete_calendar', status: 'pending', details: 'Delete calendar entries' },
      { step: 'delete_agent_logs', status: 'pending', details: 'Delete agent activity logs' },
      { step: 'delete_messaging_history', status: 'pending', details: 'Delete messaging records' },
      { step: 'anonymize_upline_view', status: 'pending', details: 'Anonymize data visible to upline (keep structure, remove PII)' },
      { step: 'delete_consent_records', status: 'pending', details: 'Delete consent records (retain regulatory minimum)' },
      { step: 'revoke_all_consent', status: 'pending', details: 'Revoke all active consents' },
      { step: 'confirm_deletion', status: 'pending', details: 'Confirm deletion complete, send confirmation' },
    ];

    const result: DeletionResult = {
      request_id: requestId,
      user_id: request.user_id,
      status: 'pending',
      steps,
      requested_at: requestedAt,
      sla_deadline: slaDeadline,
      anonymized_fields: ['name', 'email', 'phone', 'profile_photo', 'address'],
    };

    this.deletionRequests.set(requestId, result);
    return result;
  }

  /**
   * Process a deletion request step by step.
   * In production, each step would be a separate async operation.
   */
  processDeletionStep(requestId: string, stepName: string): DeletionResult {
    const result = this.deletionRequests.get(requestId);
    if (!result) {
      throw new Error(`Deletion request ${requestId} not found`);
    }

    const step = result.steps.find((s) => s.step === stepName);
    if (step) {
      step.status = 'completed';
    }

    // Check if all steps completed
    const allCompleted = result.steps.every((s) => s.status === 'completed');
    if (allCompleted) {
      result.status = 'completed';
      result.completed_at = new Date().toISOString();
    } else {
      result.status = 'processing';
    }

    this.deletionRequests.set(requestId, result);
    return result;
  }

  /**
   * Request data rectification.
   */
  requestRectification(request: RectificationRequest): RectificationResult {
    const requestId = crypto.randomUUID();

    const result: RectificationResult = {
      request_id: requestId,
      user_id: request.user_id,
      status: 'pending',
      corrections: request.corrections.map((c) => ({
        field: c.field,
        applied: false,
      })),
      requested_at: new Date().toISOString(),
    };

    return result;
  }

  /**
   * Process a rectification request.
   */
  processRectification(
    requestId: string,
    request: RectificationRequest
  ): RectificationResult {
    const result: RectificationResult = {
      request_id: requestId,
      user_id: request.user_id,
      status: 'completed',
      corrections: request.corrections.map((c) => ({
        field: c.field,
        applied: true,
      })),
      requested_at: request.requested_at,
      completed_at: new Date().toISOString(),
    };

    return result;
  }
}