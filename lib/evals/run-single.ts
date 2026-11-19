// Setup B: one support agent with every tool and no handoff
// (lib/copper/assistant/single-agent.ts), asked the same golden-set question.
import { stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import {
  singleAgentInstructions,
  singleAgentTools,
} from "@/lib/copper/assistant/single-agent";
import type { RunResult } from "@/lib/evals/checks";
import type { GoldenCase } from "@/lib/evals/golden-set";
import { withRetry } from "@/lib/evals/retry";
import { measure } from "@/lib/evals/usage";

// Same limit as each agent in ask.ts.
const MAX_STEPS = 5;

export function runSingleAgent(c: GoldenCase): Promise<RunResult> {
  return withRetry(async () => {
    const { value, usage } = await measure(async () => {
      const result = callStream(
        { module: 5, feature: "single-agent" },
        {
          messages: [{ role: "user", content: c.question }],
          providerOptions: THOUGHT_SUMMARIES,
          instructions: singleAgentInstructions(c.desk),
          tools: singleAgentTools(c.desk),
          stopWhen: stepCountIs(MAX_STEPS),
        },
      );
      // Like the chat panel, the reply is all the text across the steps.
      const steps = await result.steps;
      return {
        reply: steps.map((step) => step.text).join(""),
        tools: steps.flatMap((step) =>
          step.toolCalls.map((call) => call.toolName),
        ),
      };
    });
    if (!value.reply.trim()) throw new Error("The single agent said nothing");
    return { ...value, usage };
  });
}
