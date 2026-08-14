# Question
The all-important marketIds that I manually chose to be the ones we look at deeply may not be very good choices. For a start, they may have closed. Second - they may not have much liquidity. Third - there may be better ones.

Would it be better to have the app itself choose the best ones to have on the watchlist according to criteria that would benefit the analysis more? And how about rotating them when they close? This should be part of the machinery of the app, rather than me just picking a list. What do you think?

# Answer
Yes — the app should own this list. The good news is that **it already does**, at least for “closed → replace.” The less-good news is that the current chooser is too simple for *learning*, so your three worries are still partly right even though you are no longer the person maintaining the file.

Think of the watchlist as a **short VIP list of 12 markets** that get the expensive treatment: order books every 30 seconds, fast labels, hourly swarm analysis, and first dibs in paper trading. Everyone else only gets cheap price snapshots. You cannot VIP 4,800 markets (that would be thousands of API calls a minute). So *someone* has to pick the 12. That someone should be a rule, not a hunch.

## What the machinery already does

After every `market_snapshots` sweep, `maybeRefreshWatchlist` in `api/src/collector/streams.ts` rewrites `api/src/shared/watchlist.json`:

1. Keep any current id that we have **not** just seen leave `status: "open"` (this is **stickiness**).
2. Fill empty slots with the highest-`volumeUsd` open markets from this sweep.
3. Truncate to `autoWatchlistSize` (currently **12**).

The swarm scheduler reloads that file every batch, so a rotation does not need an API restart. Setting `autoWatchlistSize` to `0` would freeze the file as a manual list; yours is 12, so auto-refresh is on.

**Stickiness** is there on purpose. If the app dropped a market the moment a louder one appeared, you would get a hole in that market’s order-book history — like filming a movie, then pointing the camera at a different film halfway through. For replay and fitness, a complete life of one market is worth more than fragments of twenty.

## Your three worries, checked against the live list

I looked up the 12 ids currently in `watchlist.json` against Mongo (latest snapshots from 12 Aug 2026). Here is what they actually are:

| Market | Event (plain English) | Volume | YES / NO quote | YES+NO | Order-book rows | Hours to close |
|---|---|---:|---|---:|---:|---:|
| POLY-1163699 | Clarity Act signed in 2026? | $6.5M | $0.17 / $0.84 | $1.01 | 3,046 | ~3,391 (~141 days) |
| POLY-1057883 | BTC hits $250k in 2026? | $5.4M | $0.02 / $0.98 | $1.00 | 1,182 | ~141 days |
| POLY-701501 | BTC hits $55k (down-side bucket) | $5.0M | $0.57 / $0.44 | $1.01 | 1,598 | ~141 days |
| POLY-1057916 | BTC hits $15k | $4.9M | $0.02 / $0.98 | $1.00 | 1,431 | ~141 days |
| POLY-1144471 | Will Satoshi move BTC in 2026? | $4.7M | $0.05 / $0.95 | $1.00 | 2,279 | ~141 days |
| POLY-701502 | BTC $45k bucket | $4.0M | $0.23 / $0.78 | $1.01 | 1,289 | ~141 days |
| POLY-701503 | BTC $35k bucket | $2.8M | $0.09 / $0.92 | $1.01 | 1,360 | ~141 days |
| POLY-573656 | When will BTC hit $150k? (by 31 Dec) | $2.7M | $0.02 / $0.98 | $1.00 | 1,490 | ~141 days |
| POLY-1339767 | BTC $50k bucket | $2.7M | $0.35 / $0.66 | $1.01 | 1,208 | ~141 days |
| POLY-701496 | BTC $100k bucket | $2.4M | $0.09 / $0.92 | $1.01 | 1,245 | ~141 days |
| POLY-618454 | OpenSea FDV above $500M | $2.3M | $0.12 / $0.88 | $1.00 | 1,650 | ~141 days |
| POLY-1393070 | BTC hits $1,000,000 | $2.2M | $0.01 / $0.99 | $1.00 | 348 | ~141 days |

**1. Closed?** None of them have. Rotation-on-close would do nothing today. They all share a year-end 2026 close (~31 December), so under the current rule this list is **stuck until New Year**. That is the stickiness trade-off showing its teeth.

**2. Illiquid?** Not in the “empty book” sense. Lifetime volume is $2.2M–$6.5M, YES+NO is $1.00–$1.01 (the paper entry gate allows up to **$1.05**), and every id already has hundreds to thousands of stored books. The 16 losing paper trades from the 12 Aug report were *not* these VIPs — they were markets the paper loop visited **beyond** the watchlist, with `hadOrderbook: false` and liquidity 0–0.27. So “my 12 might be dry” is the wrong diagnosis for *this* file; the dry trades were the ones that never made the VIP list.

**3. Better ones?** Yes — **better for learning**, not better for volume. Volume ranking did its job: these *are* the loudest open crypto markets. Eight of the twelve are buckets of the same question (“What price will Bitcoin hit in 2026?”). They will mostly move together. A $10 paper trade on “BTC hits $1M” at YES = **$0.01** barely measures skill; it is a lottery ticket. And none of them will resolve until December, so the labeller’s “answer key” for these twelve stays blank for months.

A toy picture: imagine you are learning tennis. Highest-volume = practising only on Centre Court at Wimbledon, one match that lasts five months. Better for *learning* = lots of short club matches that finish this week, even if the crowd is smaller.

