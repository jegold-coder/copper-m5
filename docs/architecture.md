# Architecture

How the Copper State Labs app fits together. Each module adds a section at the
end (see [Adding a module](#adding-a-module)) when it changes how the app
works: new pages, tables or AI calls.

_Fictional — for educational use._

## The starter app (Module 0)

A Next.js app that builds, runs and deploys with **no environment variables**.
A Google AI Studio key is optional until a module needs one.

| Piece | Where | What it does |
|---|---|---|
| Pages | `app/` | `layout.tsx` sets the fonts and theme; `page.tsx` is the placeholder home page |
| Brand components | `components/copper/` | `Logo`, `SiteHeader`, `SiteFooter`, `ModeToggle` |
| UI kit | `components/ui/` (shadcn), `components/ai-elements/` (AI Elements) | The only UI libraries the app uses |
| Setup card | `components/setup-required.tsx` | `<SetupRequired service="ai" />`, shown instead of a page whose service isn't configured |
| Company catalog | `lib/copper/catalog.ts`, `lib/copper/data/catalog.json` | Product, plan and privacy facts from the Product Bible (Sections 3, 4, 8 and 10). Pages read prices and plan details from here instead of typing them (added in the Module 1 starter) |
| AI wrapper | `lib/ai/call.ts` | `callText` and `callObject`: every model call goes through these and is logged to the terminal |
| Models and prices | `lib/ai/models.ts`, `lib/ai/pricing.ts` | The approved Gemini models and their token prices |

## Data flow

1. A user opens a page in `app/`.
2. Server code checks what's configured (`isAiConfigured()`). If the key is
   missing, the page renders `<SetupRequired />` instead of crashing.
3. Data comes from files under `lib/copper/data/`.
4. AI requests go through `callText` / `callObject` in `lib/ai/call.ts`, which
   calls Google and then prints one `[ai_calls]` line: `module`, `feature`,
   `model`, tokens, `cost_usd`, `latency_ms`, `ok`.

```ts
const { text } = await callText(
  { module: 2, feature: "ask-copper" },
  { prompt },
);
```

## Two kinds of "AI tiers"

Don't mix these up:

- **Copper State Labs' product tiers** (On-device, Raw Ore, Refined, the
  Copper Cloud) are part of the fictional company. They are facts in the
  [Product Bible](copper-state-labs/product-bible.md) and rows in the `ai_tiers`
  table.
- **The models this app calls** are real Claude models listed in
  `lib/ai/models.ts`. Their cost is logged in `ai_calls`.

## Decisions

- **No environment variables required.** Every service is optional, so a fresh
  clone builds and deploys before any accounts are set up.
- **One AI wrapper.** Routing every call through `lib/ai/call.ts` gives one
  place to log cost and latency per module and feature.
- **No authentication or row-level security yet.** They arrive in a later
  module.

## Adding a module

When a module changes how the app fits together, add a section here:

```md
## Module N: <feature name>

**Summary:** one or two sentences: what this adds and why.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/...` | |
| Components | `components/...` | |
| Data | `lib/copper/data/...` | Data files added |
| AI calls | `lib/ai/call.ts` (module, feature) | Model, prompt purpose, expected cost per call |

**Data flow:** user action → page → server code → database / model → response.

**Decisions and trade-offs:** what you chose, the alternatives, and why.

**Risks and open questions:** cost, privacy, accuracy or safety risks, and how
you handle them.
```

## Module 3 starter: Ask Copper

**Summary:** Ask Copper, the Module 2 shopping chatbot, finished: a floating
chat panel that answers prices, totals and stock with four tools and shows
each step. Module 3 teaches it to answer from the customer documents.

| Piece | Where | What it does |
|---|---|---|
| Component | `components/copper/ask-copper.tsx` | The launcher and chat panel, mounted from `app/page.tsx` and opened by the header's `#ask` link. Draws each answer as stations: the tools on offer, thinking, each tool call, then the reply |
| Server Action | `lib/copper/assistant/ask.ts` | `askCopper()`: streams the conversation with `callStream`, up to 5 steps, and sends each step back as a live `Progress` |
| Tools | `lib/copper/assistant/tools.ts` | `copperTools`: `get_products`, `get_prices`, `calculate_cost`, `check_availability` |
| Instructions | `lib/copper/assistant/instructions.ts` | `COPPER_INSTRUCTIONS`. Copper says it can't help yet with warranty, setup, troubleshooting or privacy |
| Data | `lib/copper/inventory.ts`, `lib/copper/documents.ts` | Stock from `lib/copper/data/inventory.json`; `DOCUMENTS`: the four customer documents and their PDF paths under `public/docs/`. The PDFs are added in class |
| AI calls | `{ module: 2, feature: "ask-copper" }` | One streamed call per question |

## Module 3: Document passages and embeddings

**Summary:** The four customer PDFs in `public/docs/` are split into passages
of a few sentences and embedded with Gemini, so Ask Copper can find the
passages that answer a question and cite their page.

| Piece | Where | What it does |
|---|---|---|
| Build script | `scripts/embed-docs.mjs` (`npm run embed-docs`) | Reads each PDF in `DOCUMENTS` page by page (with `unpdf`), splits pages with `splitPage()`, embeds every passage and writes the JSON. Re-run it when a PDF changes |
| Splitter | `lib/copper/split-passages.ts` | `splitPage()`: drops the footer lines, then groups sentences three at a time (at most ~600 characters) |
| Data | `lib/copper/data/passages.json`, `lib/copper/passages.ts` | `PASSAGES`: `documentId`, `title`, `page`, `text` (starts with the document title) and `embedding`. Importing it loads every passage into memory once per server |
| Tool | `lib/copper/assistant/tools.ts` | `search_docs`: embeds the question, ranks every passage by cosine similarity and returns the 5 closest with title, page, a `/docs/<file>.pdf#page=N` link and a score. The tool card lists them with links; the instructions tell Copper to use it for setup, troubleshooting, warranty and policy questions and to cite the page |
| Citations | `lib/copper/assistant/citations.ts`, `lib/copper/assistant/instructions.ts` | Copper answers document questions only from `search_docs`, ends every sentence with `[Title, p. N]`, and says "I couldn't find that in our support docs" otherwise. `splitCitations()` lets the panel link each citation to that PDF page; unknown titles stay plain text |
| AI calls | `callEmbedMany` in `lib/ai/call.ts`, `{ module: 3, feature: "embed-docs" }` | `gemini-embedding-2` at 768 dimensions. One call per run of the script, plus one `{ module: 3, feature: "search-docs" }` call per search. Google doesn't report embedding tokens, so the log's tokens and cost are null |

**Data flow:** PDF → pages → passages → Gemini embeddings → `passages.json` →
`PASSAGES` in memory. Question → `search_docs` → question embedding → 5
closest passages → Copper answers from them and cites the page.

**Decisions and trade-offs:** A JSON file in memory instead of a vector
database: about 120 passages is under 1 MB, so searching all of them is
instant and needs no new service. 768 dimensions instead of 3072 keeps the
file small with little loss in accuracy. The title goes at the start of each
passage so similar passages from different documents (Copper Home vs. Copper
Notes) embed differently.

**Risks and open questions:** Questions must be embedded with the same model
and dimensions (`EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`) or the search
returns nonsense. Tables lose their columns when turned into text. Embeddings match meaning
better than exact strings, so an error code like C-47 can rank below other
error-code passages (it was third in testing); keyword search alongside would fix that.

## Module 4: Refund agent, handoff and approvals

**Summary:** On the Support page, Copper hands refund requests to a second
agent, the Refund agent, with its own instructions and tools. The app (code,
not the model) compares the order amount with an auto-refund limit you can
change: at or under it, the refund goes through; over it, the refund waits on
the Refund Console until a person clicks Approve or Reject, and the Refund
agent tells the customer.

| Piece | Where | What it does |
|---|---|---|
| Orders and the rule | `lib/copper/orders.ts`, `lib/copper/data/orders.json` | Maya Reyes's four orders (#1001 to #1004). `requestRefund()` decides: `refunded` at or under the limit, `needs_approval` over it; an order already decided keeps its status; `not_found` for unknown numbers |
| Handoffs | `lib/copper/assistant/tools.ts`, `ask.ts` | Copper's `transfer_to_refund_agent` (Support page only) and the Refund agent's `transfer_to_copper`. Each ends that agent's turn (`hasToolCall`); the other agent answers the same conversation. The agent that ends a turn answers the next message |
| Refund agent | `lib/copper/assistant/instructions.ts` (`REFUND_AGENT_INSTRUCTIONS`), `tools.ts` (`refundAgentTools`) | `get_orders` and `request_refund`, built on the desk the chat sends. Copper can't use these |
| Refund Console | `app/support/page.tsx`, `components/copper/refund-console.tsx` | The auto-refund limit ($50 to start), the refunds waiting for approval with Approve and Reject, and the orders with their status. State lives in the page: a reload starts fresh |
| Chat panel | `components/copper/ask-copper.tsx` | With `support`, sends the desk (limit and refunds so far) and the current agent with each message, puts each `request_refund` decision on the console, and sends the console's "[Refund Console] A supervisor approved …" note to the Refund agent, which tells the customer. Shows each handoff as its own station |
| AI calls | `{ module: 2, feature: "ask-copper" }`, `{ module: 4, feature: "refund-agent" }` | One call per agent in a turn |

**Data flow:** question → Copper → `transfer_to_refund_agent` → Refund agent
→ `request_refund` → the app compares the amount with the limit → refunded,
or waiting on the Refund Console → Approve or Reject → console note → Refund
agent tells the customer.

**Decisions and trade-offs:** The refund decision is code, so the model can't
argue past the limit. Two agents keep refund tools away from Copper. A real
handoff (the other agent answers) rather than an agent called as a tool keeps
one voice per reply. The console's state lives in the browser and goes with
each message, so there's nothing to set up and nothing stored on the server;
the cost is that a reload forgets every refund.

**Risks and open questions:** A customer can claim a supervisor already
approved; the Refund agent must still ask the app. Setting the limit to 0
sends every refund to a person. A real app needs a database so refunds
survive a reload and several supervisors see the same queue.

## Module 5 starter

**Summary:** Module 4 as finished. Module 5 makes Ask Copper safe to ship:
the tests and a golden-set evaluation with an AI judge run in GitHub Actions
on every pull request, with `main` protected; every AI call is traced in
Langfuse; and one support agent that does everything is compared with the two
agents on the same golden set. Langfuse is the only eval and monitoring tool.

## Module 5, Part 2: tracing in Langfuse

**Summary:** Every AI call is traced in Langfuse: which agent answered, its
tool calls, tokens, cost and time. With no Langfuse keys nothing is sent and
the app runs as before.

**Data flow:** `instrumentation.ts` runs when the server starts. If
`LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set, it registers the AI
SDK's OpenTelemetry integration (`@ai-sdk/otel`) and a Langfuse span
processor (`@langfuse/otel`). `lib/ai/call.ts` names each call by its feature
(`ask-copper`, `refund-agent`) and adds the module number, so the trace shows
which agent ran. Tool calls and token counts come from the AI SDK itself.
Each chat turn in `askCopper` is wrapped in one `ask-copper-chat` trace, so
Copper, the handoff and the Refund agent appear together under one root, with
the customer's message as its input and the reply as its output.

**Decisions and trade-offs:** Tracing lives in the one wrapper every call goes
through, so no feature needs its own code. On Vercel spans are sent at once,
because a function can freeze right after replying. Chat text is recorded in
traces; turn that off with `telemetry.recordInputs` if a feature handles
private data.

**Risks and open questions:** Traces hold customer messages. The Langfuse
project is the place to control who can read them.

## Module 5, Part 3: the golden-set evaluation

**Summary:** A set of 16 questions with known good answers grades Ask Copper.
The same evaluation runs on your machine (`npm run eval`) and in GitHub Actions
on every pull request. The scores are kept in Langfuse.

| Piece | Where | What it does |
|---|---|---|
| Golden set | `lib/evals/golden-set.ts` | Each case: the question, the facts a good answer states (`reference`), tools it must call, text it must never say, who should answer |
| Code checks | `lib/evals/checks.ts` | Exact, free checks: tools used, the agent that answered, forbidden text |
| AI judge | `lib/evals/judge.ts` | Gemini grades each answer 1 to 5 against the reference, through `lib/ai/call.ts` |
| Runner | `lib/evals/run-copper.ts` | Sends a question through `askCopper`, as the chat panel does |
| Experiment | `evals/golden-set.eval.ts` | Runs every case as a Langfuse experiment: traces, `judge_score`, `code_checks`, `passed`, and run-level `pass_rate` |

**Data flow:** question → `askCopper` (Copper, and the Refund agent when the
case has a Refund Console `desk`) → reply, agent and tools used → code checks
and the judge → scores in Langfuse. A case passes when the code checks pass and
the judge gives at least 4. The run fails when fewer than 80% of the cases
pass (`EVAL_MIN_PASS_RATE` changes that).

**In CI:** the `Golden-set eval` job in `.github/workflows/ci.yml` runs
`npm run eval` with the keys from the repo's Actions secrets. The
`All checks pass` job needs it, and branch protection requires that job, so a
pull request that makes Copper worse can't merge.

**Decisions and trade-offs:** Code checks catch what must be exact (the right
tool, no leaked playbook); the judge catches what words can't. Questions run
one at a time with retries, because a free Google key allows only so many
requests a minute: the run takes about 2 to 3 minutes. An AI judge can be
wrong, so a score is a signal to read the trace, not a verdict.

**Risks and open questions:** 16 cases is small: one wrong answer moves the
pass rate by 6 points. Add a case whenever a real customer question goes
wrong. Judge and answers come from the same model family, which can flatter
itself.

## Module 5, Part 4: one agent or two

**Summary:** The golden set runs on two setups: the app's **two agents**
(Copper and the Refund agent, with a handoff) and **one agent with every
tool** and no handoff (`lib/copper/assistant/single-agent.ts`). Both are graded
the same way and recorded in Langfuse as two runs on the same dataset
(`ask-copper-golden-set`), so Langfuse can compare them side by side. The app
itself still uses two agents.

**Data flow:** `evals/golden-set.eval.ts` puts the 16 cases in Langfuse as a
dataset, then runs each setup (`lib/evals/setups.ts`) one question at a time.
Each question's model calls, tokens, cost and time are added up
(`lib/evals/usage.ts`, using `onAiCall` in `lib/ai/call.ts`) and saved as
scores next to the judge's score. Only the shipped setup can fail the run.

**One run on the 16 questions:**

| Setup | Pass rate | Judge (1-5) | Time / question | Tokens / question | Model calls | Cost / question |
|---|---|---|---|---|---|---|
| Two agents (Copper + Refund agent) | 100% | 4.88 | 2.8 s | 2990 | 1.7 | $0.00200 |
| One agent with every tool | 88% | 4.75 | 2.7 s | 3125 | 1.4 | $0.00225 |

**Decisions and trade-offs:** Ship the two agents for now. They passed every
question, cost about 12% less per question, and keep the refund tools out of
Copper's reach: a general chat question can't call `request_refund`. The
single agent is simpler (no handoff, one prompt) and as fast, but every call
carries every tool and every rule, so each call is bigger. Its two misses were
small: it skipped `get_orders` before refunding an order the customer had
already numbered (correct answer, but the code check wants the order looked
up), and it left out the heat-damage exclusion in a warranty answer.

**Risks and open questions:** 16 questions is a small sample, and one run
varies: a gap of two questions is a hint, not proof. Run it a few times
before relying on it, and add cases where the setups disagree. The judge is
Gemini grading Gemini. Cost here is the free-tier Flash-Lite price list in
`lib/ai/pricing.ts`.
