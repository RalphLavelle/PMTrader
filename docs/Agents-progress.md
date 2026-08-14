# Agents progress report — 14 Aug 2026, 11:42 AM (AEST)

Plain-English report on how the Trend agent and the Mean-Reversion agent are
progressing at learning to make profitable trades. Based on a fresh fitness
pass at 14 Aug 2026 11:41 AM AEST (order-book required), the live adaptive
weight table, 10 closed live trades, 11 open live swarm positions, collector
coverage, and the paper loop’s last passes. All numbers come from stored data.
Automated guidance, not financial advice.

## The short answer

**Still not profitable — but the classroom is finally fair, and live paper is
no longer silent.** This morning’s scoreboard was 464 simulated trades with
**zero** books and a Mean-Reversion hole of −$1,709. This pass grades **only
trades that had a stored order book at entry**: 66 Trend, 113 Mean-Reversion,
56 swarm. Trend is a small net loser (−$7.47) with a tiny mid-to-mid edge
that costs eat. Mean-Reversion is still a large loser (−$271) *even with
books*. Live swarm, which had never entered under the 0.35 floor, now has
**11 open positions** because disagreement follows the heavier specialist
(Trend, weight 0.82) instead of averaging to a shrug.

Collected-vs-traded match: **12 = 12, and all 12 have a fresh book this
minute.** The four expired 13 Aug seats are gone.

## Scoreboard (fitness pass, 14 Aug 11:41 AM)

These 235 trades are **with-depth only** (simulated replay of filmed markets
plus live specialist closes that had a book at entry). Bookless history was
dropped on purpose.

| | Trend agent | Mean-Reversion agent | Swarm book |
|---|---|---|---|
| Coherent paper trades graded | 66 | 113 | 56 |
| Of which had a book at entry | **66 / 66** | **113 / 113** | (replay on filmed markets) |
| Win rate | 15% | 2% | 20% |
| Realised paper P&L | −$7.47 | −$270.58 | −$41.42 |
| Gross P&L (before costs) | **+$7.32** | −$84.36 | **+$12.66** |
| Profit factor | 0.47 | 0.008 | 0.39 |
| Average winner / loser | +$0.66 / −$0.25 | +$1.11 / −$2.46 | +$2.37 / −$1.50 |
| Return on capital | −1.1% | −23.6% | −1.4% |
| Average hold | ~24 hours | ~11 hours | ~25 hours |
| Forecasting accuracy | **66%** | 13% | — |
| Skill vs. trusting the market price | **+16%** | −38% | — |
| Head-to-head wins (78 disagreements, 0 agreements) | 34 | 9 | — |
| Suggested weight from this pass | 0.65 | 0.52 | — |
| Current influence weight (baseline 1.0) | **0.82** | 0.63 | — |
| How they actually exited | 37 time-stop, 26 market-close, 3 trail | **73 trailing-stop**, 23 time-stop, 17 market-close | — |

Compared with this morning (7:32 AM, bookless exam):

- Trade counts collapsed for the right reason: we stopped grading empty
  ladders. Mean-Reversion 358 → 113; Trend 106 → 66.
- Mean-Reversion’s morning **gross +$638** disappeared. On filmed books its
  gross is **−$84**. That “edge” was a bookless artefact, not a call the
  venue would have paid.
- Trend’s net loss shrank from −$110 to −$7.47. Gross is slightly positive.
  Costs still take the whole edge.
- The swarm paper book, which closed **zero** trades this morning, now has
  **56** simulated closes (follow-heavier in replay). Net −$41, gross +$13.
- Trend’s forecasting on *live* stances is 66% with +16% skill vs the market
  price. That is the first time this report has seen a specialist beat a coin
  flip *and* the quote. Sample is still the live_run slice (678 of 688
  stances), not resolution labels.

The semantic agent still never takes a side (226 stances). Weight pinned at
1.0. The LLM is in a usage-limit backoff until ~12:10 PM AEST, so today’s
swarm batches are deterministic.

## The match question: collected markets vs. traded markets

**Yes — live paper universe, depth watchlist, and fresh books match, 12 = 12.**

- Shared watchlist: **12 crypto ids**. Last collector rewrite kept that size
  and **dropped the four silent 13 Aug names** (POLY-3517205-0/1, POLY-3381149,
  POLY-3381026) plus other stale seats. New seats include nearer-term Bitcoin /
  Ethereum / XRP questions for 14–18 Aug.
