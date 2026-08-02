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
