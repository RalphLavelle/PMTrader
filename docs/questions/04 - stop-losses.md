# Question

What sort of stop-loss do the agents have when they place a trade? Obviously, we need to have some sort of stop loss. Can you explain how the idea of a stop loss works with the agents? Is it even controlled by an agent? IS that part of their strategy?

# Answer

They currently have **no stop-loss**. A trade stays open until the swarm **flips** to the other side (and that flip is approved), or the **market closes**. That is not part of Trend or Mean-Reversion’s strategy.

## How a stop-loss usually works

A stop-loss is a **safety rule on an open position**, separate from “do I still like this idea?”

Example: you buy YES at $0.50 with $10. A −30% stop means: if the position is worth about $7, sell. You are not waiting for the agent to change its mind. You are capping how wrong you are allowed to be.

A **time-stop** is the same idea with a clock: “if it has not paid me in 24 hours, get out.”

Your fitness flags (`losingExits`, `heldTooLong`) are **scorekeepers after the fact**. They count painful holds. They do **not** sell anything.

## What actually closes a paper trade today

The specialists only ever say **yes**, **no**, or **neutral** at this snapshot. They do not say “exit,” “cut loss,” or “take profit.”

The paper engine then maps that into an action:

```169:180:api/src/trading/paper.ts
  // Already long — only exit on an approved flip to the other side.
  if (position.side === 'yes') {
    if (approved && recommendation === 'buy_no') {
      return 'sell_yes';
    }
    return 'hold';
  }
```

So you leave only if:

1. **Flip** — you are long YES, the swarm now wants an *approved* BUY NO (or the other way around). Hold or “same side again” does nothing.
2. **Force close** — the market is no longer open (settled / left open). Then it sells whatever you are holding, no opinion required.

The comment in the trading types is explicit: this started as a **fixed hold**, and stop-loss / take-profit were left for later:

```15:19:api/src/trading/types.ts
 * Start simple: one fixed hold. Take-profit / stop-loss / "exit when the swarm
 * flips" can be added later as alternative policies without changing the PnL
 * maths — only the rule that picks the exit snapshot changes.
```

Live paper already uses the **flip** rule, not “sell after 15 minutes.” The 15-minute setting is only “how often we are allowed to *re-decide*,” not an automatic exit.

That is why the three live closes sat for **~4.5 days**, and simulated holds average **~84 hours**: nobody was watching the loss. The engine only *records* the worst unrealised dip (`maeUsd`) so fitness can later say “held too long.”

## Is it controlled by an agent? Is it their strategy?

**No.**

| Who | What they do about exits |
|---|---|
| **Trend / Mean-Reversion** | Opinion only: “the move should continue” vs “it went too far.” No stop, no target. |
| **Risk Manager** | Mostly an **entry** bouncer (confidence, liquidity, size). It does not babysit an open trade. |
| **Paper engine** | The actual closer: flip if an approved opposite call arrives, or dump at market close. |

A stop-loss is usually a **Risk Manager / book-keeping rule**, not a Trend trick. Trend’s job is “is this still a trend?” Mean-Reversion’s job is “did it stretch too far?” A stop-loss’s job is “we are bleeding; get out even if they still like the story.”

Analogy: the specialists are weather presenters. The stop-loss is the fire alarm. You do not ask the presenter to ring the alarm; you wire the alarm to smoke.

## Why this matters for learning

Without a stop, a $10 paper ticket can ride to −$7 (as Trend did on `POLY-3381149`) while the blend keeps saying hold. Fitness then grades a long, ugly trade and calls it a “losing exit.” The agents never practised “cut this.”

A simple first stop would live in the **paper loop** (same place as the entry gate), for example:

- **Loss stop:** unrealised P&L ≤ −30% of stake → sell  
- **Time stop:** held 24 hours with no profit → sell  

That would be machinery, like the entry gate — not a new personality for Trend. The agents would still pick the side; the book would refuse to die slowly.

## Code review

The design is honest and unfinished: entries are gated, exits are not. `proposePaperAction` is the whole exit policy in a few lines. Fitness `heldTooLong` (MAE worse than 15% of stake, then a weak recovery) is a good *alarm bell*, but it is diagnostics only.

## Further learning

If you want to go deeper, the useful question is: **who should own the stop?** Engine (always on, like a seatbelt) vs Risk Manager (can veto a hold the way it vetoes an entry). Seatbelt-in-the-engine is the simpler first lesson.

I can walk through adding that next, step by step, if you want.