- Paper `maxMarkets`: **12**. Last pass: **12 considered, 0 stale, 12
  duplicate** (already decided this 15-minute window).
- Order books polled every 30 seconds for those 12. Newest row: 14 Aug 11:40 AM
  AEST. **Every watchlist id has a book from this minute.** Crypto-only filter
  on.
- `orderbook_snapshots` now covers **31** distinct markets historically.
  Fitness replayed those filmed markets, not the 18,915 price-tick universe.

One watchlist id has no open paper lot: `POLY-701501` (Bitcoin 2026 $55k, a
long-horizon deep slot). Swarm holds it at confidence **0.18**, below 0.35.
That is an honest skip, not a missing-data skip.

Caveats:

1. `paper_portfolios` still holds ~**1,904** leftover market-state docs from
   an older, wider loop. Live considers 12. Swarm realised on the *current*
   open book is −$2.32 (one closed live swarm trail); the 1,904 figure is not
   the learning sample.
2. Fitness with-depth sample is 66 + 113 specialist trades — above the 30-trade
   reliability floor per agent, so weights are allowed to move. Swarm’s 56
   closes are the first swarm scoreboard that is not empty.

## Live paper: what actually happened since 7:32 AM

The follow-heavier rule is doing what it was asked to do. Swarm logs this
morning show **buy_no / buy_yes at 0.59–0.78**, not 0.10–0.18 blends. Paper
has **11 open swarm positions** (first time this report has seen that).

Open swarm book (mark ~11:40 AM AEST), all on the current watchlist:

| Market | Side | Size | Entry price | Unrealised | Notes |
|---|---|---|---|---|---|
| POLY-3542084-0 | YES | $70.78 | $0.56 | $0.00 | Bitcoin Up 14 Aug |
| POLY-3542084-1 | YES | $70.50 | $0.46 | −$6.20 | Bitcoin Down 14 Aug |
| POLY-3400706 | NO | $69.98 | $0.81 | −$2.59 | BTC above $64k 14 Aug |
| POLY-3516865 | NO | $64.00 | $0.94 | −$1.42 | BTC above $66k 18 Aug |
| POLY-1163699 | NO | $59.16 | $0.80 | −$0.80 | Clarity Act 2026 |
| POLY-3474248 | NO | $58.88 | $0.77 | +$0.77 | BTC Aug 10–16 |
| POLY-3401093 | YES | $52.07 | $0.77 | −$1.40 | XRP above $1 14 Aug |
| POLY-3542085-0 | YES | $15.46 | $0.61 | +$0.23 | ETH Up 14 Aug |
| POLY-3474306 | NO | $13.20 | $0.89 | −$0.16 | ETH Aug 10–16 |
| POLY-3400566 | NO | $8.59 | $0.71 | −$0.25 | ETH above $1,900 14 Aug |
| POLY-3451191 | NO | $7.34 | $0.67 | −$0.12 | BTC above $64k 16 Aug |

Mark-to-market: realised **−$2.32**, unrealised **−$11.94**. None of these 11
have closed under the new rules yet, so they are **not** on the fitness
scoreboard. They are the exam in progress.

Closed live trades since yesterday (10 rows). Fair (book at entry) specialist
rows in **bold**:

| Closed (AEST) | Owner | Market | Book at entry? | Exit | Net |
|---|---|---|---|---|---|
| 14 Aug ~11:21 AM | Swarm | POLY-3542084-1 | **no** | trailing_stop | −$2.32 |
| 14 Aug ~11:32 AM | Mean-Reversion | POLY-3400706 | **yes** | trailing_stop | **−$0.93** |
| 14 Aug ~9:06 AM | Mean-Reversion | POLY-3400706 | **yes** | trailing_stop | **−$0.02** |
| 14 Aug 3:27 AM | Mean-Reversion | POLY-3400706 | **yes** | trailing_stop | **−$4.86** |
| Older (8–13 Aug) | mixed | POLY-3381149 / 3400706 / 3400566 | no | flip / hold | +$11.48, −$4.57, −$7.10, +$15.03, +$0.07, −$5.34 |

The three with-book Mean-Reversion trails are the first fair live specialist
sample. Combined **−$5.81**. Two of the three are tiny (−$0.93, −$0.02) after
the wider trail / 60-minute grace; the −$4.86 row was the pre-widen fill from
overnight. Sample size 3 — do not retune from it yet.

