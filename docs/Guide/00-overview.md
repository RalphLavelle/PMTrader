# 00 — Overview: how PMTrader learns to trade

**In one sentence:** PMTrader watches [Jupiter Predict](https://jup.ag/prediction)
markets around the clock, lets a team of software "agents" practise trading them
with pretend money, grades every practice trade, and uses those grades to give
more influence to agents that trade well and less to agents that trade badly.

## What the app is for

Jupiter Predict markets are simple YES/NO bets on real-world events ("Will
Bitcoin be up in the next hour?"). Each side has a price between $0 and $1 that
works like a probability: YES trading at $0.82 means the crowd thinks the event
is about 82% likely.

PMTrader's job is to find out — safely, with no real money at risk — whether
its agents can spot situations where the crowd's price is wrong, and to slowly
teach itself to trade those situations profitably. Everything in this Guide is
in service of that one question: **is the app getting better at trading?**

## The learning loop

The pieces run in a cycle. Each numbered document in this Guide explains one
step, in this order:

```
 1. Collect data          What is happening in the markets, minute by minute
        │
 2. The agent swarm       A team of specialists turns data into a decision
        │
 3. Scheduled runs        The swarm analyses a watchlist on a timer
        │
 4. Backtesting           Replay the past: would our decisions have made money?
        │
 5. Paper trading         Trade continuously, live, with pretend money
        │
 6. Fitness               Grade the swarm and each specialist on those trades
        │
 7. Adaptive weights      Turn grades into influence — the actual "learning"
        │
        └──────── back to step 2: the next decision uses the new weights
```

- [01 — Data collection](01-data-collection.md)
- [02 — The agent swarm](02-the-agent-swarm.md)
- [03 — Scheduled runs](03-scheduled-runs.md)
- [04 — Backtesting](04-backtesting.md)
- [05 — Paper trading](05-paper-trading.md)
- [06 — Fitness](06-fitness.md)
- [07 — Adaptive weights](07-adaptive-weights.md)
- [08 — One market, end to end](08-example-one-market.md) — a worked example
  following a single real market through every step above.

## Where the app stands right now (August 9, 2026)

This Guide describes mechanisms, but the honest state of the evidence matters
just as much. As of generation time, with the API running locally:

**What is working:**

- The collector is on and healthy: roughly **39,000 price snapshots across
  1,450+ crypto markets** gathered since August 8, with order-book depth on a
  rotating watchlist of 12 markets. See it at `/data`.
- Live paper trading is on and passing every 60 seconds. Recent passes are
  mostly "hold" — the Risk Manager vetoed the only candidate trades — which is
  the system being cautious, not broken. See it at `/data/paper`.
- **The learning loop has genuinely closed.** The adaptive weights have left
  their neutral starting point of 1.0: the Mean Reversion agent is down-weighted
  to about **0.62** after 36 practice trades that lost about $188 of pretend
  money, and the Trend agent to about **0.79** after 42 trades losing about $48.
  In plain terms: both quantitative agents have been losing at practice, and
  the system has responded by trusting them less. That is exactly what the
  machinery is supposed to do — learning includes learning *whom not to
  listen to*.

**What is not working yet:**

- **Nobody is profitable.** The weights moving is progress in the machinery;
  negative practice P&L means no agent has yet demonstrated a trading edge.
- **The outcome labeller is switched off** (`LABELLER_ENABLED` is not set), so
  no market has a recorded final YES/NO result. That blocks the secondary
  "was the forecast right?" scoring and leaves the Semantic Agent — often the
  main source of directional opinions — ungraded.
- The Semantic Agent (the one that reads the market's wording with an LLM)
  cannot be replayed in backtests at all, so its grade can only ever come from
  stored live runs plus resolutions — which need the labeller.

## How to read the state of learning at a glance

| Question | Where to look |
|----------|---------------|
| Is data still flowing? | `/data` — collector streams table, "last fetch" times |
| What is the live simulation doing right now? | `/data/paper` — open positions, last pass, closed trades |
| Is anyone making (pretend) money? | `/data/fitness` — swarm and specialist P&L, equity curves |
| Has the app learned anything? | `/data/fitness` or `/data/paper` — adaptive weights table; any weight away from 1.0 is learned distrust or trust |
| Would our logic have worked historically? | `/data/backtest` — run a replay |

## A note on honesty

Several documents in this Guide point out places where a healthy-looking
mechanism has thin evidence behind it (small trade counts, one-sided samples,
missing order books). That is deliberate. The purpose of PMTrader is to *find
out* whether these markets can be traded systematically — a Guide that only
reported good news would defeat the point.

*This Guide is regenerated by the `update-guide` skill ("update the guide").
Facts above reflect the code and live data at generation time.*
