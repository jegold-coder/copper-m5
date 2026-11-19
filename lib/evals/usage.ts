// Adds up what one question cost: model calls, tokens, dollars and time.
// Questions run one at a time, so every model call made while `fn` runs
// belongs to it.
import { onAiCall } from "@/lib/ai/call";
import type { Usage } from "@/lib/evals/checks";

export async function measure<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; usage: Usage }> {
  const usage: Usage = {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    seconds: 0,
  };
  const stop = onAiCall((row) => {
    // Embeddings (search_docs) report no tokens or cost, so they add 0.
    usage.modelCalls++;
    usage.inputTokens += row.input_tokens ?? 0;
    usage.outputTokens += row.output_tokens ?? 0;
    usage.costUsd += row.cost_usd ?? 0;
  });
  const started = performance.now();
  try {
    const value = await fn();
    usage.seconds = (performance.now() - started) / 1000;
    return { value, usage };
  } finally {
    stop();
  }
}
