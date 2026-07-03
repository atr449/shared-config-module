import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { getSharedConfig } from '../runtime/config';

export interface StartTracingOptions {
  /** Override the OTLP gRPC endpoint. Defaults to OTEL_EXPORTER_OTLP_ENDPOINT. */
  endpoint?: string;
  /** Override the reported service name. Defaults to the shared runtime config. */
  serviceName?: string;
  /** Metric export interval in ms. Defaults to 60s. */
  metricExportIntervalMillis?: number;
}

let sdk: NodeSDK | null = null;

/**
 * Initialise OpenTelemetry tracing + metrics for the current service.
 *
 * Must be called **once, as early as possible** in the bootstrap (before the
 * libraries you want to auto-instrument are required). No-ops when the OTLP
 * endpoint is not configured, so it is safe to call unconditionally.
 *
 * Returns the started {@link NodeSDK} (or `null` when tracing is disabled).
 */
export function startTracing(
  options: StartTracingOptions = {},
): NodeSDK | null {
  if (sdk) {
    return sdk;
  }

  const endpoint = options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!endpoint) {
    console.log(
      '[OTEL] OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled',
    );
    return null;
  }

  const cfg = getSharedConfig();
  const serviceName =
    options.serviceName || process.env.OTEL_SERVICE_NAME || cfg.serviceName;
  const environment = process.env.NODE_ENV || cfg.nodeEnv;

  // Wraps the OTLP exporter and drops noisy spans before export.
  const innerExporter = new OTLPTraceExporter({ url: endpoint });
  const traceExporter = {
    export(spans: any[], cb: (result: any) => void): void {
      const kept = spans.filter((s: any) => {
        if (s.name.startsWith('middleware - ')) return false;
        // ioredis sends CLIENT SETINFO on connect; Redis <7.2 rejects it.
        const stmt: string = s.attributes?.['db.statement'] ?? '';
        if (stmt.includes('SETINFO')) return false;
        return true;
      });
      if (kept.length === 0) {
        cb({ code: 0 });
        return;
      }
      innerExporter.export(kept, cb);
    },
    shutdown(): Promise<void> {
      return innerExporter.shutdown();
    },
    forceFlush(): Promise<void> {
      return (innerExporter as any).forceFlush?.() ?? Promise.resolve();
    },
  };

  const metricExporter = new OTLPMetricExporter({ url: endpoint });
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: options.metricExportIntervalMillis ?? 60_000,
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': serviceName,
      'service.version': process.env.SERVICE_VERSION || cfg.serviceVersion,
      'deployment.environment': environment,
      'service.namespace': cfg.serviceNamespace,
    }),
    traceExporter: traceExporter as any,
    metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-winston': { enabled: false },
      }),
    ],
  });

  sdk.start();

  console.log(
    `[OTEL] Tracing + Metrics started → ${endpoint} gRPC (service: ${serviceName}, env: ${environment})`,
  );

  return sdk;
}

/** Gracefully flush and shut down the tracing SDK (call on SIGTERM/SIGINT). */
export async function stopTracing(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();

    console.log('[OTEL] Tracing shutdown complete');
  } catch (error) {
    console.error('[OTEL] Error during tracing shutdown:', error);
  } finally {
    sdk = null;
  }
}
