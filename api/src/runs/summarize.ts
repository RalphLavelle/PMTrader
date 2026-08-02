import type { AnalysisRecord, AgentSignal, SwarmAnalysisResult } from '../schemas/index.js';

/** Human-readable agent names for non-expert readers. */
const AGENT_LABELS: Record<string, string> = {
  market_analyst: 'Market Analyst',
  trend_agent: 'Trend Agent',
  mean_reversion_agent: 'Mean Reversion Agent',
  semantic_agent: 'Semantic Agent',
  risk_manager: 'Risk Manager',
};

/** Format an ISO timestamp for a general audience. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

/** Turn a stance into plain language. */
function describeStance(stance: AgentSignal['stance']): string {
  switch (stance) {
    case 'yes':
      return 'leans toward **Yes**';
    case 'no':
      return 'leans toward **No**';
    default:
      return 'is **neutral** (no clear direction)';
  }
}

/** Turn a recommendation into plain language. */
function describeRecommendation(recommendation: AnalysisRecord['recommendation']['recommendation']): string {
  switch (recommendation) {
    case 'buy_yes':
      return '**Buy Yes** — the swarm thinks Yes is more likely than the price suggests.';
    case 'buy_no':
      return '**Buy No** — the swarm thinks No is more likely than the price suggests.';
    default:
      return '**Hold / do nothing** — the swarm does not see a trade worth placing.';
  }
}

/** Explain how the run was produced. */
function describeMode(mode: AnalysisRecord['mode']): string {
  return mode === 'swarm'
    ? 'The AI agents orchestrated this run (LLM-driven swarm).'
    : 'The specialists ran in a fixed order without LLM orchestration (deterministic fallback).';
}

/** Summarise confidence as a simple percentage label. */
function confidenceLabel(value: number): string {
  const pct = Math.round(value * 100);
  if (pct === 0) return '0% (no conviction)';
  if (pct < 30) return `${pct}% (low)`;
  if (pct < 60) return `${pct}% (moderate)`;
  return `${pct}% (high)`;
}

/**
 * Build a plain-English markdown report for a stored run.
 *
 * The report is written for someone who is not a market expert but needs to
 * decide whether to act on the swarm's advice.
 */
