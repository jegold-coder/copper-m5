// Runs one golden-set question through Ask Copper exactly as the chat panel
// does (askCopper), and reads back the reply, who wrote it and the tools used.
import { finalValue } from "@/lib/ai/live";
import { askCopper } from "@/lib/copper/assistant/ask";
import { toolCallsOf } from "@/lib/copper/assistant/progress";
import { withRetry } from "@/lib/evals/retry";
import type { RunResult } from "@/lib/evals/checks";
import type { GoldenCase } from "@/lib/evals/golden-set";

/** The current setup: Copper, plus the Refund agent on the Support page. */
export function runTwoAgents(c: GoldenCase): Promise<RunResult> {
  // askCopper turns a failed model call into a "Sorry" reply. Here that is a
  // failure of the run, not an answer to grade, so retry it.
  return withRetry(() => ask(c));
}

async function ask(c: GoldenCase): Promise<RunResult> {
  const { progress } = await askCopper({
    messages: [{ role: "user", content: c.question }],
    useTools: true,
    desk: c.desk,
  });
  const done = await finalValue(progress);
  if (done.status === "error") throw new Error("Ask Copper failed to answer");
  return {
    reply: done.reply,
    agent: done.agent ?? "copper",
    tools: toolCallsOf(done).map((call) => call.name),
  };
}
