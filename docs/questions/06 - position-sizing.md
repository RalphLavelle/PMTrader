# Question

How does the agent in charge of placing trades know how much to put on a trade? Is it possible to have it read from a Solana account it's in charge of, and make trades that are a precentage of the total balance. That way it can scale up to more and more value as the balance grows, but scale down if things are going agaisnt it. I'm thinking that each trade should be around 1% of the balance, so on a starting balance of $2,000 each trade would be $20.

# Answer

The **Risk Manager** already picks the dollar size. Trend, Mean-Reversion, and Semantic never do. They only say YES / NO / hold. The Risk Manager then answers “how many dollars?” with a formula that uses a **fixed ceiling from `.env`**, not your wallet.

That ceiling today is `SWARM_MAX_POSITION_USD` (default **$100**). Your 1%-of-balance idea is the right next step — but it should **not** live inside an agent, and paper trading should **not** read a real Solana account. Paper needs a **virtual bankroll**. Live money (later) can read USDC / JupUSD on the wallet.

Think of three jobs that must stay separate — the same split as the stop-loss answer:

| Job | Who does it today | Sizing role |
|---|---|---|
| “Do I like YES or NO?” | Trend / Mean-Reversion / Semantic | None. They are weather presenters. |
| “May we enter, and how big?” | Risk Manager | **Picks the dollar stake.** Today that stake is a fraction of $100, not of your bankroll. |
| “Did the fill actually happen?” | Paper engine (`applyBuy`) | May **shrink** the stake if the book is thin. Does not invent a new size. |

The human trade form on `/markets` is a fourth path: **you** type the amount (default **$10**, Jupiter minimum **$5**). Phantom signs. The swarm never sees that number. Automated paper trading does not place those real orders.

## How size is chosen today (the formula)

In `api/src/agents/risk-manager/logic.ts`, `calculatePositionSize` does:

> **stake = $100 × convictionScale × liquidityScore**

`convictionScale` is not “confidence as a percent.” It measures how far above the approval floor you are, then keeps a floor so a barely-approved trade is still a real ticket:

- Floor **0.25** (a barely-approved trade still takes 25% of the ceiling)
- Plus **0.75 ×** how far confidence sits between the floor and 1.0

Paper uses a lower floor than a real-money path would (`PAPER_TRADING_MIN_CONFIDENCE=0.35` vs `SWARM_MIN_CONFIDENCE=0.55`). Then:

- If the result is under **$5**, the trade is **vetoed** (Jupiter’s order minimum).
- If any veto fires, `positionSizeUsd` is forced to **0**.
- The paper engine may still fill **less** than asked: with no stored order book, notional is capped at `PAPER_NO_BOOK_DEPTH_USD` (default **$25**).

There is a second, independent book: each specialist’s “unit-stake” simulation always uses `FITNESS_SPECIALIST_STAKE_USD` (default **$10**). That is a **ruler** so Trend and Mean-Reversion can be compared fairly. It should stay $10 even after the swarm book starts using 1% of bankroll.

### Worked numbers (paper floor 0.35, ceiling $100)

| Situation | Confidence | Liquidity | Conviction scale | Stake |
|---|---:|---:|---:|---:|
| Barely approved, deep book | 0.35 | 1.00 | 0.25 | **$25.00** |
| Strong conviction, deep book | 0.80 | 1.00 | 0.77 | **$76.92** |
| Strong conviction, thin book | 0.80 | 0.20 | 0.77 | **$15.38** |
| Strong, but no stored book | 0.80 | 1.00 | 0.77 | asked $76.92, **fill cap $25** |
| Sized under Jupiter min | any | very low | tiny | **veto** (under $5) |

On the 12 Aug learning sample, live paper tickets were typically **$10** (the specialist ruler), not the $25–$77 swarm formula. Average worst dip on Mean-Reversion was about **−$5.49 on $10** (half the stake). Costs on Trend’s 14 live trades were about **−$3 to −$7 on a $10** ticket before the entry gate existed. So “how big” was already large enough to hurt; the missing piece was *not* a bigger default.

Your **$20 on a $2,000** bankroll (1%) sits between today’s specialist $10 and the Risk Manager’s $100 ceiling. It is a sensible first fraction — **if** it is 1% of *equity*, not 1% of a fake $100 wall.

## Can it read a Solana account? Yes — but not for paper, and not inside the swarm

**Reading** a balance is possible. The app already knows `OWNER_PUBKEY` and talks to Solana RPC. Jupiter prediction deposits are **USDC** or **JupUSD** (both 6 decimals). A token-account read of those two mints is the live source of truth.

Do **not** wire that read into today’s paper loop:

1. Paper trading **never sends a real order**. Mixing a real wallet into a fake book would make fitness lie (“we made 2%” while the wallet did something else).
2. The paper loop wakes about every **60 seconds**. Hitting public RPC that often is slow, rate-limited, and can 403. Cache a live balance; do not fetch per market.
3. The API has the **public** key. Reading needs no private key. **Placing** live orders later would. Keep those as two different projects. Never give an LLM or an agent a signing key.

