// @vitest-environment node
// The golden-set evaluation. Asks every question in the golden set to each
// agent setup (lib/evals/setups.ts): the two agents the app uses, and one
// agent with every tool. For each answer it checks the tools used, has an AI
// judge grade it, and records tokens, cost and time. Everything goes to
// Langfuse as one run per setup on the same dataset, so Langfuse can put them
// side by side. Fails when the shipped setup passes too few questions.
//
//   npm run eval                          (needs the Google and Langfuse keys)
//   EVAL_SETUPS=two-agents npm run eval   (just one setup)
//   EVAL_MIN_PASS_RATE=0.9 npm run eval
//
// Runs in GitHub Actions on every pull request (see .github/workflows/ci.yml).
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { LangfuseClient } from "@langfuse/client";
import { describe, expect, it } from "vitest";
import { startTracing } from "@/lib/ai/tracing";
import { checkCase, type RunResult } from "@/lib/evals/checks";
import { GOLDEN_SET } from "@/lib/evals/golden-set";
import { judge, PASS_SCORE } from "@/lib/evals/judge";
import { SETUPS, type Setup } from "@/lib/evals/setups";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const DATASET = "ask-copper-golden-set";
const MIN_PASS_RATE = Number(process.env.EVAL_MIN_PASS_RATE ?? "0.8");
const WANTED = (process.env.EVAL_SETUPS ?? SETUPS.map((s) => s.id).join(","))
  .split(",")
  .map((id) => id.trim());
const setups = SETUPS.filter((s) => WANTED.includes(s.id));

const ready = Boolean(
  process.env.GOOGLE_GENERATIVE_AI_API_KEY &&
  process.env.LANGFUSE_PUBLIC_KEY &&
  process.env.LANGFUSE_SECRET_KEY,
);

/** The golden-set case an experiment item was made from. */
function caseOf(metadata: unknown) {
  const id = (metadata as { id?: string } | null | undefined)?.id;
  const found = GOLDEN_SET.find((g) => g.id === id);
  if (!found) throw new Error(`No golden-set case "${id}"`);
  return found;
}

type Summary = {
  setup: Setup;
  passRate: number;
  judge: number;
  seconds: number;
  costUsd: number;
  tokens: number;
  modelCalls: number;
  url?: string;
};
const summaries: Summary[] = [];

const mean = (values: number[]) =>
  values.reduce((sum, v) => sum + v, 0) / (values.length || 1);

/** Puts the golden set in Langfuse as a dataset, so runs can be compared. */
async function syncDataset(langfuse: LangfuseClient) {
  await langfuse.api.datasets.create({
    name: DATASET,
    description: "Questions with known good answers for Ask Copper",
  });
  for (const c of GOLDEN_SET)
    await langfuse.api.datasetItems.create({
      datasetName: DATASET,
      id: `golden-${c.id}`,
      input: c.question,
      expectedOutput: c.reference,
      metadata: { id: c.id, category: c.category },
    });
}

