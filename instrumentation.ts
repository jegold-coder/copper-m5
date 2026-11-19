// Next.js runs register() once when the server starts. It turns on tracing, so
// every AI call (each agent, its tool calls, tokens, cost and time) goes to
// Langfuse. With no Langfuse keys it does nothing, so the app still runs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTracing } = await import("@/lib/ai/tracing");
  await startTracing();
}
