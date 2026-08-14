# How well are the agents learning to trade? — 12 Aug 2026

Plain-English report on the Trend agent and the Mean-Reversion agent, based on the
latest fitness pass (11 Aug 2026, 8:11 PM UTC), the current adaptive weight table,
and the 16 live paper trades closed between 8–11 Aug 2026. Everything below comes
from stored data, not opinion. This is automated guidance, not financial advice.

## The short answer

**Neither agent is making money yet, but the learning system itself is working.**
Both agents are losing on paper, the system has correctly noticed this and cut
their influence, and — importantly — the single biggest cause of the losses was
identified from the data and a fix (the entry gate) went live on 11 Aug. The
trades that produced these bad numbers were all placed *before* that fix.

## Scoreboard

| | Trend agent | Mean-Reversion agent |
|---|---|---|
| Coherent paper trades graded | 37 | 28 |
| Win rate | 11% | 14% |
| Realised paper P&L | −$43.57 | −$80.65 |
| Profit factor (won ÷ lost) | 0.02 | 0.31 |
| Average winner / loser | +$0.22 / −$1.39 | +$8.99 / −$4.86 |
| Forecasting accuracy (directional calls) | 49.9% | 44.6% |
| Skill vs. just trusting the market price | −0.1% (none) | −5.4% (worse than market) |
| Overconfidence | +0.09 | +0.12 |
| Current influence weight (baseline 1.0) | 0.75 | 0.72 |

## What the evidence says is going wrong

### 1. Costs ate the trades — the largest, clearest problem

Across the Trend agent's 14 closed live paper trades: gross loss −$46.19,
estimated spread/fee costs −$46.17. **Costs were as large as the market losses
themselves** — every trade started roughly $3–$7 underwater on a $10 position.

Why: all 16 live trades were entered in markets with **no order book stored and
liquidity scores of 0–0.27**. Several entered at incoherent quotes (e.g. buying NO
at $0.97 while YES traded at $0.73 — a combined $1.70 against a fair $1.00).
In markets like that, the spread swallows any possible edge before the agent's
opinion even matters.

This was already diagnosed and fixed: the entry gate (`api/src/trading/entry-gate.ts`,
live 11 Aug) now blocks entries when the YES+NO quote sum exceeds $1.05 or
liquidity is below 0.05. The most recent paper pass showed 0 new entries and 3
risk vetoes — the gate is doing its job. No trades have yet closed under the new
rules, so its effect isn't measurable yet.

### 2. The Trend agent has no forecasting edge

Its directional calls were right 49.9% of the time — a coin flip — and its "skill
versus the market price" is −0.1%, meaning simply believing the market's own price
would have done just as well. A coin-flip forecaster minus heavy costs is a
guaranteed loser. Its trades also almost never went into profit at any point:
12 of 14 live trades had a maximum favourable move of $0.

It also entered on very weak conviction: the average swarm confidence at entry on
its losing trades was 0.25, with entries approved as low as 0.18.

### 3. The Mean-Reversion agent loses accuracy but wins asymmetry

It is *less* accurate than trend (44.6%) and worse than the market price by 5.4%.
But its trade shape is much healthier: average winner +$8.99 vs average loser
−$4.86. Its only two closed live trades both won (+$21.36 combined), and both
were bought on the *cheap* side (~$0.35), where a wrong call loses little and a
right call pays nearly 2:1. It sat at 28 graded trades — just under the 30-trade
minimum — so the learning system is still partly discounting its evidence.

### 4. Exits are slow and undisciplined

Fitness flagged 32 "losing exits" and only 3 premature exits for trend, and 20
"held too long" events for mean-reversion. Average holding time was ~40 hours,
and trades routinely rode from small losses to −$7 or worse (average worst
drawdown per trade −$5.49 for mean-reversion). There is effectively no stop-loss
behaviour in the closed trades.

### 5. The learning loop itself is functioning

This is the good news. Between 8 Aug and 11 Aug the adaptive weights recorded at
each entry show the system responding to results: trend's weight fell from 0.79
to 0.75, and mean-reversion's moved from 0.60 up to 0.83 after its two wins, then
settled at 0.72. Weights are clamped to 0.25–1.5 and move gradually (inertia 0.6),
exactly as designed. The system is *learning who to trust*; the agents just
haven't given it anything trustworthy yet.

One gap: the semantic agent took 470 stances and **never once picked a side**, so
it generates zero learning evidence and stays pinned at weight 1.0.

## What would make them learn better (evidence-based)

1. **Let the entry gate prove itself before changing anything else.** All the
   losses above predate the gate. A week of post-gate trades is the cleanest
   experiment you can run right now. If costs still exceed ~20% of gross P&L
   after the gate, tighten `PAPER_MAX_ENTRY_QUOTE_SUM` below 1.05.

2. **Fix data coverage — only 37% of graded stances had a stored order book.**
   The fitness pass itself warns about this. Without depth data the fill model
   falls back to top-of-book with a $25 cap, and liquidity scores read as 0,
   which both distorts costs and starves the regime-conditioned learning.
   More frequent/complete order-book collection would improve every downstream
   number.

3. **Raise the entry confidence floor.** Losing trades were approved at 0.18–0.31
   swarm confidence. There is no evidence in the trade log that sub-0.3
   confidence entries ever paid off (0 wins in 14). Requiring ~0.35+ for paper
   entries would cut the worst trades while still generating learning volume.

4. **Add a stop-loss / time-stop to the paper engine.** With 12 of 14 trades
   never in profit and average adverse moves of −$5+ on $10 positions, exiting
   at, say, −30% or after 24 hours without profit would roughly halve realised
   losses on this sample without touching the winners (both winners were in
   profit within their first day).

5. **Get mean-reversion past the 30-trade evidence bar.** At 28 trades its
   weight is still shrunk toward baseline. Its healthy win/loss shape (+$8.99 /
   −$4.86) deserves a verdict on a full sample — the gate may slow trade
   generation, so consider letting the paper loop consider more markets
   (`PAPER_TRADING_MAX_MARKETS`, currently 24) in *liquid* categories.

6. **Rethink the trend agent's signal, not just its weight.** Down-weighting a
   coin-flip forecaster only mutes it; it never becomes useful. The head-to-head
   data shows the two agents disagreed on all 518 comparisons and mean-reversion
   won more of them (138 vs 125). The trend logic's habit of buying the
   *expensive* side of a move (entries at $0.85–$0.97) is the opposite of the
   behaviour that produced the only winning trades. A candidate rule worth
   testing in backtest: block trend entries above ~$0.80, where a win pays
   pennies and a loss costs the whole stake.

7. **Make the semantic agent commit or retire it.** 470 neutral stances means it
   contributes nothing and can never be graded. Either lower its internal
   threshold for taking a side in paper mode, or exclude it from aggregation
   until it produces gradable output.

## Bottom line

The agents are not yet profitable — trend lost on all 14 of its live paper trades
and has no measurable forecasting edge, while mean-reversion shows a genuinely
promising win/loss shape on a still-too-small sample. But the *learning
machinery* — fitness grading, adaptive weights, and the feedback loop that
produced the entry gate — is demonstrably working. The single biggest lesson in
the data is that most of the money was lost to trading costs in illiquid,
incoherently-priced markets, not to bad predictions. That fix is already live;
the next most valuable steps are better order-book data, a confidence floor,
and stop-loss discipline.