export function summarizeRun(run: SwarmAnalysisResult): string {
  const { record, snapshot } = run;
  const lines: string[] = [];

  lines.push(`# Run summary: ${snapshot.title || record.marketId}`);
  lines.push('');
  lines.push(`**Run id:** \`${record.id}\``);
  lines.push(`**Market id:** \`${record.marketId}\``);
  lines.push(`**When:** ${formatWhen(record.timestamp)}`);
  lines.push('');

  lines.push('## What this run is about');
  lines.push('');
  lines.push(
    `This is an automated analysis of the prediction market **"${snapshot.title || record.marketId}"** ` +
      `(id \`${record.marketId}\`). The market was **${snapshot.status}** when the data was captured.`,
  );
  if (snapshot.rulesPrimary) {
    lines.push('');
    lines.push('**Resolution rules (summary):**');
    lines.push('');
    lines.push(`> ${snapshot.rulesPrimary.split('\n')[0]}`);
  }
  lines.push('');

  lines.push('## How the run was produced');
  lines.push('');
  lines.push(describeMode(record.mode));
  lines.push('');
  lines.push('**Agents that took part:**');
  lines.push('');
  for (const agent of record.participatingAgents) {
    lines.push(`- ${AGENT_LABELS[agent] ?? agent}`);
  }
  lines.push('');

  lines.push('## What each specialist concluded');
  lines.push('');
  if (record.signals.length === 0) {
    lines.push('No specialist signals were recorded for this run.');
  } else {
    for (const signal of record.signals) {
      const label = AGENT_LABELS[signal.agent] ?? signal.agent;
      lines.push(`### ${label}`);
      lines.push('');
      lines.push(
        `- **View:** ${describeStance(signal.stance)}`,
      );
      lines.push(`- **Confidence:** ${confidenceLabel(signal.confidence)}`);
      lines.push(`- **Reasoning:** ${signal.reasoning}`);
      lines.push('');
    }
  }

  lines.push('## Confidence scores (at a glance)');
  lines.push('');
  const scores = Object.entries(record.confidenceScores);
  if (scores.length === 0) {
    lines.push('No per-agent confidence scores were recorded.');
  } else {
    for (const [agent, score] of scores) {
      lines.push(`- **${AGENT_LABELS[agent] ?? agent}:** ${confidenceLabel(score ?? 0)}`);
    }
  }
  lines.push('');

  lines.push('## Risk review');
  lines.push('');
  if (!record.riskAssessment) {
    lines.push('The Risk Manager did not produce an assessment for this run.');
  } else {
    const risk = record.riskAssessment;
    lines.push(
      risk.approved
        ? '**Approved** — the Risk Manager allowed a trade (subject to the recommendation below).'
        : '**Not approved** — the Risk Manager blocked a trade.',
    );
    lines.push('');
    lines.push(`- **Suggested position size:** $${risk.positionSizeUsd.toFixed(2)} USD`);
    lines.push(`- **Maximum allowed:** $${risk.maxPositionUsd.toFixed(2)} USD`);
    lines.push(`- **Risk score:** ${Math.round(risk.riskScore * 100)}% (0 = safest, 100 = riskiest)`);
    if (risk.vetoReasons.length > 0) {
      lines.push('');
      lines.push('**Why it was blocked:**');
      for (const reason of risk.vetoReasons) {
        lines.push(`- ${reason}`);
      }
    }
    if (risk.warnings.length > 0) {
      lines.push('');
      lines.push('**Warnings (did not block, but worth noting):**');
      for (const warning of risk.warnings) {
        lines.push(`- ${warning}`);
      }
    }
  }
  lines.push('');

  lines.push('## Final recommendation');
  lines.push('');
  const rec = record.recommendation;
  lines.push(describeRecommendation(rec.recommendation));
  lines.push('');
  lines.push(`- **Estimated Yes likelihood:** ${Math.round(rec.yesLikelihood * 100)}%`);
  lines.push(`- **Overall confidence:** ${confidenceLabel(rec.confidence)}`);
  lines.push(`- **Position size:** $${rec.positionSizeUsd.toFixed(2)} USD`);
  lines.push('');
  lines.push(`**In plain terms:** ${rec.rationale}`);
  lines.push('');

  lines.push('## Outcome (after the fact)');
  lines.push('');
  if (!record.outcome) {
    lines.push(
      'No outcome has been recorded yet. Once the market settles, you can log whether the prediction was right.',
    );
  } else {
    const outcome = record.outcome;
    lines.push(
      outcome.resolved
        ? `The market **resolved to ${outcome.resolvedTo?.toUpperCase() ?? 'unknown'}**.`
        : 'The market has **not resolved** yet.',
    );
    if (outcome.realizedPnlUsd !== null) {
      lines.push(`- **Realised profit/loss:** $${outcome.realizedPnlUsd.toFixed(2)} USD`);
    }
    if (outcome.wasCorrect === true) {
      lines.push('- **Prediction quality:** The recommendation matched the outcome.');
    } else if (outcome.wasCorrect === false) {
      lines.push('- **Prediction quality:** The recommendation did not match the outcome.');
    } else {
      lines.push('- **Prediction quality:** Not scored (e.g. the swarm advised holding).');
    }
    lines.push(`- **Recorded:** ${formatWhen(outcome.recordedAt)}`);
  }
  lines.push('');

  lines.push('## Bottom line');
  lines.push('');
  if (rec.recommendation === 'hold' || !record.riskAssessment?.approved) {
    lines.push(
      '**No trade is recommended.** The specialists did not agree strongly enough, or the Risk Manager blocked the idea. Waiting for clearer evidence is reasonable.',
    );
  } else if (rec.recommendation === 'buy_yes') {
    lines.push(
      `**Consider buying Yes** with up to **$${rec.positionSizeUsd.toFixed(2)} USD**, if you accept the stated risks. This is guidance, not financial advice.`,
    );
  } else {
    lines.push(
      `**Consider buying No** with up to **$${rec.positionSizeUsd.toFixed(2)} USD**, if you accept the stated risks. This is guidance, not financial advice.`,
    );
  }

  return lines.join('\n');
}
