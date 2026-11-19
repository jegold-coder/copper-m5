// The AI judge: Gemini reads a question, the facts a good answer must state,
// and Ask Copper's reply, then grades the reply. Goes through lib/ai/call.ts
// like every other AI call, so the judge's own cost and time are traced too.
import { z } from "zod";
import { callObject } from "@/lib/ai/call";
import { withRetry } from "@/lib/evals/retry";

export const JUDGE_INSTRUCTIONS = `You grade answers from a customer support chatbot for Copper State Labs.
You get the customer's question, REFERENCE (the facts a good answer must state) and the chatbot's ANSWER.
Grade only against the reference. Do not use outside knowledge, and do not reward long answers.

Score from 1 to 5:
5 = states every fact in the reference, adds nothing wrong or invented.
4 = correct, but misses a minor detail.
3 = partly correct, or misses a main fact.
2 = mostly wrong, or adds a claim that contradicts the reference.
1 = wrong, refuses when it should answer, or answers when the reference says to refuse.

The reference may say a good answer cites a document: citations look like [Copper Home User Guide, p. 9]. Missing a required citation caps the score at 4.
Keep "reason" to one short sentence.`;

export const verdictSchema = z.object({
  score: z.number().int().min(1).max(5),
  reason: z.string(),
});

export type Verdict = z.infer<typeof verdictSchema>;

/** Scores at or above this count as a pass. */
export const PASS_SCORE = 4;

export async function judge(input: {
  question: string;
  reference: string;
  answer: string;
}): Promise<Verdict> {
  const { output } = await withRetry(() =>
    callObject(
      { module: 5, feature: "eval-judge" },
      {
        instructions: JUDGE_INSTRUCTIONS,
        prompt: `QUESTION: ${input.question}\n\nREFERENCE: ${input.reference}\n\nANSWER: ${input.answer || "(empty)"}`,
        schema: verdictSchema,
      },
    ),
  );
  return output;
}
