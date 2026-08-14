# Question

In the architecture of the agent swarm (although there are only 3 agents right now) where does the stop loss part fit in, code-wise, or agent orchestrator-wise?

It should be configurable, and be able to be fixed at the moment of entering the trade. Question: can we have a trailing stop, which can change as time goes by. How can these stop loss strategies be implemented, and configured?

# Answer

The stop-loss does **not** belong inside the swarm. It belongs in the **paper engine**, next to the entry gate — the same layer that already opens, marks, and closes simulated trades.

Think of three jobs that must stay separate:

| Job | Who does it today | Stop-loss role |
|---|---|---|
| “Do I like YES or NO?” | Trend / Mean-Reversion / Semantic | None. They are weather presenters. |
| “May we *enter*, and how big?” | Risk Manager | May **pick the stop numbers at fill time**. Must not babysit the open trade. |
| “Are we still allowed to hold this?” | Paper engine (`proposePaperAction`) | **Enforces** the stop on every price tick. This is the fire alarm. |

You already have an entry bouncer (`api/src/trading/entry-gate.ts`) and almost no exit bouncer. `proposePaperAction` only sells on an **approved flip** or when the **market closes**. That is why live closes sat ~**4.5 days** and simulated holds average ~**84 hours**.

## Where it fits (picture)

```
Swarm (hourly opinions)
  Trend / Mean-Reversion / Semantic  →  “I like YES”
  Risk Manager                       →  “enter $10”  [optional: attach stop recipe]
                 │
                 ▼
Paper engine (watches prices every collector tip)
  entry-gate.ts   →  may we OPEN?
  exit-gate.ts    →  must we CLOSE?   ← new, sibling of the entry gate
  paper.ts        →  fill, mark MFE/MAE, persist the lot
                 │
                 ▼
Open position in Mongo (frozen at fill)
  entryPrice, size, mfeUsd, maeUsd
  + stopKind, stopPct, stopPrice, trailDistance   ← bake these in at entry
```

The swarm scheduler runs about **once an hour**. Order books arrive every **30 seconds**. Paper decisions are every **15 minutes**. A stop that lived in the Risk Manager would wait for the next swarm chat while the position bled. The fire alarm has to live where prices are watched.

Do **not** add a fourth personality called “Stop-Loss Agent.” That would mix “I still like the story” with “the book is on fire.” The existing comment in `api/src/trading/types.ts` already points at the right home: expand `ExitPolicy`; do not change the PnL maths.

## Configurable, and frozen at entry — yes

Two layers of config, like a recipe vs the cake you already baked:

1. **Defaults** in `.env` (the recipe). Changing them only affects *new* trades.
2. **A copy on the position** at the moment `applyBuy` succeeds (the cake). An open lot keeps the numbers it was born with, even if you later tighten the env.

That is the same idea as photographing the swarm state at entry (`swarmStateAtEntry` on `LiveEntryMeta`). You already freeze *opinions* at fill. Freeze the *seatbelt* the same way.

Example:

- Monday: `PAPER_STOP_LOSS_PCT=0.30`. Trade A buys YES at **$0.50** with **$10** (20 contracts). Its stop is baked as “sell if unrealised ≤ **−$3.00**” (or bid ≤ **$0.35**).
- Tuesday: you change the env to `0.15`. Trade A still uses −$3. Trade B, opened Tuesday, uses −$1.50.

If the Risk Manager later learns to pick a *preset* (tight / normal / wide) from hours-to-close or volatility, it still only writes those numbers **once**, onto the new lot. It must not rewrite Trade A’s stop on the next hourly run. That would un-freeze it.

## Can we have a trailing stop? Yes

A **fixed stop** never moves after entry.

A **trailing stop** is allowed to move, but **only in your favour**. It is not “the agents changing their mind.” It is a high-water mark on the open lot. You already track that mark: `mfeUsd` (best unrealised profit) is updated in `markPosition` on every new observation.

Worked example — trail by **$0.08** in price (20% of a $0.40 entry):

| Time | YES bid | What the stop does | Unrealised on 25 contracts ($10 / $0.40) |
|---|---:|---|---:|
| Entry | $0.40 | Initial stop = $0.40 − $0.08 = **$0.32** | $0 |
| Later | $0.60 | Ratchet stop to $0.60 − $0.08 = **$0.52** (lock ~+$3) | +$5.00 |
| Pullback | $0.52 | Bid hits current stop → **sell** | ~+$3.00 kept |
| Or dump | $0.32 straight away | Same as a hard floor → **sell** | −$2.00 capped |

The trail must never walk backwards. If the bid later falls from $0.60 to $0.55, the stop stays at $0.52. That is the whole point.

On these binary markets a trail is extra useful on the cheap side (Mean-Reversion’s winners were bought near **$0.35**, where a right call pays ~2:1). It is *dangerous* on the expensive side (Trend’s losers at **$0.85–$0.97**): there is almost no room to trail up, and a lot of room to fall. A tight **fixed** percent stop is the better first seatbelt there.

## How to implement it (same pattern as the entry gate)

You do not need a new orchestrator. You need one small pure function and a few fields on the lot.

### 1. Config (the recipe)

Suggested `.env` knobs, mirroring `PAPER_MAX_ENTRY_QUOTE_SUM`:

| Knob | Example | Meaning |
|---|---|---|
| `PAPER_STOP_KIND` | `percent_loss` | `none` / `percent_loss` / `trailing_price` / `time` (combine with commas later) |
| `PAPER_STOP_LOSS_PCT` | `0.30` | Sell when unrealised ≤ −30% of *this lot’s* stake |
| `PAPER_TRAIL_PRICE` | `0.08` | Keep stop this far below the best bid seen since entry |
| `PAPER_TIME_STOP_MINUTES` | `1440` | 24 hours |
| `PAPER_TIME_STOP_NEED_PROFIT` | `true` | Only fire the clock if the trade is still not in profit |

A −30% / 24-hour pair is the one the 12 Aug learning report already recommended. On that sample, **12 of 14** live trades were never in profit, average worst dip was about **−$5 on a $10** ticket, and both winners were green **within the first day**. So that pair would have cut the slow bleed without touching the two wins.

### 2. Bake it onto `PaperPosition` at fill

Today a new lot only stores side, size, contracts, entry time/price, MFE, MAE. Add something like:

- `stopKind`
- `stopLossPct` (copied from env or from the Risk Manager’s chosen preset)
- `stopPriceUsd` (the live trigger; for a trail this ratchets)
- `trailDistanceUsd` (fixed at entry; used to compute the new `stopPriceUsd`)
- `timeStopAt` (ISO timestamp = entry + 1440 minutes)

`applyBuy` is the only place that should write these. After that, only `markPosition` may **raise** `stopPriceUsd` for a trail. Nothing may lower it.

### 3. `exit-gate.ts` — sibling of `entry-gate.ts`

Pure function, easy to test:

> Given this open lot, this quote, and now — return `"stop_loss"`, `"trailing_stop"`, `"time_stop"`, or `null`.

Use the **sell bid** (`markPriceForSide`), never mid. That matches the conservative fill model: you exit at what you could actually sell for.

Call it from `proposePaperAction` **before** the flip rule:

1. Market settling → force close (already exists).
2. Exit gate says stop/trail/time → sell, even if the swarm still likes the side.
3. Approved flip → sell (today’s only opinion-based exit).
4. Otherwise hold.

The stop must be allowed to fire **even when the 15-minute decision cadence is not due**. `forceClose` already bypasses that wait when a market settles. A stop is the same idea: do not sit on a burning ticket until the next scheduled chat. `markPosition` already runs on every new observation; the missing piece is “if the gate fires, sell now.”

### 4. Wire it everywhere the book already exists

Same function, four callers, so fitness compares like with like:

- live swarm book (`live-engine.ts`)
- live specialist books (`live-specialists.ts`)
- historical paper replay (`backtest/paper-engine.ts`)
- fitness simulation (`fitness/trades.ts`)

If only the live swarm book got a stop, Trend’s fitness would still be graded on 84-hour holds and the comparison would be unfair.

### 5. Keep the old `ExitPolicy` honest

`ExitPolicy` today is only `{ kind: 'fixed_hold', holdMinutes }`. That is a **labeller/backtest** leftover (“look 15 minutes later for a quote”). Live paper does **not** use it. When you add real stops, extend that type (or replace it) so reports can say `percent_loss` / `trailing_price` instead of pretending every exit was a fixed hold.

## Real-number walkthrough (fixed 30% stop)

Stake **$10**, buy YES at **$0.50** → 20 contracts. Stop = −30% of stake = **−$3**, which is bid **$0.35**.

- Bid $0.48 → unrealised **−$0.40** → hold.
- Bid $0.35 → unrealised **−$3.00** → **sell**. Loss capped.
- Without a stop, the same style of trade in the fitness sample rode MAE to about **−$7** (70% of stake) because nobody was watching.

A **time-stop** on the three live closes that sat **~4.5 days** (~6,480 minutes) would have sold after **1,440 minutes** of “still not green,” instead of waiting for a flip that never came.

## Suggested first recipe (learn, then get fancy)

1. Ship **percent_loss = 30%** + **time-stop = 24h if not in profit**. Frozen at entry. Engine-owned. No new agent.
2. Log the reason on the closed trade (`exitReason: 'stop_loss' | 'time_stop' | 'flip' | 'market_close'`). Fitness can then tell “cut by the seatbelt” from “swarm changed its mind.”
3. Only after a few dozen graded exits, add **trailing_price** as a second kind — still frozen *distance*, moving *level*.
4. Only after that, let the Risk Manager pick a preset at entry (tight if hours-to-close < 6, or if entry price > $0.80). Still freeze the chosen numbers on the lot.

Until step 1 exists, changing Trend’s prompt will not stop the 84-hour holds. The presenters cannot ring a fire alarm that is not wired.

## Code review

The architecture is already honest about this gap. `entry-gate.ts` is the right pattern to copy: small, pure, shared by live and fitness, configured in `.env`. `markPosition` already maintains the high/low water marks a trail needs. `LiveEntryMeta` already shows you how to freeze facts at fill.

The weak spot is `proposePaperAction`: it is the entire exit policy, and it never looks at P&L, time, or MFE. The 15-minute cadence also currently **skips selling** unless a decision is due — fine for “do I still like it?”, wrong for a stop. When you add the gate, let a hit interrupt that wait.

Do not put stop maths in Trend, Mean-Reversion, or the LangGraph handoffs in `registry.ts`. Those files should keep answering “what is the market doing?”

## Further learning

The useful mental model is **seatbelt vs driver**. The driver (swarm) chooses the road. The seatbelt (engine) is buckled at the start of the trip and may only *tighten* (trail), never loosen. If you want to go deeper next, the follow-up question is: should a stop fill be allowed on a stale quote, or must we wait for a fresh collector tip — the same stale-data problem that already creates zombie holds.