## What “better for analysis” should mean

Volume is a decent *scout* (“is anyone here?”). It is a weak *coach* (“will this teach the agents?”). A chooser that benefits analysis would score candidates on the same ideas the rest of the app already uses:

| Criterion | Why it helps | Concrete test (starting point) |
|---|---|---|
| Still open | Dead markets waste VIP slots | `status === 'open'` (you already do this) |
| Coherent quote | Incoherent YES+NO makes spread eat the trade | `buyYes + buyNo ≤ 1.05` (same as `PAPER_MAX_ENTRY_QUOTE_SUM`) |
| Enough activity | A silent book teaches nothing about fills | Prefer volume **and** a non-empty recent order book once watched |
| Not a coin-flip lottery | Extreme prices ($0.01 YES) are mostly noise for a $10 ticket | e.g. YES between **$0.08 and $0.92** |
| Finishes soon enough | Labels and closed trades need an ending | e.g. close in **~6 hours to ~14 days** (time to collect depth, then a result) |
| Not all the same story | Twelve correlated BTC buckets ≈ one sample, not twelve | Cap how many ids share the same `eventTitle` (e.g. max 2) |

From the same Mongo snapshot: about **9,652** markets still marked open. Only **34** passed a rough “tradeable this week” filter (close in 2–168 hours, quote sum ≤ $1.05, volume ≥ $10k). The top of that list looks like POLY-3474248 (~$32k volume, ~102 hours left, YES $0.25) — quieter than a $6M year-end BTC bucket, but it will *finish* in four days. That is the kind of market that actually feeds fitness.

Analogy: the wide sweep is a security camera on the whole street. The watchlist is the three doorways you put a guard on. You want doorways people actually walk through *this week*, not the famous building that opens in December.

## How rotation should work (and a gap in today’s code)

**On close — keep this.** When a sweep (or the small `lifecycleFollowUpBatch: 10` detail fetch) sees `status !== 'open'`, that id is dropped and a filler is pulled in. That is the right “camera stays on the film until the credits.”

**The gap:** a market is only dropped if this sweep *observes* it as not-open. If it closed *and* fell off the first 60 `/events` pages, it can sit on the VIP list until follow-up catches it. Follow-up only checks 10 missing open ids per sweep, so a closed VIP can linger for a few cycles. Harmless-ish, but it is 30-second order-book calls spent on a corpse.

**A second gap, more important:** stickiness never evicts an *open but useless* market. If your 12 year-end BTC buckets stay open, **no better short-horizon market can join** until December. Fillers only run when a slot is free. That is why POLY-618455 (OpenSea $1B, $2.1M volume, next in the volume ranking) is not on the list — there is no vacancy.

So: rotate on close, yes; also allow a **soft eviction** when a sticky market fails the learning tests for several sweeps in a row (for example: quote sum > $1.05, or YES stuck at $0.01, or closeTime more than 30 days away *and* we already have 12 better nearer-term candidates). Soft eviction should be slow (hours, not every 5 minutes) so you still get a usable depth history.

## Suggested improvements (in the order I would do them)

1. **Adopt with a gate, not volume alone.** In `maybeRefreshWatchlist`, only let a filler in if it would pass the paper entry gate on the latest snapshot (`yes + no ≤ 1.05`). Cheap, uses a rule you already trust, stops spending VIP slots on markets the paper trader is forbidden to enter.

2. **Prefer a useful horizon.** When ranking fillers, boost markets with `hoursToClose` in a band such as 6 hours–14 days. Keep a couple of long-horizon “deep” slots if you want (say 2 of 12) so you still film the big BTC questions — just do not let them occupy the whole list.

3. **Diversity cap.** When filling, skip a candidate if you already have 2 markets with the same `eventTitle`. That alone would stop 8/12 slots being Bitcoin-2026 buckets.

4. **Soft-evict duds, not stars that merely got quieter.** Do not drop a market just because volume dipped (that is why stickiness exists). Do drop it if it is still open but has been untradeable or extreme-priced for, say, 6 consecutive sweeps, *or* if its close is >30 days and a short-horizon candidate is waiting.

5. **Keep one list, keep the funnel.** Do not go back to hand-editing ids. Do not watch everything. The architecture you already have is right: look at many → watch 12 deeply → trade only where the gate and a real book exist. Align `PAPER_TRADING_MAX_MARKETS` with those 12 so paper never wanders into unwatched markets again.

You do not need to change `autoWatchlistSize` to get this benefit. You need a smarter *definition of “best.”* Volume answered “who is famous?” Analysis needs “who will give us a fair, finished lesson soon?”

## How you can see this yourself

- `api/src/shared/watchlist.json` — the live VIP list (the collector overwrites it).
- `GET /api/collector/status` — same ids, plus whether streams are healthy.
- `/data/markets/:marketId` and `/data/orderbooks` — is this VIP actually being filmed?
- After a close, watch the file: the dead id should vanish and a new high-volume (ideally gated) id should appear without you typing anything.

If the collector is off (`COLLECTOR_ENABLED=false`), the machinery cannot rotate anything — the file just sits there looking “manual.” The last sweep in `schedule.json` was 12 Aug 2026; if the API has been down since, that is why the twelve names have not moved.