So: **paper = virtual cash in Mongo. Live (later) = cached USDC + JupUSD on the wallet.** Same 1% recipe. Different bankroll source.

## Percent-of-balance — yes, and here is the honest version

What you described is **fixed-fractional sizing**: each new trade risks a slice of current equity, so winners raise the next ticket and losers shrink it. The Risk Manager already does “a fraction of a ceiling.” You only change **where the ceiling comes from**.

```
Virtual bankroll (paper)          Live wallet (later)
  PAPER_STARTING_BANKROLL_USD       USDC + JupUSD on OWNER_PUBKEY
  + realised paper P&L              (cached, e.g. once per paper pass)
  + unrealised P&L on open lots
                 │
                 ▼
          equityUsd  (example $2,000)
                 │
                 ▼
     maxPositionUsd = equityUsd × 0.01   →  $20
                 │
                 ▼
     Risk Manager (unchanged maths)
       × convictionScale × liquidityScore
                 │
                 ▼
     still veto under $5; still freeze the dollar size at fill
```

The **percentage recipe** can change in `.env` for *new* trades. The **dollar size** on an open lot stays frozen at fill — same idea as freezing the stop.

### Why “1% of $2,000 = $20” is not the whole story

**Available cash vs total equity.** If you already have five $20 lots open, you do not still have $2,000 of *spendable* cash. Size from **equity** (cash + open mark-to-market) so a winning book grows tickets, but **check cash** so you cannot buy $20 you do not have.

**Heat (many markets at once).** The watchlist is **12** markets. If all 12 get approved at $20, you have **$240** in the water (12% of $2,000). If every one then hits a −30% stop: **−$72** (−3.6%). If they all go to zero (binaries can): **−$240** (−12%). 1% *per trade* is not 1% *portfolio risk*. Add a heat cap, for example:

- `PAPER_STAKE_FRACTION=0.01` (this ticket)
- `PAPER_MAX_HEAT_FRACTION=0.10` (all open lots together ≤ 10% of equity)

With heat 10% and $20 tickets, at most **5** concurrent swarm lots on a $2,000 book. The 6th market waits. That is a feature.

**The $5 floor bites when you are losing.** At $400 equity, 1% = **$4** → under Jupiter’s **$5** minimum → skip, do not round up. Rounding up would *increase* risk as you shrink — the opposite of what you want.

**No edge yet → percent sizing still loses, just slower.** The 12 Aug sample: Trend win rate **11%**, Mean-Reversion **14%**, costs often as large as the market move. 1% of a growing pile is wonderful **after** there is an edge. Until then it mainly scales the same leak. That is still the right seatbelt: a losing streak of 10 full −30% stops at $20 is **−$60** (−3% of $2,000), not −$100 tickets × 10.

### Walkthrough on a $2,000 paper bankroll, 1% + 10% heat

Start: equity **$2,000**, cash **$2,000**, max ticket **$20**, max heat **$200**.

| Event | Ticket (after conviction × liquidity) | Equity after | Next 1% ticket |
|---|---:|---:|---:|
| Trade 1: barely approved, deep book | $20 × 0.25 = **$5.00** (min) | still ~$2,000 until it closes | $20 |
| Trade 2: confidence 0.80, deep book | **$15.38** (0.77 × $20) | — | $20 |
| Trade 2 stops −30% | realised **−$4.61** | **$1,995.39** | **$19.95** |
| A cheap-side winner +$15 on $15 stake | +100% of that ticket | **$2,010** | **$20.10** |
| Five $20 lots already open | 6th market **blocked by heat** | — | wait for an exit |

Compare with today’s $100 ceiling on the same strong/deep trade: stake **$76.92**. A −30% stop is **−$23**, not **−$4.61**. Same opinion, five times the burn. That is why the ceiling should be the bankroll, not a painted $100.

If the book later grew to **$4,000**, the same 1% recipe would stake **$40** without anyone editing `.env`. If it fell to **$1,000**, tickets would be **$10**. That is the scale-up / scale-down you asked for.

## How to implement it (same pattern as the entry gate)

You do not need a “Bankroll Agent.” You need a small pure function and a cash field on the paper portfolio.

### 1. Config (the recipe)

| Knob | Example | Meaning |
|---|---|---|
| `PAPER_STARTING_BANKROLL_USD` | `2000` | Virtual cash the paper book is born with |
| `PAPER_STAKE_FRACTION` | `0.01` | Max *this* ticket as a share of equity |
| `PAPER_MAX_HEAT_FRACTION` | `0.10` | Max *all open swarm lots* as a share of equity |
| `SWARM_MIN_POSITION_USD` | `5` | Keep Jupiter’s floor; never round a 1% ticket up to $5 when 1% is $4 |