The swarm −$2.32 trail entered **without** a stored book. It does not belong
in the with-depth weight table (and was not merged). The same market was
re-entered later at $0.46 and is still open (−$6.20 unrealised).

## What the evidence says is going wrong

### 1. Mean-Reversion still loses on real books — the “gross edge” was fake

Morning: gross +$638, net −$1,709, 92% trailing-stop exits, all bookless.
Now: gross **−$84**, net −$271, 73/113 trails (65%), **all with books**.
Widening the trail and requiring a book did not uncover a hidden edge. It
removed a simulation mirage. Follow-heavier is correctly giving this agent
less voice (0.63 vs Trend 0.82).

### 2. Trend has a small mid edge that costs erase — and it now *runs* the live book

Trend: gross +$7.32, net −$7.47, 15% win rate, average loser only −$0.25.
Forecasting on live stances is the bright spot (66%, +16% skill). Because it
is the heavier specialist, almost every live entry is a Trend call (mostly
**buy NO** at $0.67–$0.94). Live learning will be “does Trend’s expensive-side
NO work on near-dated crypto?” — not a blend of two views.

### 3. Two complementary YES lots on the same event

POLY-3542084-0 YES at $0.56 and POLY-3542084-1 YES at $0.46 are “Bitcoin Up”
and “Bitcoin Down” on 14 Aug. Together that is about **$1.02** of YES for a
pair that should pay $1.00 if they are exhaustive. The quote gate blocks
YES+NO *inside* one market, not YES+YES across a complementary pair. Evidence:
the Down leg is already −$6.20 unrealised on $70.50.

### 4. Live swarm still has almost no *closed* with-book evidence

Eleven open lots, one closed swarm trail (bookless). Fitness swarm −$41 is
still mostly replay. Weights will not honestly move on the live exam until
those 11 close with `hadOrderbook: true`.

## What would make them learn better (ranked by evidence)

1. **Let the 11 open with-book swarm lots finish.** Do not retune 0.35, trail
   %, or follow-heavier until ~20 live swarm closes exist with
   `hadOrderbook: true`. The simulated Trend edge is a few dollars; one
   −$30 replay loser already dwarfs it (`largestLoserUsd` −$30.47 on the
   swarm book).
2. **Block complementary-pair double buys** (Up YES + Down YES, or equivalent).
   Today’s exhibit is POLY-3542084-0/1. A same-event YES+YES sum gate (for
   example ≥ ~$0.98) would stop paying the spread to own both outcomes.
3. **Keep Mean-Reversion’s trail where it is and keep follow-heavier.**
   With-book gross is negative; 73 trails in 113 is still high, but the
   story is no longer “the seatbelt hid an edge.” Cutting trail further
   would not create the missing mid-to-mid profit.
4. **Cap live size on lopsided quotes** (YES or NO ≥ ~$0.90). POLY-3516865
   NO at $0.94 is a Trend continuation on a near-settled favourite. Fitness
   already shows Trend’s worst bucket is **lopsided** (−$5.92 of its −$7.47).
5. **Semantic agent: commit or exclude** while the LLM is in backoff. 226
   silent stances and a fake weight of 1.0 are unchanged.
6. **Keep the collector/API up.** `skippedStale: 0` this pass. Trails and
   follow-heavier only work on tips they actually see.

Do **not** lower 0.35. Do **not** raise `autoWatchlistSize` — the 12 seats
are filled, filmed, and being traded.

## Bottom line

The agents have not learned to make money. What *did* change is the honesty
of the exam:

- Fitness now grades filmed books only (66/66 and 113/113).
- Mean-Reversion’s supposed gross edge was a bookless artefact.
- Trend is a small, costly loser with the first forecast skill above the
  market quote on live stances — and it currently **runs** live paper via
  follow-heavier.
- Watchlist = paper universe = 12 markets with live books; expired 13 Aug
  seats are gone.
- Live swarm finally has entries (11 open). The next report should be able
  to say whether those with-book fills made or lost money — that is the
  number that matters, not this morning’s −$1,709.

Check `GET /api/paper/status`: you want those 11 to close with
`hadOrderbook: true`, not a return to 0.15-confidence holds. Then
`POST /api/fitness/run` should show a non-zero swarm with-depth live sample,
not only replay.
