# Question

Is the entire end goal of all the paper-trading and backtesting to get good adaptive weights in the database. Are these the equivalent of the weights of a traditional AI model? IS that the only real memory of the entire agent swarm and hence of the entire app? Or is there anywhere else where the app retains what it "learned" in the backtesting and paper trading?

# Answer

**No.** The end goal is not “good numbers in `adaptive_weights`.” The end goal is **evidence that the system chooses better trades over time** — and, eventually, that it can do that with real money. Adaptive weights are one small mixer knob on that path, not the brain.

They are **not** the same thing as the weights inside a traditional AI model (a neural net). And they are **not** the only memory. The durable lesson is stored mainly as **closed paper trades**. The weights are a *summary* of those trades. A lot of the *useful* learning so far has not gone into the database at all — it went into **code you (and the reports) wrote**, like the entry gate and the stop-loss.

## What paper trading and backtesting are actually for

Think of three nested goals:

| Goal | What it is | Example |
|---|---|---|
| 1. Classroom | Practise without spending money | Paper loop on live tips; backtest on old snapshots |
| 2. Report card | Grade who helped and who hurt | Fitness pass: Trend −$43.57, Mean-Reversion −$80.65 (12 Aug sample) |
| 3. Teaching step | Use the grades so the *next* decision is different | Adaptive weights: Trend **0.75**, Mean-Reversion **0.72** (baseline **1.0**) |

Step 3 is real, but it is not the finish line. If every specialist is a coin flip, a perfectly tuned mixer still loses money. The 12 Aug report already showed this: weights *did* move (Trend 0.79 → 0.75), and that proved the loop was alive — but the **valuable** lesson was “costs ate the trades; build an entry gate.” That lesson became `entry-gate.ts`, not a new row in Mongo.

Backtesting is even one step further from the mixer. It is a **fast replay of history** so you can ask “did this logic even make sense on past books?” Fitness *may* use those stances as a secondary forecasting grade. Coherent paper trades are the primary scoreboard. A backtest you never feed into fitness does not change a single weight.

So: paper + backtest exist to **generate fair evidence**. Weights are one thing you *do* with that evidence. Humans changing rules is another. Going live later is the actual prize.

## Are they like neural-network weights? A useful metaphor, a dangerous one

A traditional model (ChatGPT, a price-forecasting net) has **millions or billions** of internal numbers. Training nudges those numbers so the *same* model sees the world differently next time. The skill lives **inside** the model.

PMTrader’s adaptive table is **three mix knobs** (Trend, Mean-Reversion, Semantic), each clamped between **0.25 and 1.5**, starting at **1.0**.

```
Traditional AI          PMTrader today
─────────────────       ─────────────────────────────
One model               Three frozen specialists
Millions of weights     Three mixer knobs
Training changes        Training does *not* change
  how it sees             how Trend “sees”
Skill is inside         Skill is supposed to be
  the network             inside each agent’s *code*
```

The specialists **do not learn**. Trend still scores with hardcoded constants (`WEIGHT_EXTREMITY = 0.35`, and so on). Mean-Reversion still uses `WEIGHT_EXTREMITY = 0.55`. Fitness never rewrites those. After 37 graded Trend trades, Trend is the same formula it was on day one. Only the **volume** of its voice in the blend moved, from 1.0 down toward 0.75.

That is like three musicians who never practise, and a sound engineer who only turns their faders. The engineer is learning *who is less bad*. The musicians are not getting better.

The formula that turns a report card into a knob:

> **weight ≈ 1.0 + reliability × 0.4 × fitness**, then blend 60% toward last time’s knob, then clamp to 0.25–1.5

- **Reliability** = `n / 30` until you have 30 coherent trades (Mean-Reversion had **28** on 12 Aug, so its move was still shrunk).
- **Sensitivity 0.4** and **inertia 0.6** are why a bad week cannot slam someone from 1.0 to 0.25 overnight.
- Semantic sat at **1.0** with **zero** sided trades (470 neutral stances). That is not “we learned Semantic is great.” That is “no exam papers, so the knob never moved.” A missing grade is *not* a gold star.