Leave `FITNESS_SPECIALIST_STAKE_USD=10`. Fitness must keep a constant ruler.

A 5-minute experiment *without* code: set `SWARM_MAX_POSITION_USD=20`. That freezes every ticket near $20 (still scaled by conviction × liquidity) but **will not** shrink after losses or grow after wins. Use it only to feel the ticket size; then replace the ceiling with equity × fraction.

### 2. `bankroll.ts` — sibling of `entry-gate.ts`

Pure function, easy to test:

> Given starting cash, realised P&L, open lots, and the recipe — return `{ equityUsd, cashUsd, maxPositionUsd, heatUsd, blockReason }`.

`maxPositionUsd` is what you pass into `assessRisk` as `limits.maxPositionUsd` instead of the env $100. The existing conviction × liquidity maths stays.

`PaperPortfolio` today only stores `position` + `realisedPnlUsd`. It has **no cash**. Add `cashUsd` (or derive cash = starting + realised − open size). `applyBuy` subtracts the fill; `applySell` adds the exit proceeds. That is the virtual wallet.

### 3. Who calls it

- **Paper swarm book** (`live-engine.ts`): yes — this is the book you care about growing.
- **Specialist books** (`live-specialists.ts`): **no** — keep $10.
- **Fitness / backtest replay**: yes for the swarm book, so history is graded on the same recipe. Start those replays from the same `PAPER_STARTING_BANKROLL_USD` or they are not comparable.
- **LangGraph / prompts**: **no**. Do not let the LLM pick a dollar amount.

### 4. Live Solana read — only when you actually go live

A later `live-bankroll.ts`:

1. Once per loop (not per market), read USDC + JupUSD token accounts for `OWNER_PUBKEY`.
2. Cache ~60s; on RPC failure, **skip new buys** (do not size from a stale $2,000 you no longer have).
3. Equity = wallet cash + mark of *live* open prediction positions, not paper lots.

Until real orders exist, skip this file. Paper cash in Mongo is enough to learn whether 1% + 10% heat behaves.

## Suggested first recipe

1. Add a **virtual $2,000** paper bankroll and `PAPER_STAKE_FRACTION=0.01`. Wire `maxPositionUsd` from equity, not from `SWARM_MAX_POSITION_USD`.
2. Add **heat 10%** so 12 watchlist markets cannot all jump in at once.
3. Keep specialist books at **$10**. Keep the $5 minimum as a skip, not a round-up.
4. Log `equityUsd` and `sizeUsd` on each closed trade so fitness can say “this was 1.0% of a $1,980 book,” not just “this was $20.”
5. Only after that is boring and correct, add a **cached wallet read** for a future live path. Same fraction, different source.

Until step 1 exists, changing Trend’s prompt will not make tickets follow your bankroll. The presenters cannot look in a wallet that is not wired.

## Code review

The sizing code is already in the right place. `calculatePositionSize` is pure, testable, and honest: conviction and liquidity *scale* a ceiling; they do not invent dollars. `configuredRiskLimits` is the one door from `.env` into that function — backtest and live paper already share it, so swapping `$100` for `equity × 1%` at that door updates every caller.

The weak spot is `PaperPortfolio`: it tracks P&L but not **cash**, so the engine cannot currently answer “can I afford this?” Twelve markets can each take a Risk Manager size as if the book were infinite. `PAPER_NO_BOOK_DEPTH_USD=25` is a fill cap, not a bankroll.

Do not put wallet RPC in `trend/logic.ts`, `mean-reversion/logic.ts`, or the LangGraph handoffs. Those files should keep answering “what is the market doing?” Do not use the Phantom form’s default $10 as the automated size — that form is a human override.

The 12 Aug numbers are a warning, not a reason to size up: costs of **$3–$7 on $10** and MAE around **half the stake** mean a $100 ceiling is already aggressive. 1% of $2,000 is a *reduction* from that ceiling for strong trades ($20 vs ~$77), which is the conservative direction while the agents are still learning.

## Further learning

The useful mental model is **poker stack**, not **fixed bet**. A casino table with a $100 max bet does not look at your wallet; a good player bets a slice of *their* chips so a bad night leaves them in the game. Your Risk Manager is currently the casino sign. You want the poker-stack rule.

If you want to go deeper next, two follow-ups are worth it:

1. **Kelly vs 1%.** Kelly (a formula that sizes from win rate and payoff) would currently say “bet tiny or nothing,” because win rates are ~11–14% and costs are large. 1% is a *cap*, not a claim that the edge supports 1%. Do not raise it until fitness shows a profit factor above 1 after the entry gate and stops have a fair sample.
2. **Should open paper lots count in equity?** Yes for scaling (a book that is winning should size up). No for *cash* (you cannot spend locked stake). That split — mark-to-market equity vs spendable cash — is the whole bankroll problem in one sentence.
