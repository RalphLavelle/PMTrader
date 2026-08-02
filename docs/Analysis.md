# PMTrader back-end analysis

**Analysis date:** 2 August 2026 (updated after task 8 migration)  
**Scope:** Back end only. The Angular front end is intentionally excluded.

## Executive summary

PMTrader is a strict TypeScript/Node.js API for reading Jupiter prediction-market data,
creating unsigned buy orders, and producing market recommendations through a **single
analysis path**: a LangGraph Swarm of five specialist agents plus a Risk Manager.

There is no central supervisor. Specialist agents transfer control with handoff tools, share
structured LangGraph state, and finish with a risk-checked recommendation. The LLM controls
conversation and routing, but deterministic TypeScript code controls quantitative features,
strategy signals, risk vetoes, and position sizing.

The application has persistent analysis memory, but it does **not currently learn or
self-improve from that memory**. Completed swarm runs and later outcomes can be stored.
No graph node, prompt, or strategy reads historical records, scores past performance,
changes weights, or updates prompts. The code explicitly reserves this data for a future
Learning Agent.

## Technology stack

- **Language:** TypeScript 5.7 with strict checking and `noUncheckedIndexedAccess`.
- **Runtime:** Node.js using ECMAScript modules.
- **HTTP API:** Express 4 with CORS and JSON body parsing.
- **Agent orchestration:** LangGraph and `@langchain/langgraph-swarm`.
- **LLM integration:** LangChain plus `@langchain/openai`.
- **Model:** OpenAI chat model selected by `OPENAI_MODEL`; default `gpt-4o-mini`.
- **Validation/contracts:** Zod 4.
- **External market API:** Jupiter Prediction Market API on Solana.
- **Persistence:** process memory or an atomic JSON-file store.
- **Configuration:** `dotenv`, loading the repository-root `.env`.
- **Build/development:** TypeScript compiler and `tsx`.

The back end is in `api/src/`. It is not an Angular server. Despite a README mention of
MongoDB, no database code exists in the API — analysis memory uses in-memory or JSON-file
storage only.

## Back-end entry point and API wiring

`api/src/index.ts` creates one Express application, enables unrestricted CORS and JSON
parsing, mounts the routers, starts listening, logs configuration warnings, and starts the
optional scheduler.

The main route groups are:

- `GET /api/health`: liveness and selected configuration details.
- `GET /api/events`: proxies Jupiter event discovery and query parameters.
- `GET /api/markets/:marketId`: gets one Jupiter market.
- `GET /api/markets/:marketId/orderbook`: gets market depth.
- `POST /api/orders`: validates required fields lightly, then asks Jupiter for an unsigned
  buy transaction. This route does not sign or submit the Solana transaction.
- `GET /api/trading-status`: proxies Jupiter trading availability.
- `GET /api/trades`: returns platform-wide recent trades.
- `GET /api/trades/history`: returns a wallet's Jupiter history.
- `POST /api/swarm/analysis/:marketId`: runs the swarm, or its deterministic fallback.
- `GET /api/swarm/analyses`: queries stored swarm analyses.
- `GET /api/swarm/analyses/:id`: reads one stored analysis.
- `PATCH /api/swarm/analyses/:id/outcome`: attaches the real resolution and optional P&L.

The route layer is deliberately thin. Jupiter-facing routes delegate to the shared
`JupiterClient`; swarm routes delegate to `runSwarmAnalysis`.

## External market-data layer

`api/src/jupiter/client.ts` is the single HTTP adapter for Jupiter. It:

- builds URLs from `JUPITER_BASE_URL`;
- adds `x-api-key` when configured;
- exposes typed methods for events, markets, orderbooks, trading status, trades, wallet
  history, and order creation;
- converts non-successful responses into `JupiterApiError`.

The singleton exported from `api/src/jupiter/index.ts` is shared by routes and the swarm.
This keeps Jupiter transport details out of agent business logic.

## Module layout

| Folder | Role |
|--------|------|
| `api/src/jupiter/` | Jupiter HTTP client and types |
| `api/src/routes/` | Thin Express handlers |
| `api/src/llm/` | Shared OpenAI `ChatOpenAI` factory |
| `api/src/semantic/` | Real-world research narrative generation |
| `api/src/agents/` | Agent names, prompts, registry, and pure business logic |
| `api/src/swarm/` | LangGraph glue — shared state, tools, swarm assembly, runner |
| `api/src/schemas/` | Zod contracts for snapshots, signals, risk, and memory records |
| `api/src/memory/` | Swappable analysis persistence |
| `api/src/jobs/` | Optional scheduled swarm runs |

