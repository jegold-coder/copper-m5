// The code checks for a golden-set case: which tools ran, who answered, and
// whether any forbidden text slipped into the reply. No AI here, so they are
// exact and free.
import type { GoldenCase } from "@/lib/evals/golden-set";

/** What one agent setup produced for one question. */
export type RunResult = {
  reply: string;
  /** Who wrote the reply. */
  agent: "copper" | "refund";
  /** Every tool the agents called, in order. */
  tools: string[];
};

/** The reasons a case fails the code checks. Empty means it passed. */
export function checkCase(c: GoldenCase, result: RunResult): string[] {
  const failures: string[] = [];
  // "a|b" means either tool will do.
  for (const tool of c.expectTools ?? [])
    if (!tool.split("|").some((name) => result.tools.includes(name)))
      failures.push(`did not call ${tool.replace("|", " or ")}`);
  for (const tool of c.forbidTools ?? [])
    if (result.tools.includes(tool)) failures.push(`should not call ${tool}`);
  for (const pattern of c.forbid ?? [])
    if (new RegExp(pattern, "i").test(result.reply))
      failures.push(`reply contains "${pattern}"`);
  const wanted = c.expectAgent ?? "copper";
  if (result.agent !== wanted)
    failures.push(`${result.agent} answered, expected ${wanted}`);
  return failures;
}
