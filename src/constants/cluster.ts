/**
 * Cluster worker restart configuration.
 * Shared by every service's clustered `server.ts` bootstrap.
 */
export const CLUSTER_CONFIG = {
  /**
   * Maximum number of worker restarts allowed per time window.
   * Prevents infinite restart loops (fork bomb).
   */
  MAX_RESTARTS_PER_MINUTE: 5,
  /**
   * Time window in milliseconds for restart limit (1 minute).
   * Restart count resets after this window.
   */
  RESTART_WINDOW_MS: 60000,
  /**
   * Maximum delay before restarting a crashed worker (in milliseconds).
   * Delay increases with restart count: 1s, 2s, 3s... up to this max.
   */
  MAX_RESTART_DELAY_MS: 5000,
} as const;