Business logic never imports LangGraph. Each agent's `logic.ts` is a set of pure functions
returning a validated signal, which makes strategies directly unit-testable and lets the
deterministic runner reuse them unchanged.

## Multi-agent swarm architecture

### Shared state

`api/src/swarm/state.ts` defines channels for messages, active agent, market id, normalized
snapshot, derived features, specialist signals, risk assessment, recommendation, and
errors.

The snapshot-like values use “newest write wins” reducers. Signals use a keyed merge:
each specialist can contribute at most one current signal, so rerunning an agent replaces
its earlier opinion instead of duplicating it. Errors accumulate.

Each agent and the parent swarm declare the same analysis channels. LangGraph copies these
channels between agent subgraphs, allowing one specialist's tool output to become another
specialist's input without a supervisor manually relaying it.

### Agents and tools

`api/src/agents/registry.ts` declaratively creates five ReAct agents:

- **Market Analyst:** calls `prepare_market_data`, which fetches Jupiter data, normalizes
  it, and derives shared features. It is forbidden from recommending a trade.
- **Trend Agent:** calls deterministic trend logic based on probability extremity,
  orderbook imbalance, and liquidity.
- **Mean Reversion Agent:** calls deterministic counter-trend logic based on extremity,
  remaining time, and liquidity.
- **Semantic Agent:** generates a real-world research narrative, then converts it into a
  structured stance and confidence.
- **Risk Manager:** aggregates signals, applies vetoes, calculates stake size, and writes
  the only final recommendation.

Tools are the bridge between LLM decisions and ordinary TypeScript. A tool reads the
current LangGraph task state, calls business logic, and returns a LangGraph `Command`.
That command updates structured channels and adds a `ToolMessage`, which lets the ReAct
loop continue after the tool call.

### Why this is agentic

`createSwarm` is compiled without a supervisor and without a LangGraph checkpointer.
The current active agent sees its prompt, conversation, domain tool, and allowed handoff
tools. The LLM decides which tool to call and when to transfer control. Handoffs make
the routing graph:

```text
market_analyst ─→ trend_agent ─→ mean_reversion_agent ─→ semantic_agent ─→ risk_manager
       │                │                  │                    │                │
       └→ semantic      └→ risk_manager    └→ risk_manager      └→ trend         └→ market_analyst
```

Prompts strongly request the main left-to-right sequence, so autonomy is constrained.
Alternative handoff edges allow recovery or abbreviated routes. A recursion limit,
defaulting to 40 graph steps, prevents endless handoff loops.

This is agentic orchestration rather than agentic trading execution. The swarm produces
and stores a recommendation; it never calls the order endpoint, signs a transaction, or
places a trade.

### Execution paths

| Path | Trigger | LLM | Memory |
|------|---------|-----|--------|
| Swarm | `POST /api/swarm/analysis/:id` | Variable ReAct + semantic | Saved |
| Deterministic | No key or `?deterministic=true` | None | Saved |
| Scheduled | `AGENT_SCHEDULE_ENABLED=true` | Same as above | Saved |

Both HTTP and scheduled runs call `runSwarmAnalysis`, which persists an `AnalysisRecord`.

## LLM use

All model construction goes through `api/src/llm/index.ts`. It returns `null` when
`OPENAI_API_KEY` is absent; otherwise it creates `ChatOpenAI` with the configured model
and temperature `0.2`.

The LLM is used in these exact places:

1. **Every swarm ReAct agent:** chooses domain-tool calls and handoffs from prompts and the
   shared conversation (variable number of calls, bounded by `SWARM_RECURSION_LIMIT`).
2. **Semantic narrative:** `generateSemanticNarrative()` in `api/src/semantic/narrative.ts`
   summarises what real-world evidence would matter for a market's title and rules.
3. **Semantic verdict:** a structured-output call in `api/src/agents/semantic/logic.ts`
   converts the narrative into `yes`, `no`, or `neutral`, a confidence score, and reasoning.

The LLM adds abilities that would be difficult to reproduce with simple rules:

- interpreting ambiguous natural-language market questions and resolution criteria;
- forming a semantic judgment from prose;
- selecting tool/handoff actions in response to state and failures;
- expressing a human-readable explanation.

The LLM does **not** fetch news or outside evidence. The Semantic Agent has no search,
browser, retrieval, or knowledge-base tool. Its “real-world” analysis is limited to the
model's existing knowledge plus the supplied title, status, and rules.

The LLM also does not calculate the core quantitative features, trend formula,
mean-reversion formula, signal aggregation, risk vetoes, or position sizing. Those are
explicit TypeScript functions and can run without a model.

## LLM prompts

All prompts live in `api/src/agents/prompts.ts`, separate from agent and tool code.
The registry imports them and associates each prompt with an agent, domain tools, and
allowed handoffs. `buildAgent()` passes the prompt to `createReactAgent`.

