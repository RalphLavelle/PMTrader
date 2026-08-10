# PM Trader

When the API starts:

1. If scheduling is switched on, the app picks up the nominated market (e.g. POLY-3013350)
   and analyses it on a repeating timer. If scheduling is switched off — which is the
   default, and how it is set up today — nothing happens automatically, and a run only
   takes place when you ask for one over HTTP.
2. Each run takes one of two paths: **swarm** or **deterministic**. Swarm means an AI
   model decides which specialist speaks next and when the analysis is finished.
   Deterministic means the specialists run in a fixed, pre-written order with no AI
   choosing anything. Both paths use exactly the same underlying calculations, so their
   answers are directly comparable — the difference is who chooses the running order,
   not how the numbers are worked out.
3. The app performs a 'run', that is, one complete analysis of one market:
   - It fetches the market's current prices and order book from Jupiter.
   - Four specialists each form a view: the Market Analyst prepares the data, the Trend
     Agent looks for momentum to follow, the Mean Reversion Agent looks for prices that
     have overshot and may drift back, and the Semantic Agent reads the real-world
     question behind the market.
   - The Risk Manager blends those views into a single position, then applies its own
     safety rules and can veto the whole idea.
   - The result is one of three answers — buy Yes, buy No, or hold — along with a
     confidence score and a suggested stake in dollars.
4. It saves the report of that run into the database (MongoDB, `PMTrader.runs`).
5. Later, once the market has actually settled, a separate background job goes back
   and marks that report right or wrong. See "Finding out whether it was right"
   below.

## AI use

The LLM is used in two places, and for one reason: to handle the parts of the problem
that are made of words rather than numbers.

1. **Choosing the running order** — in swarm mode only. There is no central controller
   telling the agents what to do next; each one decides who to hand over to, and the
   model makes that call.
2. **Reading the market's question and rules** — in both modes. The Semantic Agent asks
   the model what real-world evidence would actually decide this market, then turns that
   into a Yes / No / neutral view with a confidence score.

It is deliberately **not** used for anything involving money. The trend and mean-reversion
calculations, the blending of the specialists' views, the position sizing, and the veto
rules are all ordinary code with fixed, readable rules. That means every decision to risk
capital can be explained and tested without asking the model why it did something.

One practical caveat: the local model does not always follow instructions reliably. When
it skips a step, the app notices and fills the gap with the same fixed logic the
deterministic path uses, so a run always produces a complete, risk-checked answer.

## Finding out whether it was right

A prediction is worthless until you know how it turned out. When a run finishes,
the market it was about usually has not settled yet — so the report is saved with
its verdict blank, and something has to come back later and fill it in.

That something is the **outcome labeller**, and it runs on its own timer every ten
minutes. Each time it wakes up it does two things:

1. It looks through the markets the app has been collecting prices for, picks the
   handful that look like they have finished — the closing time has passed, or the
   last price update showed them as closed — and asks Jupiter what happened. If
   there is a winner, it writes that down.
2. It then goes through every saved report that is still waiting on a verdict, and
   for any whose market now has an answer, it fills in three things: whether the
   market settled Yes or No, whether the app's recommendation matched, and what the
   suggested stake would have made or lost.

That last figure is hypothetical, because the app never actually places trades. It
is worked out from how these markets pay: a contract is worth exactly $1 if it
resolves your way and nothing if it does not. So buying at 20 cents means $50 buys
250 contracts, and being right turns that $50 into $250 — a $200 profit. Being
wrong loses the lot.

Two deliberate gaps in the scoring, both worth knowing about:

- If the app said "hold", the verdict is left blank rather than marked right or
  wrong. Declining to bet tells you nothing about whether it would have been right,
  and counting it either way would flatter or punish the app unfairly.
- If the saved prices look broken — some very early runs stored every price as 1 —
  the profit figure is left blank rather than guessed. A made-up number here would
  quietly corrupt every accuracy statistic built on top of it later.

This is the groundwork rather than the finished article. The app records whether
it was right, the fitness page turns that into per-specialist scores, and Phase 6
adaptive weights then **scale each specialist's voice** in aggregation from
measured paper-trade fitness — conservatively, so thin samples stay at baseline
1.0 rather than yanking behaviour on noise.

You can watch the job at `GET /api/labeller/status`, push it to run immediately
with `POST /api/labeller/run`, and see which markets have a known answer at
`GET /api/data/labelled`. It is switched off by default; set `LABELLER_ENABLED=true`
to turn it on.

## Testing the strategy against the past

The primary question is no longer "did we pick the eventual winner?". It is:
**would a trade entered while the market was open have been profitable if we
exited later?** Final resolution is useful context, not the scoreboard.

Scoring live runs one at a time is still slow. The **backtest** (`/data/backtest`)
is the faster path: it walks stored price history, asks *"what would I have
advised at 9am?"*, then pretends to enter that trade and exit after a hold window
at the next available quote. Markets do not need to have resolved — they need
enough open-path snapshots for an exit.

Three things make it honest rather than flattering:

- **It cannot peek.** A decision made at 9am is only shown prices and order books
  recorded at or before 9am. The exit quote is also taken from history at or after
  the hold window — never invented.
- **It is compared against doing nothing clever.** Alongside the app's own answer,
  the report scores buying whichever side the market already favoured, then
  exiting under the **same** hold policy.
- **It reports what it could not measure.** Thin order-book coverage and missing
  exit quotes are called out rather than hidden.

One deliberate gap: the Semantic Agent does not take part in the replay (slow,
non-deterministic, prose never collected). The backtest measures the
*number-crunching* half of the app only.

### What it found

Every replayed decision came back "hold", for two separate reasons that are worth
telling apart.

