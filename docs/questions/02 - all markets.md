# Question
Is it silly and unrealistic to store price snapshots for ALL the Jupiter markets, which is what that wideSweep does? Because then I have to get order books for all of them, and that's infeasible. Should I only ever work with a much smaller, well-curated list of markets for this whole app?

# Answer
Not silly at all — and the key misconception to clear up is the "because then I have to get order books for all of them" part. You don't, and your app already doesn't. The architecture deliberately splits collection into two tiers, and each tier earns its keep differently.

## Why keeping the wide sweep is right

**It's cheap.** One sweep is ~60 paginated calls every 5 minutes covering ~4,800 markets, and the store is hash-deduplicated (`insertMarketSnapshotsIfChanged`) so a market whose price hasn't moved writes nothing. Compare that to order books at one call *per market per poll* — the costs differ by two orders of magnitude. The infeasibility is real for depth, but it was never true for prices.

**Breadth is what makes curation possible.** Your watchlist is auto-selected by volume from the sweep results (`maybeRefreshWatchlist`). If you stopped sweeping widely, you'd have to pick markets by hunch, and you'd never notice when a new liquid, active market appears. The wide sweep is effectively your scouting system.

**Breadth feeds the learning even where you never trade.** Your fitness pass graded 2,400 backtest stances across 50 markets and uses 150 resolved-market labels as the answer key for calibration. All of that comes from wide, shallow history. A prediction-market app that only ever saw 12 markets would take months to accumulate enough resolved outcomes to say anything statistically meaningful about its agents. Breadth of *outcomes* is how you learn faster than real time.

## Where your instinct is correct

The part of your intuition that the evidence strongly supports: **the trading universe should be small and curated.** Every one of your 16 losing trades happened in a market with near-zero liquidity and no order book. Trading breadth bought you nothing but costs. So the right split is:

- **Observe wide** (prices, lifecycle, resolution labels — cheap, feeds learning)
- **Watch narrow** (order books for a dozen or two markets — expensive, rate-limited)
- **Trade narrower still** (only where depth is captured and quotes are coherent — this is what the entry gate now enforces)

That's a funnel, and your app already has the shape of it. The bug wasn't the architecture; it was that the middle and bottom of the funnel didn't line up (trading 24 markets while watching 12), which we covered last time.

## One improvement worth considering

If you want the curation to be smarter rather than smaller: the auto-watchlist currently picks by **volume alone**. Volume and *tradeability* aren't the same thing — a market can churn volume while quoting YES+NO at $1.20. Since the entry gate already defines what "tradeable" means (quote sum ≤ $1.05, liquidity ≥ 0.05), the watchlist selection in `maybeRefreshWatchlist` could apply the same test to the sweep snapshots before ranking by volume. Then your 12 (or 24) watched markets would all be markets the paper trader is actually *allowed* to enter, instead of spending watchlist slots on markets the gate will veto anyway.

## Bottom line

Keep the wide sweep — it's the cheap layer that makes everything else data-driven. Your instinct to curate is right, but apply it to depth collection and trading, not to observation. The one-sentence version: **look at everything, watch a few, trade fewer.**