Each prompt controls:

- `MARKET_ANALYST_PROMPT`: data preparation only, exactly one market-data call, no opinion,
  then transfer to Trend.
- `TREND_AGENT_PROMPT`: one trend evaluation, factual reporting, then transfer to Mean
  Reversion; missing data may go to Risk.
- `MEAN_REVERSION_AGENT_PROMPT`: one reversal evaluation, preserve disagreement, then
  transfer to Semantic.
- `SEMANTIC_AGENT_PROMPT`: one real-world evaluation, honest uncertainty, then transfer
  to Risk.
- `RISK_MANAGER_PROMPT`: one risk assessment, report approval/veto and size, then stop;
  only missing data may return to Market Analyst.
- `SEMANTIC_NARRATIVE_PROMPT`: drives the direct model call inside semantic business logic.
- `SEMANTIC_VERDICT_PROMPT`: structured-output call that converts narrative into stance,
  confidence, and reasoning without using price data.

The per-request swarm user prompt is assembled in `api/src/swarm/runner.ts` and names the
market plus the desired specialist sequence.

## Deterministic fallback and safety boundary

When no OpenAI key exists, or `?deterministic=true` is supplied, the runner bypasses the
swarm and executes the same pure business functions in a fixed order. Semantic analysis
degrades to a neutral, zero-confidence signal.

Signal aggregation confidence is reduced by disagreement. Risk rules then veto a trade
when the market is closed, specialists do not converge, confidence is below the configured
threshold, liquidity is too low, close time has passed, or the calculated order is too
small. Stake size is capped by `SWARM_MAX_POSITION_USD`.

The runner does not trust the LLM to complete safety review. If a swarm finishes without
a risk assessment or recommendation, it directly runs deterministic aggregation and risk
logic before returning. Missing market data is a hard failure. Zod validates structured
boundaries throughout.

## Memory and “learning”

Each completed swarm run becomes an `AnalysisRecord` containing:

- unique id and timestamp;
- market id and execution mode (`swarm` or `deterministic`);
- participating agents and per-agent confidence;
- complete specialist signals and supporting metrics;
- risk assessment and final recommendation;
- an initially empty outcome field.

`PATCH /api/swarm/analyses/:id/outcome` later records resolution side, realized P&L, and
whether the recommendation was correct. If `wasCorrect` is omitted, the API derives it
for directional recommendations. A `hold` remains unscored.

Storage is selected by `MEMORY_DRIVER`:

- `memory` is the default and loses all records on process restart (500-record cap with FIFO
  eviction in the in-memory driver).
- `file` writes `data/analyses.json` by default, survives restarts, serializes writes
  through a promise queue, and uses temporary-file rename to avoid partial files.

This is long-term **recording**, not model memory or learning. The swarm is deliberately
compiled without a LangGraph checkpointer because each request is a single-shot run.
Past records are exposed through API routes but are never injected into a prompt or graph
state. No component currently:

- compares a new prediction with similar historical markets;
- calculates agent accuracy or calibration;
- changes strategy constants or aggregation weights;
- selects or rewrites prompts;
- fine-tunes a model;
- recursively evaluates and reruns itself.

Therefore the present feedback loop stops after data collection:

```text
analysis → stored record → manually/API-recorded outcome → future training data
```

The repository comments and README describe a **future Learning Agent** that could score
this data and tune strategies. The schema and storage interface make that possible, but
the self-improving stage does not yet exist.

## Important architectural limitations

- The semantic system has no live research source, retrieval grounding, or citations.
- The default in-memory driver is not durable despite the “memory” name.
- The JSON driver is appropriate for a single process and modest volume, not horizontally
  scaled writers or analytical queries.
- No automated Learning Agent consumes outcomes.
- No automated execution connects recommendations to orders; this is a useful safety
  boundary, but it means the product is an adviser rather than an autonomous trader.
- The repository contains no back-end test files, despite the strategy logic being designed
  for unit testing.
- API authentication and authorization are absent, CORS is unrestricted, and order creation
  is publicly exposed wherever this service is reachable.

## Overall assessment

LangGraph contributes through shared typed state, ReAct tool loops, handoffs, message
continuity, and bounded multi-agent routing. The strongest design choice is that LLMs
orchestrate and interpret language while deterministic, schema-validated code retains
control of quantitative calculations and financial risk.

The architecture is prepared for learning but has not implemented it. The next genuine
self-improvement step would require a Learning Agent or offline evaluation job that reads
resolved records, measures each strategy's accuracy and calibration, proposes bounded
changes, validates them against held-out history, and only then updates versioned strategy
or prompt configuration.
