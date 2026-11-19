// The agent setups the golden set is run on, so they can be compared.
import type { RunResult } from "@/lib/evals/checks";
import type { GoldenCase } from "@/lib/evals/golden-set";
import { runTwoAgents } from "@/lib/evals/run-copper";
import { runSingleAgent } from "@/lib/evals/run-single";

export type Setup = {
  id: "two-agents" | "single-agent";
  label: string;
  run: (c: GoldenCase) => Promise<RunResult>;
  /** Only a gated setup can fail the run: it is the one that ships. */
  gated: boolean;
};

export const SETUPS: Setup[] = [
  {
    id: "two-agents",
    label: "Two agents (Copper + Refund agent)",
    run: runTwoAgents,
    gated: true,
  },
  {
    id: "single-agent",
    label: "One agent with every tool",
    run: runSingleAgent,
    gated: false,
  },
];
