// @vitest-environment node
// The pieces of the golden-set evaluation that need no AI or keys.
import { describe, expect, it } from "vitest";
import { checkCase, type RunResult } from "@/lib/evals/checks";
import { GOLDEN_SET } from "@/lib/evals/golden-set";
import { withRetry } from "@/lib/evals/retry";

const byId = (id: string) => GOLDEN_SET.find((c) => c.id === id)!;

describe("golden set", () => {
  it("has unique ids and a reference answer for every question", () => {
    const ids = GOLDEN_SET.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of GOLDEN_SET) {
      expect(c.question.length).toBeGreaterThan(5);
      expect(c.reference.length).toBeGreaterThan(20);
    }
  });

  it("covers products, policy, refunds and safety", () => {
    const categories = new Set(GOLDEN_SET.map((c) => c.category));
    for (const wanted of ["products", "policy", "refund", "safety"])
      expect(categories.has(wanted as never)).toBe(true);
  });

  it("gives every refund case a desk, so the Refund agent is available", () => {
    for (const c of GOLDEN_SET.filter((c) => c.expectAgent === "refund"))
      expect(c.desk, c.id).toBeDefined();
  });
});

describe("checkCase", () => {
  const good: RunResult = {
    reply: "It is $149.",
    agent: "copper",
    tools: ["get_prices"],
  };

  it("passes when the tools, agent and text are right", () => {
    expect(checkCase(byId("price-home"), good)).toEqual([]);
  });

  it("accepts either tool in an 'a|b' expectation", () => {
    const viaProducts = { ...good, tools: ["get_products"] };
    expect(checkCase(byId("price-home"), viaProducts)).toEqual([]);
  });

  it("fails when a required tool was not called", () => {
    const failures = checkCase(byId("price-home"), { ...good, tools: [] });
    expect(failures).toEqual(["did not call get_products or get_prices"]);
  });

  it("fails when a forbidden tool was called", () => {
    const failures = checkCase(byId("annual-refund-policy"), {
      ...good,
      tools: ["search_docs", "transfer_to_refund_agent"],
    });
    expect(failures).toContain("should not call transfer_to_refund_agent");
  });

  it("fails when forbidden text appears, ignoring case", () => {
    const failures = checkCase(byId("privacy-retention"), {
      ...good,
      tools: ["search_docs"],
      reply: "We keep recordings for 18 Months.",
    });
    expect(failures).toEqual(['reply contains "18 months"']);
  });

  it("fails when the wrong agent answered", () => {
    const failures = checkCase(byId("refund-auto"), {
      reply: "Done.",
      agent: "copper",
      tools: ["get_orders", "request_refund"],
    });
    expect(failures).toEqual(["copper answered, expected refund"]);
  });
});

describe("withRetry", () => {
  it("retries after a failure, then returns the result", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        if (++calls < 3) throw new Error("quota");
        return "ok";
      },
      { attempts: 4, delayMs: 0 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after the last attempt", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("quota");
        },
        { attempts: 2, delayMs: 0 },
      ),
    ).rejects.toThrow("quota");
    expect(calls).toBe(2);
  });
});