The first is about the data and will fix itself. The only markets that have
finished so far were ones the app first noticed *after* they had already stopped
trading. There was never a live price to work with, so there was nothing to
decide. As the collector keeps running, markets it has watched from the start will
settle and become testable.

The second is about the app itself and will not fix itself. The Trend agent and
the Mean Reversion agent are built to disagree — one follows the crowd, the other
fades it — and the blending rule deliberately punishes disagreement. On a market
priced at 78%, Trend was confident about Yes and Mean Reversion was almost equally
confident about No, and the combined confidence came out at **0.006** against a
required 0.55. They cancelled each other out almost perfectly.

That is a genuinely useful thing to learn, and it is the sort of thing only a
backtest tells you. It means the app's willingness to actually recommend a trade
rests largely on the Semantic Agent breaking the tie — and, as the section below
explains, the Semantic Agent currently has no evidence to break it with.

## Marking each specialist separately

There is a problem with grading the app's final answer: when the answer is always
"hold", there is nothing to grade. But each specialist still had a view at every
single moment, and those views can be marked whether or not the app acted on them.
That is what the **fitness** page does (`/data/fitness` in the app).

It asks a sharper question than grading the blend: not only *"did we trade well?"*
but **"which specialist's side would have been a profitable trade, and when?"**
Each stance is graded as a unit intramarket trade under the same exit policy.
Resolution metrics remain as secondary context when labels exist.

Three ideas make the marking fair.

**A view is treated as a forecast, not a vote.** An agent does not just say "Yes";
it says "Yes, and I am 70% sure". Marking those as simply right or wrong would score
a cautious correct guess the same as a reckless one — and would quietly reward
agents for overstating how certain they are. So each view is turned into a
probability and scored on how far off it was. Being 90% sure and right barely costs
anything; being 90% sure and wrong is punished heavily. Saying "I don't know" always
costs the same middling amount.

**The thing to beat is the market price, not a coin flip.** In prediction markets
the favourite usually wins, so an agent that simply follows the crowd will look
impressively accurate while having contributed nothing — you could get the same
answer for free by reading the price. So every agent is scored side by side with the
market's own opinion at that same moment. The headline figure is whether it *beat the
price*.

**Small samples are not trusted.** Each agent ends up with a suggested "how much
should this one count" multiplier, but until it has been marked on at least thirty
occasions that multiplier is held at 1.0 — meaning "no change". A handful of lucky
guesses can look like genius, and changing the app's behaviour based on luck would
be worse than changing nothing.

The page also reports something the backtest could not: when two specialists took
**opposite** sides, which one was actually right? The app currently treats such a
clash as a reason to stay out, on the assumption that both are equally worth
hearing. If one of them wins two clashes in three, that assumption is throwing away
a real edge.

### What it found

All forty marked views came back **"no opinion"**. Not two specialists cancelling
each other out — nobody spoke at all.

The reason turns out to be the same data problem as before, and it is worth being
precise about it. The markets that have finished so far were only noticed *after*
they had stopped trading, so there was no real price to read. With no price, the
agents fall back to treating the market as a 50/50 toss-up, and the Trend agent is
explicitly built to say nothing when a market looks like a coin flip. It was
behaving correctly.

Two other things about that sample are worth knowing, and the page says both of them
out loud rather than leaving you to spot them:

- **None of them had an order book recorded**, so the parts of the reasoning that
  depend on how much money is resting at each price were switched off entirely.
- **All ten markets resolved the same way** (No). On a sample like that, an agent
  that reflexively said "No" to everything would score 100% while knowing nothing.

So the honest verdict is that the *sample* is broken, not the agents. Nothing here
can be fixed by adjusting the app; it is fixed by leaving the collector running so
that markets are watched from while they are still open. The machinery for marking
specialists is now built and waiting — it just has nothing worth marking yet.

## Does the AI go and research the answer?

Take a market like *"Who will be the next president?"*. At what stage does the app go off
and find out how likely each outcome is — and where does it look?

**It never does.** There is no research step anywhere in a run. This is the single biggest
limitation of the app as it stands today, so it is worth being clear about.

What actually happens is narrower than it sounds. The Semantic Agent is handed two pieces
of text that Jupiter already returned with the market data: the market's **title** and its
**resolution rules** — the small print describing exactly what would make it settle Yes or
No. It sends that text to the model twice:

1. First it asks, in effect, *"what real-world evidence would decide this question?"* The
   model writes two or three sentences back.
2. Then it asks the model to turn that write-up into a verdict: Yes, No, or neutral, plus a
   confidence score out of one.

At no point does anything leave the building to look for that evidence. The app makes only
two kinds of outbound connection: to Jupiter for prices and order books, and to the model
itself. There is no web search, no news feed, no polling data, no browsing — those tools
simply do not exist in the codebase.

So for the president question, the model can only draw on whatever it happened to absorb
while it was being trained. That knowledge has a cut-off date, it cannot be checked, and it
may be badly out of date. It cannot look at this morning's polls.

**This is why runs keep coming back as "hold".** The Semantic Agent is explicitly instructed
to prefer "neutral, low confidence" over guessing, and with no evidence in front of it that
is exactly what it does — often saying so in as many words, along the lines of *"the
narrative provides the resolution criteria but contains no actual price data or analysis"*.
That is the design working as intended rather than a fault. But once all three specialists
return neutral, the blended confidence is zero, which is far below the 0.55 threshold, so the
Risk Manager vetoes and the answer is always "do nothing".

Put plainly: the pipeline is built and working, but no real-world evidence is flowing into
it yet. Giving the Semantic Agent an actual research tool — a web search, a news API, or a
feed of polling data — is the obvious next step, and the point at which the AI would start
earning its place in the decision.