If you want a closer AI analogy: this is **ensemble weighting** (how loud each voter is), not **model training** (changing the voters). A random forest that reweights trees is closer than “the neural net learned.”

## Where the app actually retains what it learned

The mixing knobs are **derived**. Wipe `adaptive_weights` and keep the trades, run fitness, and the knobs come back. Wipe the trades and keep the knobs, and you have a stale opinion with no proof.

### 1. The real exam papers — closed paper trades (Mongo)

Collection: `paper_closed_trades` (plus in-memory copies used to rebuild weights).

Each closed lot is one graded attempt: side, size, entry/exit, net P&L, MFE/MAE, whether there was an order book, and `adaptiveWeightsAtEntry` (a photo of the mixer at fill time). Live closes also **append** specialist trades into the weight rebuild (`refreshAdaptiveFromLiveTrades`). Swarm-owned rows feed dashboards; **only Trend and Mean-Reversion trades move the knobs**.

This is the closest thing the app has to a training set.

### 2. The mixer cache — adaptive weights (Mongo + RAM)

Collection: `adaptive_weights`, one document `_id: 'current'`. Also held in process memory. Restored on API boot so a restart does not reset everyone to 1.0.

This is a **cache of the last published opinion**, plus the trade list it was built from. It is inspectable on `GET /api/fitness/weights` (sample counts, recent vs long-term P&L, a short rationale string). Useful. Not the vault.

### 3. Swarm session tapes — analysis runs (Mongo `runs`)

Every completed swarm chat is stored as an `AnalysisRecord`. The schema literally calls this “the unit of long-term memory,” and mentions a **future Learning Agent** that could compare prediction vs outcome. The labeller later stamps `outcome` (was it profitable? did resolution match?).

These tapes are **not** automatically turned into mixer moves. Fitness can read them as a *secondary* forecasting grade (accuracy, Brier, skill vs the market price). Primary teaching still wants a coherent buy→sell paper cycle.

### 4. The world, not the lesson — collector archives

`market_snapshots`, `orderbook_snapshots`, `trades`, `market_labels`, events catalog. This is raw history. Backtests replay it. Without it you cannot reconstruct a fair exam. It is memory of **the market**, not of **what the swarm learned**.

### 5. Open books and decisions

`paper_portfolios`, `paper_decisions`. Survive restarts so an open lot is not forgotten. That is bookkeeping, not skill.

### 6. Which markets we bother with — the watchlist

`api/src/shared/watchlist.json` is rewritten by learning-oriented rules (coherent quotes, horizon, diversity). That is a weak form of memory: “these 12 seats are worth filming.” It is **not** driven by who made money. It is a policy you encoded.

### 7. The fitness report itself — RAM only

`getLastFitness()` dies on restart. The comment in `fitness/runner.ts` is honest: it is a derived view; losing it costs one re-run, not the data. Do not treat `/data/fitness` as the brain.

### 8. Human-written rules in git — the biggest learner so far

This is easy to miss because it does not look like “AI memory”:

| Lesson from evidence | Where it was stored |
|---|---|
| Incoherent quotes / no book ate ~100% of Trend’s live loss | `entry-gate.ts` + `PAPER_MAX_ENTRY_QUOTE_SUM=1.05` |
| Holds of ~84 hours / 4.5-day live closes | `exit-gate.ts` (stops / trail / 24h time-stop) |
| Cheap vs expensive side needs different seatbelts | `PAPER_STOP_CHEAP_MAX_PRICE=0.50` |
| Paper should gather evidence below the live 0.55 floor | `PAPER_TRADING_MIN_CONFIDENCE=0.35` |
| Trend still buys $0.85–$0.97 favourites | still **inside** `trend/logic.ts` — **not yet learned** |

The loop *noticed* Trend has no edge (49.9% accuracy, skill vs market **−0.1%**). The mixer quietly turned Trend down to 0.75. The *formula* that buys expensive favourites did not change. That gap is the honest answer to “is the weight table the brain?” **No. Most of the brain is still you, reading reports and changing code.**

