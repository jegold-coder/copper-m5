// @vitest-environment node
// The golden-set evaluation: asks Ask Copper every question in the golden set,
// checks the tools it used, has an AI judge grade each answer, and records the
// scores in Langfuse as one experiment run. Fails when too few answers pass.
//
//   npm run eval                  (needs the Google and Langfuse keys)
//   EVAL_MIN_PASS_RATE=0.9 npm run eval
//
// Runs in GitHub Actions on every pull request (see .github/workflows/ci.yml).
import { existsSync } from "node:fs";
import { LangfuseClient } from "@langfuse/client";
import { describe, expect, it } from "vitest";
import { startTracing } from "@/lib/ai/tracing";
import { checkCase, type RunResult } from "@/lib/evals/checks";
import { GOLDEN_SET } from "@/lib/evals/golden-set";
import { judge, PASS_SCORE } from "@/lib/evals/judge";
import { runTwoAgents } from "@/lib/evals/run-copper";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

/** The golden-set case an experiment item was made from. */
function caseOf(metadata: unknown) {
  const id = (metadata as { id?: string } | null | undefined)?.id;
  const found = GOLDEN_SET.find((g) => g.id === id);
  if (!found) throw new Error(`No golden-set case "${id}"`);
  return found;
}

const MIN_PASS_RATE = Number(process.env.EVAL_MIN_PASS_RATE ?? "0.8");
const ready = Boolean(
  process.env.GOOGLE_GENERATIVE_AI_API_KEY &&
  process.env.LANGFUSE_PUBLIC_KEY &&
  process.env.LANGFUSE_SECRET_KEY,
);

// In CI a missing key must fail the check, not quietly skip it.
describe.skipIf(!ready && !process.env.CI)("golden set", () => {
  it(`passes at least ${MIN_PASS_RATE * 100}% of the questions`, async () => {
    expect(ready, "Google and Langfuse keys are set").toBe(true);
    const tracing = await startTracing();
    const langfuse = new LangfuseClient();

    const result = await langfuse.experiment.run({
      name: "ask-copper-golden-set",
      runName: `two-agents ${process.env.GITHUB_SHA?.slice(0, 7) ?? "local"} ${new Date().toISOString()}`,
      description: "Copper and the Refund agent on the golden set",
      metadata: {
        setup: "two-agents",
        commit: process.env.GITHUB_SHA ?? "local",
      },
      data: GOLDEN_SET.map((c) => ({
        input: c.question,
        expectedOutput: c.reference,
        metadata: { id: c.id, category: c.category },
      })),
      // One at a time: a free Google key allows only so many requests a minute.
      maxConcurrency: 1,
      task: async ({ metadata }) => {
        return runTwoAgents(caseOf(metadata));
      },
      evaluators: [
        async ({ input, output, expectedOutput, metadata }) => {
          const failures = checkCase(caseOf(metadata), output as RunResult);
          const verdict = await judge({
            question: String(input),
            reference: String(expectedOutput),
            answer: (output as RunResult).reply,
          });
          const passed = failures.length === 0 && verdict.score >= PASS_SCORE;
          return [
            {
              name: "judge_score",
              value: verdict.score,
              comment: verdict.reason,
            },
            {
              name: "code_checks",
              value: failures.length === 0 ? 1 : 0,
              comment: failures.join("; ") || "all checks passed",
            },
            { name: "passed", value: passed ? 1 : 0 },
          ];
        },
      ],
      runEvaluators: [
        async ({ itemResults }) => {
          const value = (name: string, r: (typeof itemResults)[number]) =>
            Number(r.evaluations.find((e) => e.name === name)?.value ?? 0);
          // A question that errored has no result, and counts as a fail.
          const total = GOLDEN_SET.length;
          return [
            {
              name: "pass_rate",
              value:
                itemResults.reduce((n, r) => n + value("passed", r), 0) / total,
            },
            {
              name: "average_judge_score",
              value:
                itemResults.reduce((n, r) => n + value("judge_score", r), 0) /
                total,
            },
          ];
        },
      ],
    });

    console.log(await result.format({ includeItemResults: true }));
    await tracing?.flush();
    await langfuse.flush();

    const passRate = Number(
      result.runEvaluations.find((e) => e.name === "pass_rate")?.value ?? 0,
    );
    expect(passRate).toBeGreaterThanOrEqual(MIN_PASS_RATE);
  }, 600_000);
});
