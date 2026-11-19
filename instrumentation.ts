// Next.js runs register() once when the server starts. It sends a trace of
// every AI call (each agent, its tool calls, tokens, cost and time) to
// Langfuse. With no Langfuse keys it does nothing, so the app still runs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY)
    return;

  const { registerTelemetry } = await import("ai");
  const { OpenTelemetry } = await import("@ai-sdk/otel");
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { LangfuseSpanProcessor } = await import("@langfuse/otel");

  const sdk = new NodeSDK({
    serviceName: "copper-state-labs",
    spanProcessors: [
      new LangfuseSpanProcessor({
        // Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL.
        // On Vercel the function can freeze right after replying, so send each
        // span at once instead of in batches.
        exportMode: process.env.VERCEL ? "immediate" : "batched",
      }),
    ],
  });
  sdk.start();

  // Makes every generateText / streamText / embedMany call emit a trace.
  registerTelemetry(new OpenTelemetry());
}
