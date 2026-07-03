// `axios` is an OPTIONAL peer — type-only import (erased at compile) plus a lazy
// require inside the factory, so importing this module never pulls axios unless
// the HTTP client is actually created.
import type {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import { HEADERS } from '../constants';
import logger from '../helpers/logger.helper';
import { asyncLocalStorage } from '../helpers/asyncLocalStorage.helper';

export interface HttpRetryConfig {
  /** Max retry attempts after the initial request. */
  retries: number;
  /** Base delay between retries in ms (exponential back-off). Default 300. */
  retryDelayMs?: number;
  /** HTTP statuses to retry. Default [502, 503, 504]. Network errors always retry. */
  retryOnStatuses?: number[];
}

export interface HttpClientConfig {
  baseURL?: string;
  /** Request timeout in ms. Default 30000. */
  timeout?: number;
  /** Default headers merged into every request. */
  headers?: Record<string, string>;
  /**
   * Async hook returning a bearer token; injected as `Authorization: Bearer`.
   * Use this for OAuth2 client-credentials providers (Ruya, XChain, …).
   */
  getAuthToken?: () => Promise<string | undefined> | string | undefined;
  /** Retry transient failures. Off by default. */
  retry?: HttpRetryConfig;
  /** Propagate the ambient correlation id as x-correlation-id. Default true. */
  propagateCorrelationId?: boolean;
  /** Debug-log requests/responses + error-log failures. Default true. */
  logging?: boolean;
  /** Name used in log lines (e.g. 'ruya', 'xchain'). */
  name?: string;
}

interface RetryableConfig extends InternalAxiosRequestConfig {
  __retryCount?: number;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create a pre-configured Axios instance shared across services.
 *
 * Built-in behaviour (all opt-out):
 *  - propagates the ambient correlation id (from AsyncLocalStorage) as
 *    `x-correlation-id`, so downstream services stay on the same trace;
 *  - injects a bearer token via the `getAuthToken` hook;
 *  - structured debug logging of requests/responses and error logging of
 *    failures through the shared logger;
 *  - optional exponential-backoff retry for network errors / 5xx.
 *
 *   const ruya = createHttpClient({
 *     name: 'ruya', baseURL: cfg.baseURL, timeout: cfg.timeout,
 *     getAuthToken: () => tokenService.getAccessToken(),
 *     retry: { retries: 2 },
 *   });
 *   const { data } = await ruya.post('/accounts', payload);
 */
export function createHttpClient(config: HttpClientConfig = {}): AxiosInstance {
  const name = config.name || 'http';
  const logEnabled = config.logging !== false;
  const propagateCid = config.propagateCorrelationId !== false;
  const retryOn = config.retry?.retryOnStatuses ?? [502, 503, 504];
  const retryDelayMs = config.retry?.retryDelayMs ?? 300;

  const axios = require('axios').default ?? require('axios');
  const instance: AxiosInstance = axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout ?? 30000,
    headers: { 'Content-Type': 'application/json', ...config.headers },
  });

  instance.interceptors.request.use(
    async (req: InternalAxiosRequestConfig) => {
      if (propagateCid) {
        const cid = asyncLocalStorage.getStore()?.correlationId;
        if (cid && !req.headers[HEADERS.CORRELATION_ID]) {
          req.headers[HEADERS.CORRELATION_ID] = cid;
        }
      }
      if (config.getAuthToken) {
        const token = await config.getAuthToken();
        if (token) req.headers.Authorization = `Bearer ${token}`;
      }
      if (logEnabled) {
        logger.debug(`→ [${name}] ${req.method?.toUpperCase()} ${req.url}`);
      }
      return req;
    },
    (error: AxiosError) => {
      logger.error(`[${name}] request error`, { error: error.message });
      return Promise.reject(error);
    },
  );

  instance.interceptors.response.use(
    (response) => {
      if (logEnabled) {
        logger.debug(`← [${name}] ${response.status} ${response.config.url}`);
      }
      return response;
    },
    async (error: AxiosError) => {
      const cfg = error.config as RetryableConfig | undefined;
      const status = error.response?.status;
      const isNetworkError = !error.response;
      const retriable =
        !!config.retry &&
        !!cfg &&
        (isNetworkError || (status !== undefined && retryOn.includes(status)));

      if (retriable && cfg) {
        cfg.__retryCount = (cfg.__retryCount ?? 0) + 1;
        if (cfg.__retryCount <= config.retry!.retries) {
          const wait = retryDelayMs * 2 ** (cfg.__retryCount - 1);
          logger.warn(
            `[${name}] retry ${cfg.__retryCount}/${config.retry!.retries} after ${wait}ms`,
            { url: cfg.url, status: status ?? error.code },
          );
          await delay(wait);
          return instance.request(cfg);
        }
      }

      if (logEnabled) {
        logger.error(
          `✖ [${name}] ${cfg?.method?.toUpperCase()} ${cfg?.url} failed`,
          { status: status ?? error.code, error: error.message },
        );
      }
      return Promise.reject(error);
    },
  );

  return instance;
}