async function runSetup(langfuse: LangfuseClient, setup: Setup) {
  const dataset = await langfuse.dataset.get(DATASET);

  const result = await dataset.runExperiment({
    name: `${DATASET}: ${setup.id}`,
    runName: `${setup.id} ${process.env.GITHUB_SHA?.slice(0, 7) ?? "local"} ${new Date().toISOString()}`,
    description: setup.label,
    metadata: { setup: setup.id, commit: process.env.GITHUB_SHA ?? "local" },
    // One at a time: a free Google key allows only so many requests a minute,
    // and one at a time lets each question's cost be measured on its own.
    maxConcurrency: 1,
    task: async ({ metadata }) => setup.run(caseOf(metadata)),
    evaluators: [
      async ({ input, output, expectedOutput, metadata }) => {
        const run = output as RunResult;
        const failures = checkCase(caseOf(metadata), run);
        const verdict = await judge({
          question: String(input),
          reference: String(expectedOutput),
          answer: run.reply,
        });
        const usage = run.usage;
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
          {
            name: "passed",
            value: failures.length === 0 && verdict.score >= PASS_SCORE ? 1 : 0,
          },
          { name: "seconds", value: usage?.seconds ?? 0 },
          { name: "cost_usd", value: usage?.costUsd ?? 0 },
          {
            name: "tokens",
            value: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
          },
          { name: "model_calls", value: usage?.modelCalls ?? 0 },
        ];
      },
    ],
    runEvaluators: [
      async ({ itemResults }) => {
        const all = (name: string) =>
          itemResults.map((r) =>
            Number(r.evaluations.find((e) => e.name === name)?.value ?? 0),
          );
        // A question that errored has no result, and counts as a fail.
        const passed = all("passed").reduce((sum, v) => sum + v, 0);
        return [
          { name: "pass_rate", value: passed / GOLDEN_SET.length },
          { name: "average_judge_score", value: mean(all("judge_score")) },
          { name: "average_seconds", value: mean(all("seconds")) },
          { name: "average_cost_usd", value: mean(all("cost_usd")) },
        ];
      },
    ],
  });

  const run = (name: string) =>
    Number(result.runEvaluations.find((e) => e.name === name)?.value ?? 0);
  const per = (name: string) =>
    mean(
      result.itemResults.map((r) =>
        Number(r.evaluations.find((e) => e.name === name)?.value ?? 0),
      ),
    );
  summaries.push({
    setup,
    passRate: run("pass_rate"),
    judge: run("average_judge_score"),
    seconds: run("average_seconds"),
    costUsd: run("average_cost_usd"),
    tokens: per("tokens"),
    modelCalls: per("model_calls"),
    url: result.experimentUrl,
  });
  console.log(await result.format({ includeItemResults: true }));
}

/** The side-by-side table, as markdown for the terminal and GitHub. */
function comparison() {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const head = [
    "Setup",
    "Pass rate",
    "Judge (1-5)",
    "Time / question",
    "Tokens / question",
    "Model calls",
    "Cost / question",
  ];
  return [
    line(head),
    line(head.map(() => "---")),
    ...summaries.map((s) =>
      line([
        s.setup.label,
        `${Math.round(s.passRate * 100)}%`,
        s.judge.toFixed(2),
        `${s.seconds.toFixed(1)} s`,
        String(Math.round(s.tokens)),
        s.modelCalls.toFixed(1),
        `$${s.costUsd.toFixed(5)}`,
      ]),
    ),
  ].join("\n");
}

// In CI a missing key must fail the check, not quietly skip it.
describe.skipIf(!ready && !process.env.CI)("golden set", () => {
  const shared: { tracing?: Awaited<ReturnType<typeof startTracing>> } = {};
  const langfuse = ready ? new LangfuseClient() : undefined;

  it("has its keys and the golden set in Langfuse", async () => {
    expect(ready, "Google and Langfuse keys are set").toBe(true);
    shared.tracing = await startTracing();
    await syncDataset(langfuse!);
  }, 120_000);

  for (const setup of setups)
    it(
      setup.gated
        ? `runs ${setup.id} and passes at least ${MIN_PASS_RATE * 100}%`
        : `runs ${setup.id} (compared, not gated)`,
      async () => {
        await runSetup(langfuse!, setup);
        await shared.tracing?.flush();
        await langfuse!.flush();
        const done = summaries.find((s) => s.setup.id === setup.id)!;
        if (setup.gated)
          expect(done.passRate).toBeGreaterThanOrEqual(MIN_PASS_RATE);
      },
      900_000,
    );

  it("compares the setups", () => {
    if (summaries.length < 2) return;
    const report = [
      "## Golden set: one agent vs two agents",
      "",
      comparison(),
      "",
      ...summaries.flatMap((s) =>
        s.url ? [`- [${s.setup.id} in Langfuse](${s.url})`] : [],
      ),
      "",
    ].join("\n");
    console.log(`\n${report}`);
    // On the GitHub Actions run page, and (via the workflow) as a comment on
    // the pull request.
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    if (process.env.CI) writeFileSync("eval-summary.md", report);
  });
});
