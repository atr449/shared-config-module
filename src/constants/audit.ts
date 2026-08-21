/**
 * Audit-log messaging constants shared by every service that publishes to
 * baas-audit-log-service.
 *
 * The exchange is platform-wide (one Virtual Topic exchange, per-service
 * routing keys under it); the routing key itself stays in each service's
 * constants because it names that service.
 */
export const AUDIT_LOG_EXCHANGE = 'VirtualTopic.AuditLog';

/**
 * Must exactly match baas-audit-log-service's recordAuditLogRequestSchema
 * status enum - anything else fails validation and gets dropped.
 */
export const AUDIT_STATUS = {
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
} as const;

export type AuditStatus = (typeof AUDIT_STATUS)[keyof typeof AUDIT_STATUS];
