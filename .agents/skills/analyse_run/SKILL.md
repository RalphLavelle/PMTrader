---
name: analyse_run
description: >-
  Summarise a stored PMTrader swarm run in plain English for non-expert decision
  makers. Use when the user asks to analyse the latest run, analyse a run, explain
  a run, or wants a readable report for a market id such as POLY-3013350.
---

# Analyse Run

Turn a stored swarm run from MongoDB into a plain-English markdown report that
a non-market-expert can use to decide whether to act.

## When to use

- User says **"analyse the latest run"** — summarise the most recent run in the database.
- User provides a **market id** (e.g. `POLY-3013350`) — summarise the latest run for that market.
- User provides a **run id** — summarise that specific run.

## Workflow

1. **Load the run**
   - Prefer `GET http://localhost:3000/api/runs?limit=1` for the latest run.
   - Add `?marketId=POLY-3013350` when the user named a market.
   - Use `GET http://localhost:3000/api/runs/:id` when the user named a run id.
   - If the API is unavailable, run:
     ```bash
     npx tsx scripts/analyse-run.ts
     npx tsx scripts/analyse-run.ts --market POLY-3013350
     npx tsx scripts/analyse-run.ts --id <run-id>
     ```

2. **Generate the report**
   - Use `summarizeRun()` from `api/src/runs/summarize.ts`, or follow the same section structure manually.
   - Write in **plain English**. Avoid jargon unless you immediately explain it.
   - Cover every item the operator needs:
     - Market id
     - Date and time of the run
     - Participating agents
     - Confidence scores
     - Signals (what each specialist concluded)
     - Risk assessment (approved or vetoed, and why)
     - Recommendation (buy yes, buy no, or hold)
     - Outcome (if recorded)
     - Mode (swarm vs deterministic)

3. **Save the report**
   - Path: `docs/runs/<marketId>/<run-id>.md`
   - Create the market folder if it does not exist.
   - Example: `docs/POLY-3013350/61304295-9b8d-4e12-98a3-7f7495f641b5.md`

4. **Tell the user**
   - Give a short spoken summary (2–4 sentences).
   - Link to the saved markdown file path.
   - State clearly whether a trade is recommended or not.

## Report template

Use this structure:

```markdown
# Run summary: <market title>

**Run id:** `<id>`
**Market id:** `<marketId>`
**When:** <human-readable date/time>

## What this run is about
...

## How the run was produced
...

## What each specialist concluded
...

## Confidence scores (at a glance)
...

## Risk review
...

## Final recommendation
...

## Outcome (after the fact)
...

## Bottom line
...
```

## Plain-language rules

- **Hold** means "do nothing — the swarm does not see a good trade."
- **Confidence 0%** means "no conviction," not "definitely wrong."
- **Vetoed** means the Risk Manager blocked a trade even if an agent was bullish.
- **Swarm mode** means AI agents chose the workflow; **deterministic** means a fixed fallback path ran.
- End with a **Bottom line** section that answers: "Should I trade?" in one paragraph.

## Do not

- Do not dump raw JSON unless the user explicitly asks for it.
- Do not treat the report as financial advice — phrase it as automated guidance.
- Do not skip the Risk Manager section; it explains why a trade may have been blocked.