Regime-conditioned weights (`weightsForRegime`) are a nice extra: “how did this agent do in thin books / last hour?” They are computed from the **same trade list**, not a second brain. They do not overwrite the published table unless something asks for them.

## Picture of the memory stack

```
Markets (collector Mongo)          the world
        │
Swarm runs (runs + outcomes)       session tapes
        │
Paper fills → closed trades        exam papers   ← source of truth
        │
Fitness pass (RAM report)          report card
        │
Adaptive table (RAM + Mongo)       3 mixer knobs ← derived
        │
Next aggregation                   Trend × 0.75, MR × 0.72, Semantic × 1.0
        │
You + git (gates, stops, prompts)  the learning that actually changed behaviour
```

Delete the knobs → rebuild from exam papers.  
Delete the exam papers → the knobs are a rumour.  
Delete the gates → you are back to trading $1.51 yes+no quotes even with “perfect” weights.

## Suggested improvements (learn, then get fancy)

1. **Treat closed trades as the vault, weights as a cache.** If you ever “reset learning,” delete or archive `paper_closed_trades` (and unfair bookless rows) and *rebuild* weights with a fitness pass. Do not hand-edit the three numbers.

2. **Do not celebrate Semantic at 1.0.** Pin agents with `evidenceLevel: 'none'` to a quieter default (or exclude them from aggregation) so “no homework” cannot outvote people who sat the exam.

3. **Keep specialist internals frozen until you have a second teaching channel.** The missing piece is not “more mixer range.” It is either (a) you keep changing `trend/logic.ts` from reports, or (b) a future Learning Agent writes *candidate rules* from fitness warnings (`heldTooLong`, “entered above $0.80”, “bookless”). The schema already reserved a parking space for (b). Do not pretend the mixer is that agent.

4. **Log when a human rule came from evidence.** A one-line comment on the entry gate already does this (“2026-08-11 fitness pass…”). That is institutional memory. Keep doing it so six months from now you know *why* 1.05 exists.

5. **Run fitness after cleanups.** Weights can linger in RAM after you delete unfair trades. The Guide already warns about this. The exam papers and the mixer must agree.

Until Trend’s *formula* changes, turning it from 0.75 toward 0.25 only **mutes a coin flip**. It never teaches Trend to stop buying $0.97 YES. That is the difference between ensemble weighting and actually learning to trade.

## Code review

The architecture is honest about this split, if you read the comments. `AnalysisRecord` is named as long-term memory; `adaptive/store.ts` is an in-memory table hydrated from Mongo; `fitness/runner.ts` says the report is derived; `refreshAdaptiveFromLiveTrades` ignores swarm-owned rows so the mixer is not double-counting the blend. Aggregation uses `confidence × adaptive weight`, not raw win rate — that is the right kind of mixer.

The weak spot is the word “memory” covering four different things: market history, session tapes, exam papers, and three knobs. Only the knobs are wired into the next decision automatically. Session tapes wait for a Learning Agent that does not exist. Agent logic constants never move. Semantic’s baseline-1.0-with-zero-trades is the clearest bug in the metaphor: missing evidence currently looks like full trust.

Do not put “save what we learned” into Trend or Mean-Reversion prompts. Those files should keep answering “what is this market doing?” The teaching layer is fitness → adaptive, plus you.

## Further learning

The useful mental model is **mixer vs musician vs archive**:

- **Archive** = every concert recording (collector + closed trades + runs).
- **Mixer** = three faders published after the last grading pass.
- **Musicians** = Trend / Mean-Reversion / Semantic, still playing the same charts.
- **House rules** = entry gate, exit gate, watchlist policy — written after watching bad concerts.

A neural net *is* the musician, and training rewrites the charts. PMTrader is not there yet.

If you want a follow-up question that bites, it is this: **should a fitness warning be allowed to change an agent’s internals automatically** (for example “block Trend above $0.80”), or must that always stay a human edit? Automatic rule-writing is real learning. Automatic fader-moving is only learning *who to mute*.
