// Sends a trace of every AI call to Langfuse (observability). The running app
// starts it from instrumentation.ts; the golden-set evaluation starts it too,
// so its runs are traced the same way.

/** True when both Langfuse keys are set. */
export function isTracingConfigured(): boolean {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
  );
}

let started: Promise<{ flush: () => Promise<void> } | null> | undefined;

/**
 * Starts tracing once. With no Langfuse keys it does nothing and returns null.
 * `flush()` sends whatever is still waiting, for a script about to exit.
 */
export function startTracing() {
  started ??= (async () => {
    if (!isTracingConfigured()) return null;
    const { registerTelemetry } = await import("ai");
    const { OpenTelemetry } = await import("@ai-sdk/otel");
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { LangfuseSpanProcessor } = await import("@langfuse/otel");

    const processor = new LangfuseSpanProcessor({
      // Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL.
      // On Vercel the function can freeze right after replying, so send each
      // span at once instead of in batches.
      exportMode: process.env.VERCEL ? "immediate" : "batched",
    });
    const sdk = new NodeSDK({
      serviceName: "copper-state-labs",
      spanProcessors: [processor],
    });
    sdk.start();

    // Makes every generateText / streamText / embedMany call emit a trace.
    registerTelemetry(new OpenTelemetry());
    return { flush: () => processor.forceFlush() };
  })();
  return started;
}
